import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  applyHostSettings,
  assertIdentityPath,
  defaultConfig,
  loadConfig,
  nextStepForConnect,
  publicSettings,
  saveConfig,
  upsertHomeEnv,
} from "../src/config.js";
import { connectConfiguredHost } from "../src/connect.js";
import { startControlPlane } from "../src/server.js";
import { openHandsLocalPort } from "../src/tunnel.js";
import { freePort } from "./helpers.js";
import { startMockOhServer } from "./oh-mock.js";

describe("settings (no live host)", { concurrency: false }, () => {
describe("host settings (no live SSH)", () => {
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-settings-"));

  before(() => {
    process.env.OPENBOT_HOME = home;
    delete process.env.OH_SESSION_API_KEY;
    delete process.env.OPENHANDS_API_KEY;
  });

  after(() => {
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-SET-001: identity must be a path, not a pasted key", () => {
    assert.equal(assertIdentityPath("~/.ssh/id_ed25519"), "~/.ssh/id_ed25519");
    assert.throws(
      () =>
        assertIdentityPath(
          "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
        ),
      /path/,
    );
    assert.throws(() => applyHostSettings(defaultConfig(), { identityFile: "-----BEGIN RSA PRIVATE KEY-----" }), /path/);
  });

  it("TC-SET-002: apply + save stores host fields under ~/.openbot, never key material", () => {
    const keyPath = path.join(home, "laptop-id");
    const next = applyHostSettings(defaultConfig(), {
      hostname: "192.0.2.10",
      user: "alice",
      port: 2222,
      identityFile: keyPath,
    });
    const file = saveConfig(next);
    assert.equal(file, path.join(home, "config.json"));
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, /192\.0\.2\.10/);
    assert.match(raw, /alice/);
    assert.match(raw, /2222/);
    assert.match(raw, /laptop-id/);
    assert.doesNotMatch(raw, /BEGIN [A-Z0-9 ]*PRIVATE KEY/);
    const published = publicSettings(loadConfig());
    assert.equal(published.language, "zh-CN");
    assert.equal(published.host.hostname, "192.0.2.10");
    assert.equal(published.host.identityFile, keyPath);
    assert.equal("sessionApiKey" in published.openhands, false);
    assert.equal("apiKey" in published, false);
  });

  it("TC-SET-003: session key goes to ~/.openbot/.env, not the response", () => {
    upsertHomeEnv({ OH_SESSION_API_KEY: "session-from-ui" });
    const envFile = path.join(home, ".env");
    const body = fs.readFileSync(envFile, "utf8");
    assert.match(body, /OH_SESSION_API_KEY=session-from-ui/);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  });

  it("TC-SET-004: next step when OpenHands is missing on a reachable host", () => {
    const missing = nextStepForConnect({
      hasHost: true,
      sshOk: true,
      ohOk: false,
      hasSessionKey: false,
    });
    assert.equal(missing.ready, false);
    assert.match(missing.nextStep, /openhands-agent-server-trial/);
    assert.match(missing.nextStep, /systemctl enable --now openhands-agent-server/);
    assert.match(missing.nextStep, /optional for chat/);
    const ready = nextStepForConnect({
      hasHost: true,
      sshOk: true,
      ohOk: true,
      hasSessionKey: true,
    });
    assert.equal(ready.ready, true);
    const noHost = nextStepForConnect({
      hasHost: false,
      sshOk: false,
      ohOk: false,
      hasSessionKey: false,
    });
    assert.match(noHost.nextStep, /Settings/);
    const noFile = nextStepForConnect({
      hasHost: true,
      identityFile: "~/.ssh/missing",
      identityMissing: true,
      sshOk: false,
      ohOk: false,
      hasSessionKey: false,
    });
    assert.match(noFile.nextStep, /not found/);
    const leftover = nextStepForConnect({
      hasHost: true,
      sshOk: false,
      ohOk: true,
      hasSessionKey: true,
    });
    assert.equal(leftover.ready, false);
    assert.match(leftover.nextStep, /SSH did not connect/);
  });

  it("TC-SET-009: language is saved under ~/.openbot and defaults to zh-CN", () => {
    const cfg = defaultConfig();
    assert.equal(cfg.language, "zh-CN");
    const next = applyHostSettings(cfg, { language: "en" });
    const file = saveConfig(next);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, /"language": "en"/);
    assert.equal(loadConfig().language, "en");
    assert.equal(publicSettings(loadConfig()).language, "en");
    const back = applyHostSettings(loadConfig(), { language: "zh-CN" });
    saveConfig(back);
    assert.equal(loadConfig().language, "zh-CN");
  });

  it("TC-SET-005: OpenHands local forward port comes from baseUrl", () => {
    assert.equal(openHandsLocalPort("http://127.0.0.1:8000"), 8000);
    assert.equal(openHandsLocalPort("http://127.0.0.1:18000"), 18000);
  });
});

