import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { defaultConfig, parseEnvFile, saveConfig, configPath } from "../src/config.js";

describe("REQ-OPENBOT-007 config isolation", () => {
  const prev = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-home-"));

  before(() => {
    process.env.OPENBOT_HOME = home;
  });

  after(() => {
    if (prev === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-CFG-001: parseEnvFile ignores comments and writes 0600 config", () => {
    const parsed = parseEnvFile("# hi\nOPENAI_API_KEY=\nOPENAI_MODEL=gpt-4o-mini\n");
    assert.equal(parsed.OPENAI_API_KEY, "");
    assert.equal(parsed.OPENAI_MODEL, "gpt-4o-mini");

    const cfg = defaultConfig();
    cfg.host.hostname = "203.0.113.10";
    const file = saveConfig(cfg);
    assert.equal(file, configPath());
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, /203\.0\.113\.10/);
    assert.equal(path.dirname(file).startsWith(home), true);
  });
});
