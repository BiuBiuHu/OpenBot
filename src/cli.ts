#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { classifyCommand } from "./approval.js";
import { defaultConfig, loadConfig, saveConfig, writeEnvExampleToHome } from "./config.js";
import { openbotHome } from "./paths.js";
import { startControlPlane } from "./server.js";
import { bootstrapWorker, probeSsh, sshTarget } from "./ssh.js";
import type { AgentEvent, OpenBotConfig } from "./types.js";
import { WorkerClient } from "./worker-client.js";
import { ensureWorkerAccess } from "./tunnel.js";
import { runAgentTurn } from "./agent.js";

function usage(): string {
  return `OpenBot — SSH your own machine. The agent gets a computer — you keep the keys.

Usage:
  npx openbot init [--host HOST] [--user USER] [--port N] [--identity FILE]
                   [--name NAME] [--model MODEL] [--base-url URL]
  npx openbot bind              Install/start the worker on the remote host
  npx openbot status            SSH + worker health
  npx openbot serve [--port N]  Local control plane + SSH tunnel + chat UI
  npx openbot run <command>     Run a command on the remote host (no LLM)
  npx openbot chat [message]    One-shot BYOK chat that uses remote tools
  npx openbot help

Config lives in ~/.openbot (never commit it). API keys go in ~/.openbot/.env.
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
  const next = defaultConfig({
    ...current,
    host: {
      ...current.host,
      hostname: flags.host || current.host.hostname,
      user: flags.user || current.host.user,
      port: flags.port ? Number(flags.port) : current.host.port,
      identityFile: flags.identity || current.host.identityFile,
      name: flags.name || current.host.name,
    },
    llm: {
      ...current.llm,
      model: flags.model || current.llm.model,
      baseUrl: flags["base-url"] || current.llm.baseUrl,
    },
  });
  const file = saveConfig(next);
  const envFile = writeEnvExampleToHome();
  console.log(`Wrote ${file}`);
  console.log(`Env file ${envFile} (set OPENAI_API_KEY for chat)`);
  if (!next.host.hostname) {
    console.log("Still missing --host. Example:");
    console.log("  npx openbot init --host 203.0.113.10 --user ubuntu --identity ~/.ssh/id_ed25519");
  } else {
    console.log(`Host ${sshTarget(next)} — next: npx openbot bind`);
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
}

async function cmdServe(flags: Record<string, string>): Promise<void> {
  const config = loadConfig();
  if (!config.host.hostname || !config.worker.token) {
    throw new Error("Run `npx openbot init` and `npx openbot bind` first.");
  }
  if (flags.port) config.controlPlane.port = Number(flags.port);
  const plane = await startControlPlane(config);
  const url = `http://127.0.0.1:${config.controlPlane.port}`;
  console.log(`Control plane ${url}`);
  console.log(`Tunnel 127.0.0.1:${config.worker.localPort} → ${sshTarget(config)}:${config.worker.remotePort}`);
  console.log(`Persist on host: ${config.worker.persist}`);
  console.log("Close this laptop whenever. The worker stays on the remote machine.");
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

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "token":
      process.stdout.write(event.text);
      break;
    case "tool_start":
      process.stderr.write(`\n▸ ${event.name} ${JSON.stringify(event.args)}\n`);
      break;
    case "output":
      process.stdout.write(event.chunk);
      break;
    case "error":
      process.stderr.write(`\nerror: ${event.message}\n`);
      break;
    case "approval":
      process.stderr.write(`\napproval: ${event.reason}\n  ${event.command}\n`);
      break;
    default:
      break;
  }
}

async function cmdChat(rest: string[]): Promise<void> {
  const message = rest.join(" ").trim();
  if (!message) throw new Error("Usage: npx openbot chat 'what kernel is on my machine?'");
  const config = loadConfig();
  await withWorker(config, async (worker) => {
    await runAgentTurn(message, {
      worker,
      llm: config.llm,
      emit: printEvent,
      waitForApproval: async (req) => confirmDangerous(req.command),
    });
    process.stdout.write("\n");
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
      await cmdChat(rest);
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
