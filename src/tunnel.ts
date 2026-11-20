import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import type { OpenBotConfig } from "./types.js";
import { identityPath } from "./config.js";
import { sshTarget } from "./ssh.js";
import { WorkerClient } from "./worker-client.js";

export interface TunnelHandle {
  localPort: number;
  process: ChildProcess;
  stop: () => Promise<void>;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export async function ensureWorkerAccess(config: OpenBotConfig): Promise<{
  worker: WorkerClient;
  tunnel?: TunnelHandle;
}> {
  const ports = new Set<number>([config.worker.localPort, config.worker.remotePort]);
  for (const port of ports) {
    const client = WorkerClient.fromPort(port, config.worker.token);
    if (await client.health()) {
      return { worker: client };
    }
  }
  if (isLoopback(config.host.hostname)) {
    throw new Error(
      `Worker is not reachable on 127.0.0.1:${config.worker.remotePort}. Re-run \`npx openbot bind\`.`,
    );
  }
  const tunnel = await openTunnel(config);
  const worker = WorkerClient.fromPort(config.worker.localPort, config.worker.token);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await worker.health()) return { worker, tunnel };
    await new Promise((r) => setTimeout(r, 200));
  }
  await tunnel.stop();
  throw new Error("Tunnel is up but the worker did not answer /health. Re-run bind.");
}

export function openHandsLocalPort(baseUrl: string, fallback = 8000): number {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) return Number(parsed.port);
    if (parsed.protocol === "https:") return 443;
    return fallback;
  } catch {
    return fallback;
  }
}

export async function openTunnel(config: OpenBotConfig): Promise<TunnelHandle> {
  return openLocalForward(config, {
    localPort: config.worker.localPort,
    remotePort: config.worker.remotePort,
  });
}

/** ssh -L 127.0.0.1:local:127.0.0.1:remote using the saved host + identity path. */
export async function openLocalForward(
  config: OpenBotConfig,
  spec: { localPort: number; remotePort: number; connectTimeoutSec?: number },
): Promise<TunnelHandle> {
  const localPort = spec.localPort;
  const remotePort = spec.remotePort;
  const args = [
    "-N",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=20",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `ConnectTimeout=${spec.connectTimeoutSec ?? 20}`,
    "-p",
    String(config.host.port || 22),
  ];
  const identity = identityPath(config);
  if (identity) {
    args.push("-o", "IdentitiesOnly=yes", "-i", identity);
  }
  args.push(sshTarget(config));

  const child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  // A live SSH process may still be authenticating. Wait for the local listener,
  // then let callers verify the actual remote service and its identity.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: net.Socket | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(retry);
      socket?.destroy();
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error) { child.kill("SIGKILL"); reject(error); }
      else resolve();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) => finish(new Error(`SSH tunnel exited (${code}): ${stderr.trim() || "no stderr"}`));
    const deadline = setTimeout(() => finish(new Error("SSH tunnel did not become ready before timeout")), ((spec.connectTimeoutSec ?? 20) + 5) * 1000);
    child.once("error", onError);
    child.once("exit", onExit);
    const probe = () => {
      if (settled) return;
      socket = net.connect({ host: "127.0.0.1", port: localPort });
      socket.setTimeout(250);
      socket.once("connect", () => finish());
      const again = () => {
        socket?.destroy();
        if (!settled) retry = setTimeout(probe, 100);
      };
      socket.once("error", again);
      socket.once("timeout", again);
    };
    probe();
  });

  return {
    localPort,
    process: child,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1500);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
