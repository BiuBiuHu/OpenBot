import { spawn, type ChildProcess } from "node:child_process";
import type { OpenBotConfig } from "./types.js";
import { identityPath } from "./config.js";
import { sshTarget } from "./ssh.js";

export interface TunnelHandle {
  localPort: number;
  process: ChildProcess;
  stop: () => Promise<void>;
}

export async function openTunnel(config: OpenBotConfig): Promise<TunnelHandle> {
  const localPort = config.worker.localPort;
  const remotePort = config.worker.remotePort;
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
    "ConnectTimeout=20",
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

  await new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      // -N has no "ready" line; if it is still alive after a beat, the forward is up.
      if (child.exitCode === null) resolve();
      else fail(new Error(`SSH tunnel exited: ${stderr || child.exitCode}`));
    }, 600);
    child.once("error", (err) => fail(err));
    child.once("exit", (code) => {
      fail(new Error(`SSH tunnel exited (${code}): ${stderr.trim() || "no stderr"}`));
    });
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
