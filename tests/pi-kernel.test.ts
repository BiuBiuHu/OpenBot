import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { HandoffStore } from "../src/handoff.js";
import { runHandoffTurn } from "../src/handoff.js";
import { OpenHandsClient } from "../src/oh-client.js";
import { createOpenBotPiSession, NO_MODEL_KEY_TEXT } from "../src/pi-kernel.js";
import { assistantTextMessage, emitAssistantMessage, userText } from "../src/pi-stream.js";
import { REMOTE_TIMER_LINE, runRemoteTask } from "../src/remote-agent.js";
import { createSessionTools, type SessionToolBag } from "../src/session-tools.js";
import { runThreadTurn } from "../src/thread.js";
import type { AgentEvent } from "../src/types.js";
import { startMockOhServer } from "./oh-mock.js";

const DOC_ASK =
  "看看 https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个文档讲了什么?";

function toolCallStream(name: string, args: Record<string, unknown>) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: `call_${name}`, name, arguments: args }],
    api: "openai-completions",
    provider: "openbot",
    model: "openbot",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  emitAssistantMessage(stream, message);
  return stream;
}

describe("Pi kernel", () => {
  it("TC-PI-001: the original sentence reaches Pi before clock, code, search, or document tools", async () => {
    const seen: string[] = [];
    let toolCalls = 0;
    const bag: SessionToolBag = {};
    const session = await createOpenBotPiSession({
      language: "zh-CN",
      llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
      tools: createSessionTools({
        client: () => new OpenHandsClient("http://127.0.0.1:9", "x"),
        oh: () => undefined,
        language: () => "zh-CN",
        conversationId: () => undefined,
        bag,
        searchWeb: async () => {
          toolCalls += 1;
          return [];
        },
        readPublicDocument: async () => {
          toolCalls += 1;
          return undefined;
        },
      }),
      modelStream: (_model, context) => {
        const blob = JSON.stringify(context.messages);
        assert.match(blob, /你是 OpenBot/);
        const last = [...context.messages].reverse().find((message) => message.role === "user");
        seen.push(userText(last?.content));
        const stream = createAssistantMessageEventStream();
        emitAssistantMessage(stream, assistantTextMessage("Pi 先看见了。"));
        return stream;
      },
    });
    const sentences = ["今天的时间是什么时候", "改代码", "Grok Bot 是什么", DOC_ASK, "你是谁"];
    try {
      for (const sentence of sentences) {
        const events: AgentEvent[] = [];
        const result = await runThreadTurn(sentence, {
          pi: session,
          client: new OpenHandsClient("http://127.0.0.1:9", "x"),
          store: new HandoffStore(),
          emit: (event) => events.push(event),
          language: "zh-CN",
          searchWeb: async () => {
            toolCalls += 1;
            throw new Error("router searched");
          },
          readPublicDocument: async () => {
            toolCalls += 1;
            throw new Error("router read");
          },
        });
        assert.equal(result.path, "pi");
        const shown = events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
        assert.equal(shown, "Pi 先看见了。");
        assert.doesNotMatch(shown, /现在是|网上查过了|我看过了|说一下改哪个文件/);
      }
    } finally {
      session.dispose();
    }
    assert.deepEqual(seen, sentences);
    assert.equal(toolCalls, 0);
  });

  it("TC-PI-002: clock runs only after Pi has the sentence and the model calls the tool", async () => {
    const order: string[] = [];
    let step = 0;
    const bag: SessionToolBag = {};
    const tools = createSessionTools({
      client: () => new OpenHandsClient("http://127.0.0.1:9", "x"),
      oh: () => undefined,
      language: () => "zh-CN",
      now: () => new Date("2026-10-01T20:41:00+08:00"),
      conversationId: () => undefined,
      bag,
    });
    const clock = tools.clock.bind(tools);
    tools.clock = (now) => {
      order.push("tool:clock");
      return clock(now);
    };
    const session = await createOpenBotPiSession({
      language: "zh-CN",
      llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
      tools,
      modelStream: (_model, context) => {
        const last = [...context.messages].reverse().find((message) => message.role === "user");
        if (last && step === 0) order.push(`pi:${userText(last.content)}`);
        if (step === 0) {
          step += 1;
          return toolCallStream("clock", {});
        }
        order.push("pi-after");
        const stream = createAssistantMessageEventStream();
        emitAssistantMessage(stream, assistantTextMessage("模型在时钟之后回答。"));
        return stream;
      },
    });
    try {
      const events: AgentEvent[] = [];
      await runThreadTurn("现在几点", {
        pi: session,
        client: new OpenHandsClient("http://127.0.0.1:9", "x"),
        store: new HandoffStore(),
        emit: (event) => events.push(event),
        language: "zh-CN",
      });
      const shown = events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
      assert.equal(shown, "模型在时钟之后回答。");
    } finally {
      session.dispose();
    }
    assert.equal(order[0], "pi:现在几点");
    assert.ok(order.indexOf("tool:clock") > 0);
    assert.ok(order.indexOf("pi-after") > order.indexOf("tool:clock"));
  });

  it("TC-PI-003: without a model key the sentence still enters Pi and is not rule-answered", async () => {
    let searched = 0;
    const events: AgentEvent[] = [];
    const result = await runThreadTurn("今天的时间是什么时候", {
      client: new OpenHandsClient("http://127.0.0.1:9", "x"),
      store: new HandoffStore(),
      llm: { baseUrl: "http://127.0.0.1:9/v1", model: "none", apiKey: "" },
      language: "zh-CN",
      emit: (event) => events.push(event),
      searchWeb: async () => {
        searched += 1;
        return [];
      },
    });
    assert.equal(result.path, "pi");
    assert.equal(searched, 0);
    const shown = events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
    assert.equal(shown, NO_MODEL_KEY_TEXT);
    assert.doesNotMatch(shown, /现在是|没在时限里跑完/);
  });

  it("TC-PI-004: document and search tools answer only when called", async () => {
    const bag: SessionToolBag = {};
    let reads = 0;
    let searches = 0;
    const tools = createSessionTools({
      client: () => new OpenHandsClient("http://127.0.0.1:9", "x"),
      oh: () => undefined,
      language: () => "zh-CN",
      conversationId: () => undefined,
      bag,
      searchWeb: async () => {
        searches += 1;
        return [
          {
            title: "Grok (chatbot)",
            snippet: "Grok is a generative artificial intelligence chatbot developed by xAI.",
            url: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
            source: "wikipedia",
          },
        ];
      },
      readPublicDocument: async () => {
        reads += 1;
        return {
          title: "用户记忆和知识库",
          text: "这一章讲用户记忆和共享知识库的差别。",
          url: "https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md",
        };
      },
    });
    assert.equal(reads, 0);
    assert.equal(searches, 0);
    const doc = await tools.readPublicDocument(DOC_ASK);
    assert.equal(reads, 1);
    assert.match(doc, /我看过了/);
    assert.match(doc, /用户记忆/);
    const looked = await tools.webSearch("Grok Bot 是什么");
    assert.equal(searches, 1);
    assert.match(looked, /网上查过了/);
    const clock = tools.clock(new Date("2026-10-01T20:41:00+08:00"));
    assert.match(clock, /现在是/);
    assert.match(clock, /上海/);
  });

  it("TC-PI-005: a remote task still running past the old 60s cutoff is not the timer line", async () => {
    const mock = await startMockOhServer({
      sessionKey: "wait-key",
      finishAfterPolls: 6,
      replyFor: () => "远程做完了。",
    });
    try {
      const events: AgentEvent[] = [];
      const result = await runHandoffTurn("在工作区写一份记录", {
        client: new OpenHandsClient(mock.baseUrl, "wait-key"),
        store: new HandoffStore(),
        emit: (event) => events.push(event),
        timeoutMs: 1,
        pollMs: 5,
        language: "zh-CN",
      });
      assert.equal(result?.status, "succeeded");
      const shown = events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
      assert.match(shown, /远程做完了/);
      assert.doesNotMatch(shown, new RegExp(REMOTE_TIMER_LINE.replace(/[。]/g, "。")));
      assert.equal(shown.includes(REMOTE_TIMER_LINE), false);
      const again = await runRemoteTask("继续等", {
        client: new OpenHandsClient(mock.baseUrl, "wait-key"),
        pollMs: 5,
        language: "zh-CN",
      });
      assert.equal(again.transport, "openhands");
      assert.equal(again.text.includes(REMOTE_TIMER_LINE), false);
      assert.match(again.text, /继续等|远程做完了|done:/);
    } finally {
      await mock.stop();
    }
  });

  it("TC-PI-006: a dead remote is one short connection failure, not the timer line", async () => {
    const events: AgentEvent[] = [];
    const result = await runHandoffTurn("uname -a", {
      client: new OpenHandsClient("http://127.0.0.1:9", "x"),
      store: new HandoffStore(),
      emit: (event) => events.push(event),
      timeoutMs: 60_000,
      pollMs: 20,
      language: "zh-CN",
    });
    assert.equal(result, undefined);
    const shown = events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
    assert.equal(shown, "连不上这台电脑。");
    assert.equal(shown.includes(REMOTE_TIMER_LINE), false);
  });

  it("TC-PI-007: 你是谁 is rewritten to OpenBot only after Pi has seen the sentence", async () => {
    const seen: string[] = [];
    const intro = "我是 OpenHands，一个可以操作计算机来帮你完成软件工程任务的 AI 智能体。工作目录是 workspace/project。";
    const events: AgentEvent[] = [];
    await runThreadTurn("你是谁", {
      client: new OpenHandsClient("http://127.0.0.1:9", "x"),
      store: new HandoffStore(),
      emit: (event) => events.push(event),
      language: "zh-CN",
      pi: {
        async prompt(text) {
          seen.push(text);
          return { text: intro };
        },
        dispose() {},
      },
    });
    assert.deepEqual(seen, ["你是谁"]);
    const shown = events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
    assert.match(shown, /OpenBot/);
    assert.doesNotMatch(shown, /我是 OpenHands/);
  });
});
