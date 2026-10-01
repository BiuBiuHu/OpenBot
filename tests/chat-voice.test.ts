import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isClockAsk,
  isCodingAsk,
  isVagueCodingAsk,
  looksLikeOpenHandsIntro,
  lookupQuery,
  needsLookup,
  voiceChatReply,
  voiceCodingReady,
  voiceFromSearch,
  voiceNow,
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
    assert.equal(needsLookup("今天的时间是什么时候"), false);
    assert.equal(needsLookup("你能帮我改代码吗"), false);
    assert.equal(needsLookup("改代码"), false);
  });

  it("TC-VOICE-011: a clock ask is the Shanghai time, not a search dump", () => {
    assert.equal(isClockAsk("今天的时间是什么时候"), true);
    assert.equal(isClockAsk("我是说今天的时间，你这回答是啥意思"), true);
    assert.equal(isClockAsk("现在几点"), true);
    assert.equal(isClockAsk("Grok Bot 是什么"), false);
    const shown = voiceNow({
      language: "zh-CN",
      now: new Date("2026-10-01T20:41:00+08:00"),
    });
    assert.match(shown.text, /现在是/);
    assert.match(shown.text, /2026年10月1日/);
    assert.match(shown.text, /20:41/);
    assert.match(shown.text, /上海/);
    assert.ok(shown.text.split(/[。！？]/).filter(Boolean).length <= 2);
    assert.doesNotMatch(shown.text, /网上查过了|今天開始|CST|没有访问|没访问|实时时钟|系统时间/);
  });

  it("TC-VOICE-012: 改代码 is a coding request, not the canned computer line", async () => {
    assert.equal(isCodingAsk("你能帮我改代码吗"), true);
    assert.equal(isCodingAsk("改代码"), true);
    assert.equal(isVagueCodingAsk("改代码"), true);
    assert.equal(isVagueCodingAsk("把 src/foo.ts 的 bar 改成 1"), false);
    const intro = voiceChatReply({
      userMessage: "你能帮我改代码吗",
      remoteText: INTRO,
      outcome: "succeeded",
      language: "zh-CN",
    });
    assert.match(intro.text, /可以/);
    assert.match(intro.text, /文件/);
    assert.doesNotMatch(intro.text, /先不背说明书/);
    assert.doesNotMatch(intro.text, /你具体想让这台电脑做什么/);
    const follow = voiceCodingReady({ language: "zh-CN" });
    assert.match(follow.text, /可以/);
    assert.doesNotMatch(follow.text, /先不背说明书/);
    const events: AgentEvent[] = [];
    const result = await runThreadTurn("改代码", {
      client: new OpenHandsClient("http://127.0.0.1:9", "x"),
      store: new HandoffStore(),
      emit: (e) => events.push(e),
      forceHandoff: true,
      language: "zh-CN",
      searchWeb: async () => {
        throw new Error("clock/coding must not search");
      },
    });
    assert.equal(result.path, "coding");
    const tokens = events.filter((e) => e.type === "token").map((e) => String(e.text || "")).join("");
    assert.match(tokens, /可以/);
    assert.doesNotMatch(tokens, /先不背说明书/);
  });

  it("TC-VOICE-013: 今天的时间 does not call search", async () => {
    const events: AgentEvent[] = [];
    const result = await runThreadTurn("今天的时间是什么时候", {
      client: new OpenHandsClient("http://127.0.0.1:9", "x"),
      store: new HandoffStore(),
      emit: (e) => events.push(e),
      forceHandoff: true,
      language: "zh-CN",
      searchWeb: async () => {
        throw new Error("clock must not search");
      },
    });
    assert.equal(result.path, "clock");
    const tokens = events.filter((e) => e.type === "token").map((e) => String(e.text || "")).join("");
    assert.match(tokens, /现在是/);
    assert.match(tokens, /上海/);
    assert.doesNotMatch(tokens, /网上查过了|CST|今天開始/);
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
      language: "en",
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

  it("TC-VOICE-009: Chinese lookup does not paste a chopped search title", () => {
    const shown = voiceFromSearch({
      userMessage: "Grok Bot 是什么",
      hits: [
        {
          title: "Grok Bot 小白入门教程",
          snippet:
            "2026年8月13日&ensp; &ensp;Grok Bot 小白入门教程：下载安装、创建第一个 Bot，一篇讲明白 本文依据 Grok Bot 官方文档...",
          url: "https://example.com/grok-bot-tutorial",
          source: "bing",
        },
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
    assert.doesNotMatch(shown.text, /&ensp;|&amp;|&#/);
    assert.doesNotMatch(shown.text, /…|\.\.\./);
    assert.doesNotMatch(shown.text, /小白入门|一篇讲明白|本文依据|官方文档/);
    assert.ok(/[。！？]$/.test(shown.text));
  });

  it("TC-VOICE-010: saved zh-CN rewrites Traditional or English search into Simplified", () => {
    const traditional = voiceFromSearch({
      userMessage: "Grok 是什么",
      language: "zh-CN",
      hits: [
        {
          title: "Grok",
          snippet: "Grok是xAI基于大型语言模型开发的生成式人工智慧聊天機器人,類似於ChatGPT。",
          url: "https://zh.wikipedia.org/wiki/Grok",
          source: "wikipedia",
        },
      ],
    });
    assert.match(traditional.text, /网上查过了/);
    assert.match(traditional.text, /机器人|人工智能|类似于/);
    assert.doesNotMatch(traditional.text, /機器人|類似於|人工智慧/);
    const englishQ = voiceFromSearch({
      userMessage: "what is Grok Bot",
      language: "zh-CN",
      hits: [
        {
          title: "Grok (chatbot)",
          snippet: "Grok is a generative artificial intelligence chatbot developed by xAI.",
          url: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
          source: "wikipedia",
        },
      ],
    });
    assert.match(englishQ.text, /网上查过了/);
    assert.match(englishQ.text, /对话|聊天|机器人/);
    assert.doesNotMatch(englishQ.text, /I looked it up/);
    assert.doesNotMatch(englishQ.text, /generative artificial intelligence/);
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