describe("settings HTTP (mocked OH, no live host)", { concurrency: false }, () => {
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-set-http-"));
  let mock: Awaited<ReturnType<typeof startMockOhServer>>;
  let plane: Awaited<ReturnType<typeof startControlPlane>>;

  before(async () => {
    process.env.OPENBOT_HOME = home;
    delete process.env.OH_SESSION_API_KEY;
    mock = await startMockOhServer({ sessionKey: "set-key" });
    const config = defaultConfig();
    config.controlPlane.port = await freePort();
    config.openhands.baseUrl = mock.baseUrl;
    config.openhands.sessionApiKey = "set-key";
    plane = await startControlPlane(config, { skipTunnel: true, allowWithoutWorker: true });
  });

  after(async () => {
    await plane?.close();
    await mock?.stop();
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-SET-006: GET/POST /api/settings persist path-only identity; reject pasted keys", async () => {
    process.env.OPENBOT_HOME = home;
    const port = plane.config.controlPlane.port;
    const origin = `http://127.0.0.1:${port}`;
    const html = await (await fetch(`${origin}/`)).text();
    assert.match(html, /Settings/);
    assert.match(html, /id="set-language"/);
    assert.match(html, /简体中文/);
    assert.doesNotMatch(html, /<select id="mode"/);

    const rejected = await (
      await fetch(`${origin}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: "192.0.2.8",
          identityFile: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
          connect: false,
        }),
      })
    ).json() as { ok?: boolean; error?: string };
    assert.equal(rejected.ok, false);
    assert.match(String(rejected.error), /path/);

    const saved = await (
      await fetch(`${origin}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: "192.0.2.8",
          user: "deploy",
          port: 22,
          identityFile: "~/.ssh/id_ed25519",
          sessionApiKey: "new-session",
          language: "zh-CN",
          connect: false,
        }),
      })
    ).json() as {
      ok?: boolean;
      host?: { hostname?: string; user?: string; identityFile?: string };
      openhands?: { hasSessionKey?: boolean; sessionApiKey?: string };
      connect?: { nextStep?: string };
    };
    assert.equal(saved.ok, true);
    assert.equal((saved as { language?: string }).language, "zh-CN");
    assert.equal(saved.host?.hostname, "192.0.2.8");
    assert.equal(saved.host?.user, "deploy");
    assert.equal(saved.host?.identityFile, "~/.ssh/id_ed25519");
    assert.equal(saved.openhands?.sessionApiKey, undefined);
    assert.equal(saved.openhands?.hasSessionKey, true);
    assert.match(String(saved.connect?.nextStep || ""), /./);

    const got = await (await fetch(`${origin}/api/settings`)).json() as {
      host?: { hostname?: string };
      openhands?: { sessionApiKey?: string; hasSessionKey?: boolean };
    };
    assert.equal(got.host?.hostname, "192.0.2.8");
    assert.equal(got.openhands?.sessionApiKey, undefined);
    const dumped = JSON.stringify(got);
    assert.doesNotMatch(dumped, /new-session/);
    assert.doesNotMatch(dumped, /BEGIN /);
    const envBody = fs.readFileSync(path.join(home, ".env"), "utf8");
    assert.match(envBody, /OH_SESSION_API_KEY=new-session/);
  });

  it("TC-SET-007: leftover local OpenHands is not ready when SSH to the saved host fails", async () => {
    const config = defaultConfig();
    config.host.hostname = "192.0.2.1";
    config.host.user = "demo";
    config.openhands.baseUrl = mock.baseUrl;
    config.openhands.sessionApiKey = "set-key";
    const result = await connectConfiguredHost(config, { timeoutMs: 400, skipTunnel: true });
    assert.equal(result.ssh.ok, false);
    assert.equal(result.openhands.ok, false);
    assert.equal(result.ready, false);
    assert.match(result.nextStep, /SSH did not connect/);
  });

  it("TC-SET-008: /api/status does not call leftover local OpenHands ready after a remote host is saved", async () => {
    process.env.OPENBOT_HOME = home;
    const origin = `http://127.0.0.1:${plane.config.controlPlane.port}`;
    const keyPath = path.join(home, "dummy-id");
    fs.writeFileSync(keyPath, "not-a-secret\n", { mode: 0o600 });
    const saved = (await (
      await fetch(`${origin}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: "192.0.2.9",
          user: "demo",
          port: 22,
          identityFile: keyPath,
          connect: false,
        }),
      })
    ).json()) as { ok?: boolean };
    assert.equal(saved.ok, true);
    const status = (await (await fetch(`${origin}/api/status`)).json()) as {
      ready?: boolean;
      nextStep?: string;
      openhands?: { ok?: boolean };
    };
    assert.equal(status.ready, false);
    assert.equal(status.openhands?.ok, false);
    assert.match(String(status.nextStep || ""), /SSH did not connect/);
  });
});
});
