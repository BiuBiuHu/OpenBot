#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { classifyCommand } from "./approval.js";
import { applyHostSettings, defaultConfig, hasLocalModelKey, loadConfig, saveConfig, writeEnvExampleToHome } from "./config.js";
import { loadEvalCases, runEvalSuite, writeEvalSuiteRun } from "./eval-set.js";
import { openbotHome } from "./paths.js";
import { startControlPlane } from "./server.js";
import { bootstrapWorker, probeSsh, sshTarget } from "./ssh.js";
import type { OpenBotConfig } from "./types.js";
import { WorkerClient } from "./worker-client.js";
import { ensureWorkerAccess } from "./tunnel.js";
import { OpenHandsClient, conversationSnippet, remoteConversationFailed } from "./oh-client.js";
import { deliverConfirmedHandoff, HandoffStore } from "./handoff.js";
import { printThreadEvent, runThreadTurn } from "./thread.js";

function usage(): string {
  return `OpenBot — SSH your own machine. The agent gets a computer — you keep the keys.

Usage:
  npx openbot init [--host HOST] [--user USER] [--port N] [--identity FILE]
                   [--name NAME] [--model MODEL] [--base-url URL]
  npx openbot bind              Install/start the worker on the remote host
  npx openbot status            SSH + worker + OpenHands tunnel health
  npx openbot serve [--port N]  Local client UI (one thread → OpenHands)
                                http://127.0.0.1:3847/  trial: /oh-test
  npx openbot run <command>     Run a command on the remote host (PR#1 worker)
  npx openbot chat [message]    Same thread: local chat or OH handoff
  npx openbot oh health         Probe tunneled OpenHands Agent Server
  npx openbot oh conversations  List OH conversations
  npx openbot oh run <goal>     Confirmed handoff: create OH conversation + poll
  npx openbot eval              Replay the chat-layer eval set (writes ~/.openbot/evals)
  npx openbot help

OpenHands is reached at OH_BASE_URL (default http://127.0.0.1:8000).
Open a tunnel first: ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host
Session key: OH_SESSION_API_KEY (header X-Session-API-Key). OPENHANDS_* aliases still work.
Create always sends agent.llm (1.49.2). Default model is deepseek/deepseek-chat; api_key only if OH_LLM_API_KEY is set.
Empty OPENAI_API_KEY in ~/.openbot/.env does not block the remote DeepSeek path.

Config lives in ~/.openbot (never commit it). Keys go in ~/.openbot/.env or a gitignored .env.
`;
}

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string>; rest: string[] } {
  const [cmd = "help", ...raw] = argv;
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = raw[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      rest.push(tok);
    }
  }
  return { cmd, flags, rest };
}

async function cmdInit(flags: Record<string, string>): Promise<void> {
  const current = loadConfig();
  const next = applyHostSettings(
    defaultConfig({
      ...current,
      llm: {
        ...current.llm,
        model: flags.model || current.llm.model,
        baseUrl: flags["base-url"] || current.llm.baseUrl,
      },
    }),
    {
      hostname: flags.host,
      user: flags.user,
      port: flags.port,
      identityFile: flags.identity,
      name: flags.name,
    },
  );
  const file = saveConfig(next);
  const envFile = writeEnvExampleToHome();
  console.log(`Wrote ${file}`);
  console.log(`Env file ${envFile} (set OPENAI_API_KEY for chat)`);
  if (!next.host.hostname) {
    console.log("Still missing --host. Example:");
    console.log("  npx openbot init --host 203.0.113.10 --user ubuntu --identity ~/.ssh/id_ed25519");
  } else {
    console.log(`Host ${sshTarget(next)} — next: open Settings in the UI or start OpenHands on that machine`);
  }
}

async function cmdBind(): Promise<void> {
  const config = loadConfig();
  if (!config.host.hostname) {
    throw new Error("Run `npx openbot init --host …` first.");
  }
  console.log(`Binding ${sshTarget(config)} …`);
  const result = await bootstrapWorker(config);
  config.worker.token = result.token;
  config.worker.persist = result.persist;
  saveConfig(config);
  console.log(`SSH ok: ${result.uname}`);
  console.log(`Worker persist: ${result.persist}`);
  console.log(`Token stored in ${path.join(openbotHome(), "config.json")} (mode 0600)`);
  console.log("Laptop can now close. Jobs keep running on the host.");
  console.log("Next: npx openbot serve");
}

