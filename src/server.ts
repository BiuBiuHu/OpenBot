import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { runAgentTurn } from "./agent.js";
import { classifyCommand } from "./approval.js";
import { loadConfig } from "./config.js";
import { repoRoot } from "./paths.js";
import { ensureWorkerAccess, type TunnelHandle } from "./tunnel.js";
import type { AgentEvent, ApprovalRequest, ChatMessage, OpenBotConfig } from "./types.js";
import { WorkerClient } from "./worker-client.js";

interface PendingApproval {
  req: ApprovalRequest;
  resolve: (allow: boolean) => void;
}

export interface ControlPlane {
  server: http.Server;
  config: OpenBotConfig;
  worker: WorkerClient;
  tunnel?: TunnelHandle;
  close: () => Promise<void>;
}

export async function startControlPlane(
  config: OpenBotConfig,
  opts: { skipTunnel?: boolean; worker?: WorkerClient } = {},
): Promise<ControlPlane> {
  let tunnel: TunnelHandle | undefined;
  let worker = opts.worker;
  if (!worker) {
    if (opts.skipTunnel) {
      worker = WorkerClient.fromPort(config.worker.localPort, config.worker.token);
    } else {
      const access = await ensureWorkerAccess(config);
      worker = access.worker;
      tunnel = access.tunnel;
    }
  }
  const approvals = new Map<string, PendingApproval>();
  let history: ChatMessage[] = [];

  const uiFile = path.join(repoRoot(), "src/ui/index.html");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(uiFile));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        await json(res, await statusPayload(config, worker));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/jobs") {
        await json(res, { ok: true, jobs: await worker.listJobs() });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
        const id = url.pathname.split("/")[3];
        await json(res, await worker.getJob(id));
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
        await streamSse(req, res, async (emit) => {
          await runDirect(command, worker, approvals, emit);
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(req);
        const message = String(body.message || "").trim();
        if (!message) {
          await json(res, { ok: false, error: "message required" }, 400);
          return;
        }
        await streamSse(req, res, async (emit) => {
          const next = await runAgentTurn(message, {
            worker,
            llm: loadConfig().llm,
            history,
            emit,
            waitForApproval: (req) =>
              new Promise<boolean>((resolve) => {
                approvals.set(req.id, { req, resolve });
              }),
          });
          history = next.slice(-40);
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

async function statusPayload(config: OpenBotConfig, worker: WorkerClient) {
  const healthy = await worker.health();
  let info = null;
  let error: string | undefined;
  if (healthy) {
    try {
      info = await worker.info();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else {
    error = "worker not reachable — is the SSH tunnel up? run `npx openbot bind` then `npx openbot serve`.";
  }
  return {
    ok: healthy,
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
      hasKey: Boolean(config.llm.apiKey),
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
