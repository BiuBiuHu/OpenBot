import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  loadEvalCases,
  redactEvalText,
  runEvalSuite,
  scoreEvalCase,
  shownForCase,
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

  it("TC-EVAL-001: suite includes the live failures plus lookup and all pass", () => {
    const cases = loadEvalCases();
    const ids = cases.map((c) => c.id).sort();
    assert.deepEqual(ids, [
      "analyze-other-product",
      "links-render",
      "timeout-is-short",
      "what-is-grok-bot",
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

  it("TC-EVAL-003: what-is-grok-bot fails on the OpenHands intro or a bare I don't know", () => {
    const c = loadEvalCases().find((x) => x.id === "what-is-grok-bot");
    assert.ok(c);
    assert.equal(c.lookupRequired, true);
    const shown = shownForCase(c);
    assert.match(shown, /网上查过了/);
    assert.match(shown, /xAI/);
    assert.doesNotMatch(shown, /我是 OpenHands/);
    assert.doesNotMatch(shown, /不知道/);
    assert.ok(scoreEvalCase(c, shown, true).every((x) => x.pass));
    const intro = "我是 OpenHands，一个可以操作计算机来帮你完成软件工程任务的 AI 智能体。工作目录是 workspace/project。";
    assert.ok(scoreEvalCase(c, intro, true).some((x) => !x.pass));
    assert.ok(scoreEvalCase(c, "不知道", true).some((x) => !x.pass));
    assert.ok(scoreEvalCase(c, "I don't know", true).some((x) => !x.pass));
    assert.ok(
      scoreEvalCase(c, "网上查过了，还没找到能直接说的结论。", true).some((x) => !x.pass),
      "empty 还没找到 must fail when a public page would have answered",
    );
    assert.ok(
      scoreEvalCase(
        c,
        "网上查过了。Grok is a series of generative AI large language models developed by SpaceXAI.",
        true,
      ).some((x) => !x.pass),
      "English source paragraph must fail a Chinese question",
    );
  });
});
