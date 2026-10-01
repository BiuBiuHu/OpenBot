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

  it("TC-EVAL-001: suite includes the live failures plus lookup and all pass", async () => {
    const cases = loadEvalCases();
    const ids = cases.map((c) => c.id).sort();
    assert.deepEqual(ids, [
      "analyze-other-product",
      "change-code",
      "change-code-bare",
      "handoff-waits-until-terminal",
      "links-render",
      "read-public-doc",
      "read-public-doc-exact",
      "repo-is-not-a-chapter",
      "timeout-is-short",
      "todays-time",
      "what-is-grok-bot",
      "whats-this-is-computer",
      "who-are-you",
    ]);
    const dumped = JSON.stringify(cases);
    assert.doesNotMatch(dumped, /BEGIN [A-Z0-9 ]*PRIVATE KEY/);
    assert.doesNotMatch(dumped, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    const exact = cases.find((c) => c.id === "read-public-doc-exact");
    const older = cases.find((c) => c.id === "read-public-doc");
    assert.equal(
      exact?.userMessage,
      "https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个讲的是什么?",
    );
    assert.equal(
      older?.userMessage,
      "看看 https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个文档讲了什么?",
    );
    assert.equal(exact?.document, undefined);
    assert.equal(older?.document, undefined);
    const records = await runEvalSuite(cases);
    for (const r of records) {
      assert.equal(r.pass, true, `${r.caseId}: ${JSON.stringify(r.checks)}`);
      assert.ok(r.userMessage);
      assert.ok(r.shown);
      assert.ok(r.remote.conversationId.startsWith("eval-"));
    }
  });

  it("TC-EVAL-002: writing a run stays under ~/.openbot and redacts hosts", async () => {
    const records = await runEvalSuite();
    const file = writeEvalSuiteRun(records);
    assert.ok(file.startsWith(home));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const body = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(body, /BEGIN [A-Z0-9 ]*PRIVATE KEY/);
    assert.equal(redactEvalText("ssh root@14.1.2.3"), "ssh root@[host]");
  });

  it("TC-EVAL-003: what-is-grok-bot fails on the OpenHands intro or a bare I don't know", async () => {
    const c = loadEvalCases().find((x) => x.id === "what-is-grok-bot");
    assert.ok(c);
    assert.equal(c.lookupRequired, true);
    const shown = await shownForCase(c);
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

  it("TC-EVAL-004: read-public-doc must not voice the computer-task timeout", async () => {
    const c = loadEvalCases().find((x) => x.id === "read-public-doc");
    assert.ok(c);
    assert.equal(c.documentRequired, true);
    const shown = await shownForCase(c);
    assert.match(shown, /我看过了/);
    assert.match(shown, /用户记忆/);
    assert.match(shown, /知识库/);
    assert.doesNotMatch(shown, /没在时限|再说一次|我是 OpenHands|网上查过了|HTTPS/);
    assert.ok(scoreEvalCase(c, shown, false).every((x) => x.pass), JSON.stringify(scoreEvalCase(c, shown, false)));
    assert.ok(scoreEvalCase(c, "这台电脑这轮没在时限里跑完。你再说一次就行。", false).some((x) => !x.pass));
  });

  it("TC-EVAL-005: the exact live sentence must not be scored as an HTTPS lookup", async () => {
    const c = loadEvalCases().find((x) => x.id === "read-public-doc-exact");
    assert.ok(c);
    const shown = await shownForCase(c);
    assert.match(shown, /我看过了/);
    assert.match(shown, /用户记忆/);
    assert.match(shown, /知识库/);
    assert.doesNotMatch(shown, /HTTPS|Hypertext Transfer Protocol|网上查过了|没在时限/);
    assert.ok(
      scoreEvalCase(
        c,
        "网上查过了。HTTPS （全称：Hypertext Transfer Protocol Secure），是以安全为目标的 HTTP 通道，在HTTP的基础上通过传输 …。",
        false,
      ).some((x) => !x.pass),
    );
  });

  it("TC-EVAL-006: live misses fail the old voices and pass the repaired ones", async () => {
    const cases = loadEvalCases();
    const repo = cases.find((x) => x.id === "repo-is-not-a-chapter");
    const what = cases.find((x) => x.id === "whats-this-is-computer");
    const slow = cases.find((x) => x.id === "handoff-waits-until-terminal");
    assert.ok(repo && what && slow);
    assert.equal(repo.userMessage, "那这个项目 https://github.com/bojieli/ai-agent-book 讲了什么?");
    assert.equal(what.userMessage, "这是啥?");
    assert.equal(slow.handoffWaitUntilTerminal, true);
    const repoShown = await shownForCase(repo);
    assert.match(repoShown, /仓库|不是一份文档|深入理解/);
    assert.doesNotMatch(repoShown, /模型选型可参考|这一章/);
    assert.ok(scoreEvalCase(repo, "我看过了。模型选型可参考这篇指南。", false).some((x) => !x.pass));
    const whatShown = await shownForCase(what);
    assert.doesNotMatch(whatShown, /先不背说明书|你具体想让这台电脑做什么/);
    assert.ok(scoreEvalCase(what, "先不背说明书。你具体想让这台电脑做什么？", true).some((x) => !x.pass));
    const slowShown = await shownForCase(slow);
    assert.match(slowShown, /仓库已经下好了/);
    assert.doesNotMatch(slowShown, /没在时限|再说一次/);
    assert.ok(scoreEvalCase(slow, "这台电脑这轮没在时限里跑完。你再说一次就行。", true).some((x) => !x.pass));
  });
});
