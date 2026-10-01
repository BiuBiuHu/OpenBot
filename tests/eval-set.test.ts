import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  loadEvalCases,
  redactEvalText,
  runEvalSuite,
  writeEvalSuiteRun,
} from "../src/eval-set.js";

describe("chat-layer eval set", () => {
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-eval-"));

  before(() => {
    process.env.OPENBOT_HOME = home;
  });

  after(() => {
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-EVAL-001: suite includes the four live failures and all pass", () => {
    const cases = loadEvalCases();
    const ids = cases.map((c) => c.id).sort();
    assert.deepEqual(ids, [
      "analyze-other-product",
      "links-render",
      "timeout-is-short",
      "who-are-you",
    ]);
    const dumped = JSON.stringify(cases);
    assert.doesNotMatch(dumped, /BEGIN [A-Z0-9 ]*PRIVATE KEY/);
    assert.doesNotMatch(dumped, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    const records = runEvalSuite(cases);
    for (const r of records) {
      assert.equal(r.pass, true, `${r.caseId}: ${JSON.stringify(r.checks)}`);
      assert.ok(r.userMessage);
      assert.ok(r.shown);
      assert.ok(r.remote.conversationId.startsWith("eval-"));
    }
  });

  it("TC-EVAL-002: writing a run stays under ~/.openbot and redacts hosts", () => {
    const records = runEvalSuite();
    const file = writeEvalSuiteRun(records);
    assert.ok(file.startsWith(home));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const body = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(body, /BEGIN [A-Z0-9 ]*PRIVATE KEY/);
    assert.equal(redactEvalText("ssh root@14.1.2.3"), "ssh root@[host]");
  });
});
