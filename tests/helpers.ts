import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "../src/paths.js";
import { WorkerClient } from "../src/worker-client.js";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("could not allocate port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

export async function startWorker(): Promise<{
  client: WorkerClient;
  port: number;
  home: string;
  token: string;
  stop: () => void;
}> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-worker-"));
  const port = await freePort();
  const token = `t_${port}_${process.pid}`;
  const workerPy = path.join(repoRoot(), "worker/worker.py");
  const child: ChildProcess = spawn("python3", [workerPy], {
    env: {
      ...process.env,
      OPENBOT_WORKER_HOME: home,
      OPENBOT_WORKER_PORT: String(port),
      OPENBOT_WORKER_TOKEN: token,
      OPENBOT_WORKSPACE: path.join(home, "workspace"),
      OPENBOT_WORKER_BIND: "127.0.0.1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const client = WorkerClient.fromPort(port, token);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await client.health()) {
      return {
        client,
        port,
        home,
        token,
        stop: () => {
          child.kill("SIGTERM");
          fs.rmSync(home, { recursive: true, force: true });
        },
      };
    }
    if (child.exitCode !== null) {
      throw new Error(`worker exited ${child.exitCode}`);
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  child.kill("SIGKILL");
  throw new Error("worker did not become healthy");
}
