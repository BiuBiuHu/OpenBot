import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeOpenHandsIntro,
  needsLookup,
  lookupQuery,
  voiceChatReply,
  voiceFromSearch,
} from "../src/chat-voice.js";
import { runHandoffTurn, HandoffStore } from "../src/handoff.js";
import { OpenHandsClient } from "../src/oh-client.js";
import { runThreadTurn } from "../src/thread.js";
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

  it("TC-VOICE-006: 是什么 needs a lookup, 你是谁 and computer tasks do not", () => {
    assert.equal(needsLookup("Grok Bot 是什么"), true);
    assert.equal(needsLookup("what is Grok Bot"), true);
    assert.equal(lookupQuery("Grok Bot 是什么"), "Grok Bot");
    assert.equal(needsLookup("你是谁"), false);
    assert.equal(needsLookup("帮我分析下 grokbot 的架构"), false);
    assert.equal(needsLookup("在工作区写一份 uname 记录"), false);
  });

  it("TC-VOICE-007: search hits become a few sentences, not the intro or I don't know", () => {
    const shown = voiceFromSearch({
      userMessage: "Grok Bot 是什么",
      hits: [
        {
          title: "Grok (chatbot)",
          snippet: "Grok is a generative artificial intelligence chatbot developed by xAI.",
          url: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
          source: "wikipedia",
        },
      ],
    });
    assert.match(shown.text, /网上查过了/);
    assert.match(shown.text, /对话|聊天|机器人/);
    assert.match(shown.text, /xAI/);
    assert.doesNotMatch(shown.text, /Grok is a generative/i);
    assert.doesNotMatch(shown.text, /我是 OpenHands/);
    assert.doesNotMatch(shown.text, /不知道/);
    assert.doesNotMatch(shown.text, /conversation\s+/i);
    const empty = voiceFromSearch({ userMessage: "Grok Bot 是什么", hits: [] });
    assert.match(empty.text, /没查成/);
    assert.doesNotMatch(empty.text, /还没找到|结论|不知道/);
  });

  it("TC-VOICE-008: a Chinese question with English hits stays a short Chinese answer", () => {
    const shown = voiceFromSearch({
      userMessage: "Grok Bot 是什么",
      hits: [
        {
          title: "Grok (chatbot)",
          snippet:
            "Grok is a series of generative AI large language models developed by SpaceXAI. It was launched in November 2023.",
          url: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
          source: "wikipedia",
        },
      ],
    });
    assert.match(shown.text, /网上查过了/);
    assert.match(shown.text, /SpaceXAI|xAI/);
    assert.match(shown.text, /对话|聊天|机器人/);
    assert.doesNotMatch(shown.text, /Grok is a series/i);
    assert.doesNotMatch(shown.text, /launched in November/i);
    assert.ok(shown.text.length < 80);
    const english = voiceFromSearch({
      userMessage: "what is Grok Bot",
      hits: [
        {
          title: "Grok (chatbot)",
          snippet: "Grok is a generative artificial intelligence chatbot developed by xAI.",
          url: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
          source: "wikipedia",
        },
      ],
    });
    assert.match(english.text, /I looked it up/);
    assert.match(english.text, /xAI|chatbot/i);
  });

  it("TC-SEARCH-002: lookup skips OpenHands so a workspace dump is not search", async () => {
    const mock = await startMockOhServer({
      sessionKey: "voice-key",
      replyFor: () => INTRO,
    });
    try {
      const events: AgentEvent[] = [];
      const result = await runThreadTurn("Grok Bot 是什么", {
        client: new OpenHandsClient(mock.baseUrl, "voice-key"),
        store: new HandoffStore(),
        emit: (e) => events.push(e),
        forceHandoff: true,
        timeoutMs: 2000,
        pollMs: 20,
        searchWeb: async () => [
          {
            title: "Grok (chatbot)",
            snippet: "Grok is a generative AI chatbot developed by xAI.",
            url: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
            source: "wikipedia",
          },
        ],
      });
      assert.equal(result.path, "lookup");
      assert.equal(mock.creates.length, 0);
      const tokens = events.filter((e) => e.type === "token").map((e) => String(e.text || "")).join("");
      assert.match(tokens, /网上查过了/);
      assert.match(tokens, /对话|聊天|机器人/);
      assert.match(tokens, /xAI/);
      assert.doesNotMatch(tokens, /Grok is a generative/i);
      assert.doesNotMatch(tokens, /我是 OpenHands/);
      assert.doesNotMatch(tokens, /不知道/);
      assert.ok(!events.some((e) => e.type === "tool_start"));
    } finally {
      await mock.stop();
    }
  });

  it("TC-SEARCH-006: empty HTTP falls back to a page read, not a browser dump", async () => {
    const mock = await startMockOhServer({
      sessionKey: "voice-key",
      replyFor: () => INTRO,
    });
    try {
      const events: AgentEvent[] = [];
      const result = await runThreadTurn("Grok Bot 是什么", {
        client: new OpenHandsClient(mock.baseUrl, "voice-key"),
        store: new HandoffStore(),
        emit: (e) => events.push(e),
        forceHandoff: true,
        timeoutMs: 2000,
        pollMs: 20,
        searchWeb: async () => [],
        browsePublicPage: async () => [
          {
            title: "Grok Bot",
            snippet: "Grok is a generative AI chatbot developed by xAI.",
            url: "https://www.bing.com/search?q=Grok+Bot",
            source: "browser",
          },
        ],
      });
      assert.equal(result.path, "lookup");
      assert.equal(mock.creates.length, 0);
      const tokens = events.filter((e) => e.type === "token").map((e) => String(e.text || "")).join("");
      assert.match(tokens, /网上查过了/);
      assert.match(tokens, /对话|聊天|机器人/);
      assert.match(tokens, /xAI/);
      assert.doesNotMatch(tokens, /Grok is a generative/i);
      assert.doesNotMatch(tokens, /还没找到/);
      assert.doesNotMatch(tokens, /我是 OpenHands/);
      assert.ok(!events.some((e) => e.type === "tool_start"));
    } finally {
      await mock.stop();
    }
  });
});
