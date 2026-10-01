import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { classifyCommand } from "./approval.js";
import { hasLocalModelKey, loadConfig } from "./config.js";
import { deliverConfirmedHandoff, HandoffStore, runHandoffTurn } from "./handoff.js";
import { conversationSnippet, OpenHandsClient } from "./oh-client.js";
import { repoRoot } from "./paths.js";
import { runThreadTurn } from "./thread.js";
import { ensureWorkerAccess, type TunnelHandle } from "./tunnel.js";
import type { AgentEvent, ApprovalRequest, ChatMessage, HandoffProposal, OpenBotConfig } from "./types.js";
import { WorkerClient } from "./worker-client.js";

interface PendingApproval {
  req: ApprovalRequest;
  resolve: (allow: boolean) => void;
}

export interface ControlPlane {
  server: http.Server;
  config: OpenBotConfig;
  worker?: WorkerClient;
  tunnel?: TunnelHandle;
  close: () => Promise<void>;
}

export async function startControlPlane(
  config: OpenBotConfig,
  opts: { skipTunnel?: boolean; worker?: WorkerClient; allowWithoutWorker?: boolean } = {},
): Promise<ControlPlane> {
  let tunnel: TunnelHandle | undefined;
  let worker = opts.worker;
  if (!worker) {
    if (opts.allowWithoutWorker) {
      worker = undefined;
    } else if (opts.skipTunnel) {
      worker = WorkerClient.fromPort(config.worker.localPort, config.worker.token);
    } else {
      const access = await ensureWorkerAccess(config);
      worker = access.worker;
      tunnel = access.tunnel;
    }
  }
  const approvals = new Map<string, PendingApproval>();
  const handoffs = new HandoffStore();
  const handoffWaiters = new Map<string, (allow: boolean) => void>();
  const threadConversations = new Map<string, string>();
  const oh = OpenHandsClient.fromConfig(config);
  let history: ChatMessage[] = [];

  const uiFile = path.join(repoRoot(), "src/ui/index.html");
  const trialFile = path.join(repoRoot(), "src/ui/oh-test.html");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(uiFile));
        return;
      }
      if (req.method === "GET" && (url.pathname === "/oh-test" || url.pathname === "/oh-test.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(trialFile));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/oh/health") {
        const probe = await oh.health();
        await json(res, {
          ok: probe.ok,
          baseUrl: config.openhands.baseUrl,
          hasSessionKey: Boolean(config.openhands.sessionApiKey),
          raw: probe.raw,
          hint: probe.ok
            ? undefined
            : "在笔记本上先开：ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host，并把 OH_SESSION_API_KEY 写入 ~/.openbot/.env 或仓库外的 .env",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        await json(res, await statusPayload(config, worker, oh));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/jobs") {
        if (!worker) {
          await json(res, { ok: true, jobs: [], error: "worker not bound" });
          return;
        }
        await json(res, { ok: true, jobs: await worker.listJobs() });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
        if (!worker) {
          await json(res, { ok: false, error: "worker not bound" }, 404);
          return;
        }
        const id = url.pathname.split("/")[3];
        await json(res, await worker.getJob(id));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/conversations") {
        try {
          const page = await oh.listConversations({ limit: 20 });
          await json(res, {
            ok: true,
            conversations: page.items.map((c) => ({
              id: c.id,
              execution_status: c.executionStatus,
              status: c.status,
            })),
          });
        } catch (err) {
          await json(res, {
            ok: false,
            conversations: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/conversations/")) {
        const id = url.pathname.split("/")[3];
        if (!id) {
          await json(res, { ok: false, error: "conversation id required" }, 400);
          return;
        }
        try {
          const conv = await oh.getConversation(id);
          let snippet = "";
          try {
            snippet = conversationSnippet(await oh.searchEvents(id, { limit: 50 }));
          } catch {
            /* events optional */
          }
          await json(res, {
            ok: true,
            conversation: {
              id: conv.id,
              execution_status: conv.executionStatus,
              status: conv.status,
            },
            snippet,
          });
        } catch (err) {
          await json(res, { ok: false, error: err instanceof Error ? err.message : String(err) }, 404);
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/handoffs/stream") {
        const body = await readJson(req);
        const goal = String(body.goal || body.message || "").trim();
        if (!goal) {
          await json(res, { ok: false, error: "goal required" }, 400);
          return;
        }
        const threadId = String(body.thread_id || body.threadId || "chat_default");
        await streamSse(req, res, async (emit) => {
          const conversation = await runHandoffTurn(goal, {
            client: oh,
            oh: config.openhands,
            store: handoffs,
            emit,
            timeoutMs: typeof body.timeout_ms === "number" ? body.timeout_ms : 60_000,
            pollMs: typeof body.poll_ms === "number" ? body.poll_ms : 250,
            threadId,
            conversationId: threadConversations.get(threadId),
          });
          if (conversation?.id) threadConversations.set(threadId, conversation.id);
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/handoffs") {
        const body = await readJson(req);
        const result = await handleHandoff(body, undefined, handoffs, oh, config, handoffWaiters);
        await json(res, result, result.ok ? 200 : 400);
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/handoffs/")) {
        const id = url.pathname.split("/")[3];
        const body = await readJson(req);
        const result = await handleHandoff(body, id, handoffs, oh, config, handoffWaiters);
        await json(res, result, result.ok ? 200 : 400);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/approve") {
        const body = await readJson(req);
        const id = String(body.id || "");
        const pending = approvals.get(id);
        if (!pending) {
          await json(res, { ok: false, error: "no such approval" }, 404);
          return;
        }
        pending.resolve(Boolean(body.allow));
        approvals.delete(id);
        await json(res, { ok: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        const body = await readJson(req);
        const command = String(body.command || "").trim();
        if (!command) {
          await json(res, { ok: false, error: "command required" }, 400);
          return;
        }
        if (!worker) {
          await json(res, { ok: false, error: "worker not bound — use This computer (OH handoff) or `openbot bind`" }, 400);
          return;
        }
        const boundWorker = worker;
        await streamSse(req, res, async (emit) => {
          await runDirect(command, boundWorker, approvals, emit);
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(req);
        const message = String(body.message || body.goal || "").trim();
        if (!message) {
          await json(res, { ok: false, error: "message required" }, 400);
          return;
        }
        const live = loadConfig();
        const forceHandoff =
          !hasLocalModelKey(live.llm.apiKey) ||
          body.handoff === true ||
          body.handoff === "true" ||
          body.mode === "handoff" ||
          body.mode === "computer";
        const threadId = String(body.thread_id || body.threadId || "chat_default");
        await streamSse(req, res, async (emit) => {
          const result = await runThreadTurn(message, {
            client: oh,
            oh: live.openhands,
            llm: live.llm,
            worker,
            store: handoffs,
            history,
            emit,
            forceHandoff,
            timeoutMs: typeof body.timeout_ms === "number" ? body.timeout_ms : 60_000,
            pollMs: typeof body.poll_ms === "number" ? body.poll_ms : 250,
            threadId,
            conversationId: threadConversations.get(threadId),
            waitForApproval: (req) =>
              new Promise<boolean>((resolve) => {
                approvals.set(req.id, { req, resolve });
              }),
          });
          history = result.history.slice(-40);
          if (result.conversation?.id) threadConversations.set(threadId, result.conversation.id);
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.controlPlane.port, "127.0.0.1", () => resolve());
  });

  return {
    server,
    config,
    worker,
    tunnel,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await tunnel?.stop();
    },
  };
}

async function handleHandoff(
  body: Record<string, unknown>,
  pathId: string | undefined,
  store: HandoffStore,
  oh: OpenHandsClient,
  config: OpenBotConfig,
  waiters?: Map<string, (allow: boolean) => void>,
): Promise<Record<string, unknown>> {
  const allow = body.allow;
  const goal = String(body.goal || "").trim();
  const reason = String(body.reason || "");
  const threadId = String(body.thread_id || body.threadId || "chat_default");
  const id = pathId || (body.id ? String(body.id) : "");

  if (id && waiters?.has(id) && (allow === true || allow === false || allow === "true" || allow === "false")) {
    const waiter = waiters.get(id);
    waiters.delete(id);
    waiter?.(allow === true || allow === "true");
    return { ok: true, stream: true, allow: allow === true || allow === "true" };
  }

  if (allow === false) {
    const denied = id ? store.deny(id) : undefined;
    return { ok: true, denied: true, id: denied?.id || id || null };
  }

  if (allow === true || allow === "true") {
    const pending = id ? store.take(id) : undefined;
    const nextGoal = pending?.goal || goal;
    if (!nextGoal) {
      return { ok: false, error: "no such handoff or goal" };
    }
    const delivery = await deliverConfirmedHandoff(
      oh,
      {
        id: pending?.id || id || undefined,
        goal: nextGoal,
        reason: pending?.reason || reason,
        threadId: pending?.threadId || threadId,
      },
      config.openhands,
    );
    return {
      ok: true,
      proposal: delivery.proposal,
      conversation: {
        id: delivery.conversation.id,
        execution_status: delivery.conversation.executionStatus,
        status: delivery.conversation.status,
      },
    };
  }

  if (!goal) {
    return { ok: false, error: "goal required to propose a handoff" };
  }
  const proposal = store.propose({ id: id || undefined, goal, reason, threadId });
  return { ok: true, needs_confirm: true, proposal };
}

async function statusPayload(config: OpenBotConfig, worker: WorkerClient | undefined, oh: OpenHandsClient) {
  const healthy = worker ? await worker.health() : false;
  let info = null;
  let error: string | undefined;
  if (healthy && worker) {
    try {
      info = await worker.info();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (worker) {
    error = "worker not reachable — is the SSH tunnel up? run `npx openbot bind` then `npx openbot serve`.";
  }
  const ohProbe = await oh.health();
  if (!ohProbe.ok && !healthy) {
    error =
      error ||
      ((ohProbe.raw as { error?: string })?.error ||
        "OpenHands not reachable — ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host then retry. Worker bind is optional for this path.");
  }
  return {
    ok: ohProbe.ok || healthy,
    slogan: "SSH your own machine. The agent gets a computer — you keep the keys.",
    host: {
      name: config.host.name,
      hostname: config.host.hostname,
      user: config.host.user,
      port: config.host.port,
    },
    persist: config.worker.persist,
    llm: {
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
      hasKey: hasLocalModelKey(config.llm.apiKey),
    },
    openhands: {
      baseUrl: config.openhands.baseUrl,
      ok: ohProbe.ok,
      hasSessionKey: Boolean(config.openhands.sessionApiKey),
      error: ohProbe.ok ? undefined : ((ohProbe.raw as { error?: string })?.error || "not reachable"),
    },
    info,
    error,
  };
}

async function runDirect(
  command: string,
  worker: WorkerClient,
  approvals: Map<string, PendingApproval>,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const verdict = classifyCommand(command);
  if (verdict.dangerous) {
    const id = `appr_${Date.now().toString(36)}`;
    emit({ type: "approval", id, command, reason: verdict.reason });
    const allowed = await new Promise<boolean>((resolve) => {
      approvals.set(id, { req: { id, command, reason: verdict.reason }, resolve });
    });
    if (!allowed) {
      emit({ type: "error", message: `Denied: ${verdict.reason}` });
      emit({ type: "done" });
      return;
    }
  }
  emit({ type: "tool_start", name: "run_shell", args: { command } });
  const { job, output } = await worker.runAndCollect(command, {
    onChunk: (chunk, current) => {
      emit({ type: "job", job: current });
      emit({ type: "output", jobId: current.id, chunk });
    },
  });
  emit({ type: "job", job });
  emit({ type: "tool_result", name: "run_shell", result: output || `(exit ${job.exit_code})` });
  emit({ type: "done" });
}

async function json(res: http.ServerResponse, body: unknown, status = 200): Promise<void> {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {};
}

async function streamSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  work: (emit: (event: AgentEvent) => void) => Promise<void>,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const emit = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  req.on("close", () => {
    /* client left; jobs keep running on the remote worker */
  });
  try {
    await work(emit);
  } catch (err) {
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    emit({ type: "done" });
  } finally {
    res.end();
  }
}
