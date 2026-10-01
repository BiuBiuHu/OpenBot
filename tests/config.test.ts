import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { defaultConfig, parseEnvFile, saveConfig, configPath } from "../src/config.js";

describe("REQ-OPENBOT-007 config isolation", () => {
  const prev = process.env.OPENBOT_HOME;
  const prevOh = {
    OPENHANDS_BASE_URL: process.env.OPENHANDS_BASE_URL,
    OPENHANDS_API_KEY: process.env.OPENHANDS_API_KEY,
    OH_SESSION_API_KEY: process.env.OH_SESSION_API_KEY,
    OH_BASE_URL: process.env.OH_BASE_URL,
  };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-home-"));

  before(() => {
    process.env.OPENBOT_HOME = home;
    delete process.env.OPENHANDS_BASE_URL;
    delete process.env.OPENHANDS_API_KEY;
    delete process.env.OH_SESSION_API_KEY;
    delete process.env.OH_BASE_URL;
  });

  after(() => {
    if (prev === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prev;
    for (const [key, value] of Object.entries(prevOh)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-CFG-001: parseEnvFile ignores comments and writes 0600 config", () => {
    const parsed = parseEnvFile("# hi\nOPENAI_API_KEY=\nOPENAI_MODEL=gpt-4o-mini\n");
    assert.equal(parsed.OPENAI_API_KEY, "");
    assert.equal(parsed.OPENAI_MODEL, "gpt-4o-mini");

    const cfg = defaultConfig();
    assert.equal(cfg.openhands.baseUrl, "http://127.0.0.1:8000");
    assert.equal(cfg.openhands.workspaceDir, "workspace/project");
    cfg.host.hostname = "203.0.113.10";
    const file = saveConfig(cfg);
    assert.equal(file, configPath());
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, /203\.0\.113\.10/);
    assert.equal(path.dirname(file).startsWith(home), true);
  });

  it("TC-CFG-002: OH_BASE_URL / OH_SESSION_API_KEY win over OPENHANDS_* aliases", () => {
    process.env.OH_BASE_URL = "http://127.0.0.1:18000";
    process.env.OH_SESSION_API_KEY = "from-oh";
    process.env.OPENHANDS_BASE_URL = "http://127.0.0.1:19999";
    process.env.OPENHANDS_API_KEY = "from-openhands";
    const cfg = defaultConfig();
    assert.equal(cfg.openhands.baseUrl, "http://127.0.0.1:18000");
    assert.equal(cfg.openhands.sessionApiKey, "from-oh");
    delete process.env.OH_BASE_URL;
    delete process.env.OH_SESSION_API_KEY;
    delete process.env.OPENHANDS_BASE_URL;
    delete process.env.OPENHANDS_API_KEY;
  });
});
