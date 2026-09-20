import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runAgentTurn } from "../src/agent.js";
import { defaultConfig } from "../src/config.js";
import { repoRoot } from "../src/paths.js";
import { startControlPlane } from "../src/server.js";
import { startWorker, freePort } from "./helpers.js";

describe("local control plane + worker (no fake remote)", () => {
  let worker: Awaited<ReturnType<typeof startWorker>>;
  let plane: Awaited<ReturnType<typeof startControlPlane>>;
  const prevHome = process.env.OPENBOT_HOME;
  const prevKey = process.env.OPENAI_API_KEY;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-e2e-"));

  before(async () => {
    process.env.OPENBOT_HOME = home;
    delete process.env.OPENAI_API_KEY;
    worker = await startWorker();
    const config = defaultConfig();
    config.host.hostname = "127.0.0.1";
    config.host.user = process.env.USER || "ubuntu";
    config.worker.token = worker.token;
    config.worker.localPort = worker.port;
    config.controlPlane.port = await freePort();
    plane = await startControlPlane(config, { skipTunnel: true, worker: worker.client });
  });

  after(async () => {
    await plane?.close();
    worker?.stop();
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-UI-001: serves the remote-control page", async () => {
    const port = plane.config.controlPlane.port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /OpenBot/);
    assert.match(html, /SSH your own machine/);
    assert.match(html, /Run on host/);
  });

  it("TC-REMOTE-001 via /api/run: uname streams from worker", async () => {
    const port = plane.config.controlPlane.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "uname -a" }),
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Linux/);
    assert.match(body, /"type":"done"/);
  });

  it("TC-BYOK-001: chat without a key does not call a model", async () => {
    const events: string[] = [];
    await runAgentTurn("what kernel?", {
      worker: worker.client,
      llm: { baseUrl: "http://127.0.0.1:9", model: "none", apiKey: "" },
      emit: (e) => events.push(e.type),
      waitForApproval: async () => false,
    });
    assert.ok(events.includes("error"));
    assert.ok(events.includes("done"));
  });

  it("TC-APPR-003: CLI refuses dangerous commands without a TTY", async () => {
    const cli = path.join(repoRoot(), "src/cli.ts");
    const child = spawn(process.execPath, ["--import", "tsx", cli, "run", "sudo reboot"], {
      env: { ...process.env, OPENBOT_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    const code: number = await new Promise((resolve) => {
      child.on("close", (n) => resolve(n ?? 1));
    });
    assert.notEqual(code, 0);
    assert.match(stderr, /Refusing dangerous command|dangerous/i);
  });
});