async function withWorker<T>(
  config: OpenBotConfig,
  fn: (worker: WorkerClient) => Promise<T>,
): Promise<T> {
  if (!config.worker.token) {
    throw new Error("No worker token. Run `npx openbot bind` first.");
  }
  const access = await ensureWorkerAccess(config);
  try {
    return await fn(access.worker);
  } finally {
    await access.tunnel?.stop();
  }
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  if (!config.host.hostname) {
    console.log("Not configured. Run npx openbot init");
    process.exitCode = 1;
    return;
  }
  const uname = await probeSsh(config);
  console.log(`SSH ${sshTarget(config)}`);
  console.log(uname);
  await withWorker(config, async (worker) => {
    const info = await worker.info();
    const jobs = await worker.listJobs();
    console.log(`Worker pid=${info.pid} persist=${config.worker.persist} host=${info.hostname}`);
    console.log(`Workspace ${info.workspace}`);
    console.log(`Jobs on host: ${jobs.length} (survive laptop disconnect)`);
  });
  await printOhHealth(config);
}

async function cmdServe(flags: Record<string, string>): Promise<void> {
  const config = loadConfig();
  if (flags.port) config.controlPlane.port = Number(flags.port);
  const hasWorker = Boolean(config.host.hostname && config.worker.token);
  const plane = await startControlPlane(
    config,
    hasWorker ? {} : { skipTunnel: true, allowWithoutWorker: true },
  );
  const url = `http://127.0.0.1:${config.controlPlane.port}`;
  console.log(`Local client  ${url}`);
  console.log(`Laptop trial  ${url}/oh-test`);
  console.log(`OpenHands     ${config.openhands.baseUrl}  (${config.openhands.sessionApiKey ? "session-key=set" : "session-key=unset"})`);
  console.log("Settings in the UI save host/user/key-path to ~/.openbot and open the tunnel.");
  if (hasWorker) {
    console.log(`Worker tunnel 127.0.0.1:${config.worker.localPort} → ${sshTarget(config)}:${config.worker.remotePort}`);
    console.log(`Persist on host: ${config.worker.persist}`);
  } else {
    console.log("Worker not bound — this is fine. One thread talks to OpenHands.");
    console.log("Set OH_BASE_URL / OH_SESSION_API_KEY (or ~/.openbot/.env).");
  }
  const shutdown = async () => {
    await plane.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function confirmDangerous(command: string): Promise<boolean> {
  const verdict = classifyCommand(command);
  if (!verdict.dangerous) return true;
  if (!process.stdin.isTTY) {
    throw new Error(`Refusing dangerous command without a TTY: ${verdict.reason}\n${command}`);
  }
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`Approval needed (${verdict.reason})\n  ${command}\nRun it? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function cmdRun(rest: string[]): Promise<void> {
  const command = rest.join(" ").trim();
  if (!command) throw new Error("Usage: npx openbot run 'uname -a'");
  if (!(await confirmDangerous(command))) {
    console.error("Denied.");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  await withWorker(config, async (worker) => {
    process.stderr.write(`→ ${sshTarget(config)} $ ${command}\n`);
    const { job, output } = await worker.runAndCollect(command, {
      onChunk: (chunk) => process.stdout.write(chunk),
    });
    if (!output.endsWith("\n") && output.length) process.stdout.write("\n");
    process.stderr.write(`[${job.status} exit=${job.exit_code} job=${job.id}]\n`);
    if (job.status !== "succeeded") process.exitCode = job.exit_code ?? 1;
  });
}

function ohClient(config: OpenBotConfig): OpenHandsClient {
  return OpenHandsClient.fromConfig(config);
}

async function printOhHealth(config: OpenBotConfig): Promise<boolean> {
  const client = ohClient(config);
  const probe = await client.health();
  const key = config.openhands.sessionApiKey ? "session-key=set" : "session-key=unset";
  if (probe.ok) {
    console.log(`OpenHands ${client.baseUrl} ok (${key})`);
    return true;
  }
  const err = (probe.raw as { error?: string })?.error || "not reachable";
  console.log(`OpenHands ${client.baseUrl} down (${key})`);
  console.log(`  ${err}`);
  console.log("  Tunnel: ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host");
  return false;
}

async function cmdOh(rest: string[], flags: Record<string, string>): Promise<void> {
  const sub = rest[0] || "help";
  const config = loadConfig();
  const client = ohClient(config);
  if (sub === "health") {
    const ok = await printOhHealth(config);
    if (!ok) process.exitCode = 1;
    return;
  }
  if (sub === "conversations" || sub === "ls") {
    const page = await client.listConversations({ limit: flags.limit ? Number(flags.limit) : 20 });
    if (!page.items.length) {
      console.log("No conversations.");
      return;
    }
    for (const c of page.items) {
      console.log(`${c.id}\t${c.executionStatus}\t${c.status}`);
    }
    return;
  }
  if (sub === "run") {
    const goal = rest.slice(1).join(" ").trim();
    if (!goal) throw new Error("Usage: npx openbot oh run 'uname -a and summarize'");
    const timeoutMs = flags.timeout ? Number(flags.timeout) * 1000 : 60_000;
    const pollMs = flags["poll-ms"] ? Number(flags["poll-ms"]) : 250;
    const wait = flags.wait !== "false" && flags["no-wait"] !== "true";
    process.stderr.write(`handoff → ${client.baseUrl}\n`);
    const delivery = await deliverConfirmedHandoff(client, { goal, threadId: flags.thread || "chat_default" }, config.openhands);
    const created = delivery.conversation;
    console.log(`conversation=${created.id} status=${created.executionStatus} mapped=${created.status}`);
    if (!created.id) throw new Error("OpenHands created a conversation without an id");
    if (!wait) return;
    const final = await client.pollConversation(created.id, { timeoutMs, pollMs });
    console.log(`conversation=${final.id} status=${final.executionStatus} mapped=${final.status}`);
    try {
      const events = await client.searchEvents(final.id, { limit: 50 });
      const snippet = conversationSnippet(events);
      if (snippet) {
        console.log("snippet:");
        console.log(snippet);
      }
    } catch {
      /* events endpoint optional on older OH */
    }
    if (remoteConversationFailed(final)) process.exitCode = 1;
    return;
  }
  if (sub === "help" || sub === "-h" || sub === "--help") {
    process.stdout.write(usage());
    return;
  }
  throw new Error(`Unknown oh subcommand: ${sub}\nTry: openbot oh health | conversations | run '<goal>'`);
}

async function confirmHandoff(goal: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`Hand this to the computer?\n  ${goal}\nConfirm? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function cmdChat(rest: string[], flags: Record<string, string>): Promise<void> {
  const message = rest.join(" ").trim();
  if (!message) throw new Error("Usage: npx openbot chat 'what kernel is on my machine?'");
  const config = loadConfig();
  const forceHandoff =
    flags.handoff === "true" || flags.computer === "true" || !hasLocalModelKey(config.llm.apiKey);
  const hasWorker = Boolean(config.host.hostname && config.worker.token);

  if (forceHandoff || !hasWorker) {
    const client = ohClient(config);
    const store = new HandoffStore();
    const timeoutMs = flags.timeout ? Number(flags.timeout) * 1000 : 60_000;
    const pollMs = flags["poll-ms"] ? Number(flags["poll-ms"]) : 250;
    const result = await runThreadTurn(message, {
      client,
      oh: config.openhands,
      llm: config.llm,
      store,
      emit: printThreadEvent,
      forceHandoff,
      timeoutMs,
      pollMs,
      threadId: flags.thread || "chat_default",
      language: config.language,
    });
    process.stdout.write("\n");
    if (result.path === "handoff" && remoteConversationFailed(result.conversation)) {
      process.exitCode = 1;
    }
    return;
  }

  await withWorker(config, async (worker) => {
    const result = await runThreadTurn(message, {
      client: ohClient(config),
      oh: config.openhands,
      llm: config.llm,
      worker,
      store: new HandoffStore(),
      emit: printThreadEvent,
      forceHandoff: false,
      language: config.language,
      waitForConfirm: async (proposal) => confirmHandoff(proposal.goal),
      waitForApproval: async (req) => confirmDangerous(req.command),
    });
    process.stdout.write("\n");
    if (result.path === "handoff" && remoteConversationFailed(result.conversation)) {
      process.exitCode = 1;
    }
  });
}

async function main(): Promise<void> {
  const { cmd, flags, rest } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "init":
      await cmdInit(flags);
      break;
    case "bind":
      await cmdBind();
      break;
    case "status":
      await cmdStatus();
      break;
    case "serve":
      await cmdServe(flags);
      break;
    case "run":
      await cmdRun(rest);
      break;
    case "chat":
      await cmdChat(rest, flags);
      break;
    case "eval": {
      const records = await runEvalSuite(loadEvalCases());
      const file = writeEvalSuiteRun(records);
      const failed = records.filter((r) => !r.pass);
      for (const r of records) {
        console.log(`${r.pass ? "pass" : "FAIL"}  ${r.caseId}  shown=${JSON.stringify(r.shown)}`);
      }
      console.log(`Wrote ${file}`);
      if (failed.length) process.exitCode = 1;
      break;
    }
    case "oh":
      await cmdOh(rest, flags);
      break;
    case "runtime":
      await cmdOh(rest.length ? rest : ["health"], flags);
      break;
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(usage());
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
});
