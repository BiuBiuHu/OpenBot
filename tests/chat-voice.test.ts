import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeOpenHandsIntro,
  voiceChatReply,
} from "../src/chat-voice.js";
import { runHandoffTurn, HandoffStore } from "../src/handoff.js";
import { OpenHandsClient } from "../src/oh-client.js";
import type { AgentEvent } from "../src/types.js";
import { startMockOhServer } from "./oh-mock.js";

const INTRO =
  "我是 OpenHands，一个可以操作计算机来帮你完成软件工程任务的 AI 智能体。我目前的工作目录是 workspace/project。查阅 <https://docs.openhands.dev/>。";

describe("chat voice", () => {
  it("TC-VOICE-001: 你是谁 does not return the canned OpenHands intro", () => {
    assert.equal(looksLikeOpenHandsIntro(INTRO), true);
    const shown = voiceChatReply({
      userMessage: "你是谁",
      remoteText: INTRO,
      outcome: "succeeded",
    });
    assert.match(shown.text, /OpenBot/);
    assert.doesNotMatch(shown.text, /我是 OpenHands/);
    assert.doesNotMatch(shown.text, /workspace\/project/);
  });

  it("TC-VOICE-002: analyzing another product does not return that intro", () => {
    const shown = voiceChatReply({
      userMessage: "帮我分析下 grokbot 的架构",
      remoteText: INTRO,
      outcome: "succeeded",
    });
    assert.match(shown.text, /grokbot/i);
    assert.doesNotMatch(shown.text, /我是 OpenHands/);
    assert.doesNotMatch(shown.text, /workspace\/project/);
  });

  it("TC-VOICE-003: timeout is one short sentence", () => {
    const shown = voiceChatReply({
      userMessage: "帮我分析下 grokbot 的架构",
      remoteText: "conversation timed out while running\n排查过程\n/opt/openhands-agent/workspace/project",
      outcome: "timeout",
    });
    assert.ok(shown.text.length < 80);
    assert.doesNotMatch(shown.text, /conversation timed out/);
    assert.doesNotMatch(shown.text, /\/opt\//);
    assert.doesNotMatch(shown.text, /排查过程/);
  });

  it("TC-VOICE-004: short remote replies pass through with linkified URLs", () => {
    const shown = voiceChatReply({
      userMessage: "文档在哪",
      remoteText: "看这里 <https://example.com/docs>。",
      outcome: "succeeded",
    });
    assert.match(shown.text, /\[example.com\/docs\]\(https:\/\/example.com\/docs\)/);
    assert.doesNotMatch(shown.text, /<https:\/\/example.com\/docs>/);
  });

  it("TC-VOICE-005: handoff turn voices a canned intro instead of dumping it", async () => {
    const mock = await startMockOhServer({
      sessionKey: "voice-key",
      replyFor: () => INTRO,
    });
    try {
      const events: AgentEvent[] = [];
      await runHandoffTurn("你是谁", {
        client: new OpenHandsClient(mock.baseUrl, "voice-key"),
        store: new HandoffStore(),
        emit: (e) => events.push(e),
        timeoutMs: 2000,
        pollMs: 20,
      });
      const tokens = events.filter((e) => e.type === "token").map((e) => String(e.text || ""));
      assert.ok(tokens.some((t) => /OpenBot/.test(t)));
      assert.ok(!tokens.some((t) => /我是 OpenHands/.test(t)));
      assert.ok(!events.some((e) => e.type === "tool_start"));
    } finally {
      await mock.stop();
    }
  });
});
