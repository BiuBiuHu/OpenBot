import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { startOpenHandsAdapter } from "../src/a2a-adapter/server.js";
import { REMOTE_TIMER_LINE } from "../src/chat-voice.js";
import { HandoffStore } from "../src/handoff.js";
import { OpenHandsClient } from "../src/oh-client.js";
import { NO_MODEL_KEY_TEXT, createOpenBotPiSession, type PiSession } from "../src/pi-kernel.js";
import { assistantTextMessage, emitAssistantMessage, userText } from "../src/pi-stream.js";
import { loadRemoteSkills, runRemoteTask, type RemoteSkill } from "../src/remote-agent.js";
import { createSessionTools, type SessionToolBag, type SessionTools } from "../src/session-tools.js";
import { runThreadTurn, type ThreadTurnResult } from "../src/thread.js";
import type { AgentEvent } from "../src/types.js";
import { freePort } from "./helpers.js";
import { startMockOhServer, type MockOhServer } from "./oh-mock.js";

const DOC_URL = "https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md";
const DOC_ASK = `看看 ${DOC_URL} 这个文档讲了什么?`;
const BROWSE_ASK = "用那台电脑上的浏览器打开 https://example.com/docs";
const MIXED_ASK = "谢谢，顺便把 README.md 改成一行：你好。";
const EDIT_ASK = "把 README.md 改成一行：你好";
const DUMP = "REMOTE-DUMP-MARKER\n先列目录。\n再打开文件。\n最后写回磁盘。这段过程不该出现在聊天里。";
const SEARCH_BODY = "Grok 是 xAI 做的对话机器人。";
const DOC_BODY = "这个仓库讲 AI agent，第三章写用户记忆。";
const PAGE_BODY = "页面写着示例文档。";
const OH_INTRO = "我是 OpenHands，一个可以操作计算机来帮你完成软件工程任务的 AI 智能体。工作目录是 workspace/project。";

function toolCall(name: string, args: Record<string, unknown>) {
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

function say(text: string) {
  const stream = createAssistantMessageEventStream();
  emitAssistantMessage(stream, assistantTextMessage(text));
  return stream;
}

function shownOf(events: AgentEvent[]): string {
  return events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
}

function toolResultText(context: { messages: Array<{ role: string; content?: unknown }> }): string {
  const bits: string[] = [];
  for (const message of context.messages) {
    if (message.role !== "toolResult") continue;
    const content = message.content;
    if (typeof content === "string") bits.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part) bits.push(String((part as { text?: string }).text || ""));
      }
    }
  }
  return bits.join("\n");
}

function lastUser(context: { messages: Array<{ role: string; content: unknown }> }): string {
  const last = [...context.messages].reverse().find((message) => message.role === "user");
  return userText(last?.content);
}

async function serveJson(bodyFor: (baseUrl: string) => unknown): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  let baseUrl = "http://127.0.0.1:0";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", baseUrl);
    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bodyFor(baseUrl)));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  const port = await freePort();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function partialCard(baseUrl: string, skills: unknown[]) {
  return {
    name: "PartialHands",
    description: "只有卡上写了的能力。",
    supportedInterfaces: [{ url: baseUrl, protocolBinding: "HTTP+JSON", tenant: "", protocolVersion: "1.0" }],
    version: "test",
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
    signatures: [],
  };
}

async function turn(message: string, session: PiSession, client: OpenHandsClient): Promise<{ events: AgentEvent[]; result: ThreadTurnResult; shown: string }> {
  const events: AgentEvent[] = [];
  const result = await runThreadTurn(message, {
    pi: session,
    client,
    store: new HandoffStore(),
    emit: (event) => events.push(event),
    language: "zh-CN",
  });
  return { events, result, shown: shownOf(events) };
}

function localTools(opts: {
  client: OpenHandsClient;
  bag: SessionToolBag;
  now?: Date;
  onClock?: () => void;
}): SessionTools {
  const tools = createSessionTools({
    client: () => opts.client,
    oh: () => undefined,
    language: () => "zh-CN",
    now: () => opts.now ?? new Date("2026-10-01T12:41:00Z"),
    pollMs: 5,
    conversationId: () => undefined,
    bag: opts.bag,
  });
  if (opts.onClock) {
    const clock = tools.clock.bind(tools);
    tools.clock = (now) => {
      opts.onClock?.();
      return clock(now);
    };
  }
  return tools;
}

describe("A2A behavior cases", () => {
  it("TC-A2A-004: 现在几点 uses the local clock and does not call the remote", async () => {
    const mock = await startMockOhServer({ sessionKey: "clock-key", finishAfterPolls: 1 });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "clock-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    const order: string[] = [];
    let clocks = 0;
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: localTools({
          client: new OpenHandsClient(adapter.baseUrl, "clock-key"),
          bag,
          onClock: () => {
            clocks += 1;
            order.push("tool:clock");
          },
        }),
        modelStream: (_model, context) => {
          const user = lastUser(context);
          if (user && step === 0) order.push(`pi:${user}`);
          if (step === 0) {
            step += 1;
            return toolCall("clock", {});
          }
          order.push("pi-after");
          return say("现在是 2026年10月1日星期四 20:41（上海）。");
        },
      });
      try {
        const { shown } = await turn("现在几点", session, new OpenHandsClient(adapter.baseUrl, "clock-key"));
        assert.equal(order[0], "pi:现在几点");
        assert.ok(order.indexOf("tool:clock") > 0);
        assert.ok(order.indexOf("pi-after") > order.indexOf("tool:clock"));
        assert.equal(clocks, 1);
        assert.equal(adapter.tasks.length, 0);
        assert.equal(mock.creates.length, 0);
        assert.match(shown, /现在是/);
        assert.match(shown, /上海/);
        assert.doesNotMatch(shown, /1\.|步骤/);
        assert.equal(bag.remote, undefined);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-005: 你是谁 is a short OpenBot reply, not an OpenHands introduction", async () => {
    const mock = await startMockOhServer({ sessionKey: "who-key" });
    const bag: SessionToolBag = {};
    const seen: string[] = [];
    try {
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: [],
        tools: localTools({ client: new OpenHandsClient(mock.baseUrl, "who-key"), bag }),
        modelStream: (_model, context) => {
          seen.push(lastUser(context));
          return say(`${OH_INTRO}\n1. 我能改文件\n2. 我能跑命令\n3. 我能开浏览器`);
        },
      });
      try {
        const { shown } = await turn("你是谁", session, new OpenHandsClient(mock.baseUrl, "who-key"));
        assert.deepEqual(seen, ["你是谁"]);
        assert.match(shown, /OpenBot/);
        assert.doesNotMatch(shown, /我是 OpenHands|workspace\/project|1\.|2\.|3\./);
        assert.equal(mock.creates.length, 0);
        assert.equal(bag.remote, undefined);
      } finally {
        session.dispose();
      }
    } finally {
      await mock.stop();
    }
  });

  it("TC-A2A-006: a public product question is the web_search card skill, not a local search", async () => {
    const mock = await startMockOhServer({
      sessionKey: "search-key",
      finishAfterPolls: 1,
      replyFor: () => `${DUMP}\n${SEARCH_BODY}`,
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "search-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    const seen: string[] = [];
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      assert.ok(skills.some((skill) => skill.id === "web_search"));
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "search-key"), bag }),
        modelStream: (_model, context) => {
          const user = lastUser(context);
          if (user) seen.push(user);
          const blob = JSON.stringify(context.messages);
          assert.match(blob, /web_search/);
          assert.match(blob, /查询公开网页/);
          assert.doesNotMatch(blob, /网页查询是你自己|读公开文档、网页查询|公开网页留在|不要把公开/);
          if (step === 0) {
            step += 1;
            return toolCall("web_search", { goal: "Grok Bot 是什么" });
          }
          const toolText = toolResultText(context);
          assert.match(toolText, /Grok 是 xAI 做的对话机器人/);
          assert.notEqual(toolText, "做完了。");
          assert.doesNotMatch(toolText, /^做完了。?$/);
          assert.doesNotMatch(toolText, /REMOTE-DUMP-MARKER/);
          return say("Grok Bot 是 xAI 的对话机器人。");
        },
      });
      try {
        assert.equal(session.toolNames().includes("web_search"), true);
        const { shown, result } = await turn("Grok Bot 是什么", session, new OpenHandsClient(adapter.baseUrl, "search-key"));
        assert.equal(seen[0], "Grok Bot 是什么");
        assert.equal(adapter.tasks[0]?.skillId, "web_search");
        assert.equal(adapter.tasks[0]?.goal, "Grok Bot 是什么");
        assert.equal(mock.creates.length, 1);
        assert.match(JSON.stringify(mock.creates[0]?.body), /Grok Bot 是什么/);
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(bag.remote?.dispatched, true);
        assert.equal(shown, "Grok Bot 是 xAI 的对话机器人。");
        assert.doesNotMatch(shown, /1\.|网上查过了|REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /Grok 是 xAI 做的对话机器人/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-007: a public GitHub link is the read_public_document card skill, not a local read", async () => {
    const mock = await startMockOhServer({
      sessionKey: "doc-key",
      finishAfterPolls: 1,
      replyFor: () => `${DUMP}\n${DOC_BODY}`,
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "doc-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    const seen: string[] = [];
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      assert.ok(skills.some((skill) => skill.id === "read_public_document"));
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "doc-key"), bag }),
        modelStream: (_model, context) => {
          const user = lastUser(context);
          if (user) seen.push(user);
          const blob = JSON.stringify(context.messages);
          assert.match(blob, /read_public_document/);
          assert.match(blob, /读取用户给出的公开文档/);
          assert.doesNotMatch(blob, /读公开文档是你自己|公开文档留在|不要交给远端/);
          if (step === 0) {
            step += 1;
            return toolCall("read_public_document", { goal: DOC_ASK });
          }
          const toolText = toolResultText(context);
          assert.match(toolText, /这个仓库讲 AI agent，第三章写用户记忆/);
          assert.notEqual(toolText, "做完了。");
          assert.doesNotMatch(toolText, /REMOTE-DUMP-MARKER/);
          return say("我看过了。这一章讲用户记忆。");
        },
      });
      try {
        const { shown, result } = await turn(DOC_ASK, session, new OpenHandsClient(adapter.baseUrl, "doc-key"));
        assert.equal(seen[0], DOC_ASK);
        assert.equal(adapter.tasks.length, 1);
        assert.equal(adapter.tasks[0]?.skillId, "read_public_document");
        assert.equal(adapter.tasks[0]?.goal, DOC_ASK);
        assert.match(adapter.tasks[0]?.goal || "", new RegExp(DOC_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.notEqual(adapter.tasks[0]?.skillId, "web_search");
        assert.notEqual(adapter.tasks[0]?.skillId, "edit_file");
        assert.equal(mock.creates.length, 1);
        assert.match(JSON.stringify(mock.creates[0]?.body), /github\.com\/bojieli\/ai-agent-book/);
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(bag.remote?.dispatched, true);
        assert.equal(shown, "我看过了。这一章讲用户记忆。");
        assert.doesNotMatch(shown, /改成|REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /这个仓库讲 AI agent/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-008: 用那台电脑上的浏览器打开网址 is an A2A browse task", async () => {
    const mock = await startMockOhServer({
      sessionKey: "browse-key",
      finishAfterPolls: 1,
      replyFor: () => `${DUMP}\n${PAGE_BODY}`,
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "browse-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    const seen: string[] = [];
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      assert.ok(skills.some((skill) => skill.id === "browse_on_computer"));
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "browse-key"), bag }),
        modelStream: (_model, context) => {
          const user = lastUser(context);
          if (user) seen.push(user);
          if (step === 0) {
            step += 1;
            return toolCall("browse_on_computer", { goal: BROWSE_ASK });
          }
          const toolText = toolResultText(context);
          assert.match(toolText, /页面写着示例文档/);
          assert.notEqual(toolText, "做完了。");
          assert.doesNotMatch(toolText, /REMOTE-DUMP-MARKER/);
          return say("打开了。页面在那台电脑上。");
        },
      });
      try {
        assert.equal(session.toolNames().includes("browse_on_computer"), true);
        assert.equal(session.toolNames().includes("ask_remote_agent"), false);
        const { shown, result } = await turn(BROWSE_ASK, session, new OpenHandsClient(adapter.baseUrl, "browse-key"));
        assert.equal(seen[0], BROWSE_ASK);
        assert.equal(adapter.tasks[0]?.skillId, "browse_on_computer");
        assert.equal(adapter.tasks[0]?.goal, BROWSE_ASK);
        assert.equal(mock.creates.length, 1);
        assert.match(JSON.stringify(mock.creates[0]?.body), /example\.com\/docs/);
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(bag.remote?.dispatched, true);
        assert.equal(shown, "打开了。页面在那台电脑上。");
        assert.doesNotMatch(shown, /REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /页面写着示例文档/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-009: a sentence that chats and edits is handed off, then answered in two sentences", async () => {
    const mock = await startMockOhServer({
      sessionKey: "mix-key",
      finishAfterPolls: 1,
      replyFor: () => DUMP,
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "mix-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    const order: string[] = [];
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "mix-key"), bag }),
        modelStream: (_model, context) => {
          const user = lastUser(context);
          if (user && step === 0) order.push(`pi:${user}`);
          if (step === 0) {
            step += 1;
            return toolCall("edit_file", { goal: MIXED_ASK });
          }
          order.push("pi-after");
          assert.ok(adapter.tasks.length >= 1);
          return say("改好了。就改了这一处。\n1. 打开文件\n2. 写入你好\n3. 保存");
        },
      });
      try {
        const { shown, result } = await turn(MIXED_ASK, session, new OpenHandsClient(adapter.baseUrl, "mix-key"));
        assert.equal(order[0], `pi:${MIXED_ASK}`);
        assert.equal(order[1], "pi-after");
        assert.equal(adapter.tasks[0]?.skillId, "edit_file");
        assert.equal(adapter.tasks[0]?.goal, MIXED_ASK);
        assert.equal(mock.creates.length, 1);
        assert.equal(shown, "改好了。就改了这一处。");
        assert.doesNotMatch(shown, /1\.|2\.|3\.|REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /REMOTE-DUMP-MARKER/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-010: a remote task that is still running is waited out, without the 60s line", async () => {
    const mock = await startMockOhServer({
      sessionKey: "wait-key",
      finishAfterPolls: 6,
      replyFor: () => "远程做完了。",
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "wait-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "wait-key"), bag }),
        modelStream: (_model, context) => {
          if (step === 0) {
            step += 1;
            return toolCall("run_command", { goal: "跑一下 uname" });
          }
          return say("跑完了。");
        },
      });
      try {
        const { shown } = await turn("跑一下 uname", session, new OpenHandsClient(adapter.baseUrl, "wait-key"));
        const conv = [...mock.conversations.values()][0];
        assert.ok(conv && conv.polls >= 6);
        assert.equal(adapter.tasks[0]?.skillId, "run_command");
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(bag.remote?.dispatched, true);
        assert.equal(shown, "跑完了。");
        assert.equal(shown.includes(REMOTE_TIMER_LINE), false);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-011: when the computer is down, the chat is only the connection sentence", async () => {
    const adapter = await startOpenHandsAdapter({
      client: new OpenHandsClient("http://127.0.0.1:9", "down"),
      pollMs: 5,
    });
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "down"), bag }),
        modelStream: (_model, context) => {
          if (step === 0) {
            step += 1;
            return toolCall("edit_file", { goal: EDIT_ASK });
          }
          const toolText = toolResultText(context);
          assert.equal(toolText, "连不上这台电脑。");
          assert.equal(toolText.includes(REMOTE_TIMER_LINE), false);
          return say("连不上这台电脑。");
        },
      });
      try {
        const { shown } = await turn(EDIT_ASK, session, new OpenHandsClient(adapter.baseUrl, "down"));
        assert.equal(adapter.tasks[0]?.skillId, "edit_file");
        assert.equal(shown, "连不上这台电脑。");
        assert.equal(shown.includes(REMOTE_TIMER_LINE), false);
        assert.equal(bag.remote?.dispatched, true);
        assert.equal(bag.remote?.failed, true);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
    }
  });

  it("TC-A2A-012: a dead A2A endpoint is a connection sentence and is not labeled A2A", async () => {
    const bag: SessionToolBag = {};
    const skills: RemoteSkill[] = [{ id: "edit_file", name: "改文件", description: "在那台电脑上改文件。" }];
    let step = 0;
    const session = await createOpenBotPiSession({
      language: "zh-CN",
      llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
      remoteSkills: skills,
      tools: localTools({ client: new OpenHandsClient("http://127.0.0.1:9", "x"), bag }),
      modelStream: () => {
        if (step === 0) {
          step += 1;
          return toolCall("edit_file", { goal: EDIT_ASK });
        }
        return say("连不上这台电脑。");
      },
    });
    try {
      const { shown } = await turn(EDIT_ASK, session, new OpenHandsClient("http://127.0.0.1:9", "x"));
      assert.equal(shown, "连不上这台电脑。");
      assert.equal(shown.includes(REMOTE_TIMER_LINE), false);
      assert.equal(bag.remote?.transport, "none");
      assert.equal(bag.remote?.dispatched, false);
      assert.notEqual(bag.remote?.transport, "a2a");
    } finally {
      session.dispose();
    }
  });

  it("TC-A2A-013: a long remote process stays in kept and is stripped from the chat", async () => {
    const mock = await startMockOhServer({
      sessionKey: "dump-key",
      finishAfterPolls: 1,
      replyFor: () => DUMP,
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "dump-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "dump-key"), bag }),
        modelStream: (_model, context) => {
          if (step === 0) {
            step += 1;
            return toolCall("run_command", { goal: "跑一下 uname" });
          }
          assert.doesNotMatch(JSON.stringify(context.messages), /REMOTE-DUMP-MARKER/);
          return say(`跑完了。\n${DUMP}`);
        },
      });
      try {
        const { shown, result } = await turn("跑一下 uname", session, new OpenHandsClient(adapter.baseUrl, "dump-key"));
        assert.equal(shown, "跑完了。");
        assert.doesNotMatch(shown, /REMOTE-DUMP-MARKER|先列目录|再打开文件|最后写回磁盘/);
        assert.match(result.kept || "", /REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /先列目录/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-014: a card that lists only some skills does not register the rest", async () => {
    const card = await serveJson((baseUrl) =>
      partialCard(baseUrl, [
        { id: "edit_file", name: "只改文件", description: "卡上只写了改文件。MARKER-PARTIAL-EDIT", tags: [], examples: [], inputModes: ["text/plain"], outputModes: ["text/plain"], securityRequirements: [] },
        { id: "bad skill", name: "非法", description: "空格不该注册", tags: [], examples: [], inputModes: [], outputModes: [], securityRequirements: [] },
        { id: "1nope", name: "数字开头", description: "不该注册", tags: [], examples: [], inputModes: [], outputModes: [], securityRequirements: [] },
      ]),
    );
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(card.baseUrl);
      assert.deepEqual(skills.map((skill) => skill.id), ["edit_file"]);
      assert.match(skills[0]?.description || "", /MARKER-PARTIAL-EDIT/);
      let sawPrompt = false;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: localTools({ client: new OpenHandsClient(card.baseUrl, "partial"), bag }),
        modelStream: (_model, context) => {
          const blob = JSON.stringify(context.messages);
          sawPrompt = /MARKER-PARTIAL-EDIT/.test(blob);
          assert.match(blob, /MARKER-PARTIAL-EDIT/);
          assert.doesNotMatch(blob, /run_command|browse_on_computer|ask_remote_agent|bad skill|web_search|read_public_document/);
          return say("这张卡上没有跑命令。");
        },
      });
      try {
        const names = session.toolNames();
        assert.equal(names.includes("edit_file"), true);
        assert.equal(names.includes("run_command"), false);
        assert.equal(names.includes("browse_on_computer"), false);
        assert.equal(names.includes("ask_remote_agent"), false);
        assert.equal(names.includes("bad skill"), false);
        assert.equal(names.includes("1nope"), false);
        assert.equal(names.includes("clock"), true);
        assert.equal(names.includes("web_search"), false);
        assert.equal(names.includes("read_public_document"), false);
        const { shown } = await turn("跑一下 uname", session, new OpenHandsClient(card.baseUrl, "partial"));
        assert.equal(sawPrompt, true);
        assert.equal(shown, "这张卡上没有跑命令。");
        assert.equal(bag.remote, undefined);
      } finally {
        session.dispose();
      }
    } finally {
      await card.stop();
    }
  });

  it("TC-A2A-015: a full card does not register the old ask_remote_agent", async () => {
    const mock = await startMockOhServer({ sessionKey: "full-key" });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "full-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "full-key"), bag }),
        modelStream: () => say("在。"),
      });
      try {
        const names = session.toolNames();
        assert.deepEqual(skills.map((skill) => skill.id).sort(), [
          "browse_on_computer",
          "edit_file",
          "read_public_document",
          "run_command",
          "web_search",
        ]);
        for (const skill of skills) assert.equal(names.includes(skill.id), true);
        assert.equal(names.includes("ask_remote_agent"), false);
        assert.equal(names.filter((name) => name === "ask_remote_agent").length, 0);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-016: 改代码 without a file stays a short local reply", async () => {
    const mock = await startMockOhServer({ sessionKey: "vague-key" });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "vague-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    const seen: string[] = [];
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "vague-key"), bag }),
        modelStream: (_model, context) => {
          seen.push(lastUser(context));
          return say("说一下改哪个文件。");
        },
      });
      try {
        const { shown } = await turn("改代码", session, new OpenHandsClient(adapter.baseUrl, "vague-key"));
        assert.deepEqual(seen, ["改代码"]);
        assert.equal(shown, "说一下改哪个文件。");
        assert.equal(adapter.tasks.length, 0);
        assert.equal(mock.creates.length, 0);
        assert.doesNotMatch(shown, /1\.|步骤|OpenHands/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-017: without a model key the sentence still reaches Pi and is not rule-answered", async () => {
    let searches = 0;
    const events: AgentEvent[] = [];
    const result = await runThreadTurn("现在几点", {
      client: new OpenHandsClient("http://127.0.0.1:9", "x"),
      store: new HandoffStore(),
      llm: { baseUrl: "http://127.0.0.1:9/v1", model: "none", apiKey: "" },
      language: "zh-CN",
      emit: (event) => events.push(event),
      searchWeb: async () => {
        searches += 1;
        return [];
      },
    });
    assert.equal(result.path, "pi");
    assert.equal(searches, 0);
    assert.equal(shownOf(events), NO_MODEL_KEY_TEXT);
    assert.doesNotMatch(shownOf(events), /现在是|上海|没在时限里跑完/);
    assert.equal(result.kept, undefined);
  });

  it("TC-A2A-018: a card without a usable skill list registers nothing remote", async () => {
    const missing = await serveJson(() => ({ name: "NoSkills", supportedInterfaces: [{ url: "http://127.0.0.1", protocolBinding: "HTTP+JSON", protocolVersion: "1.0", tenant: "" }] }));
    const nameless = await serveJson(() => ({ supportedInterfaces: [], skills: [{ id: "edit_file", name: "改文件", description: "不该出现" }] }));
    const junk = await serveJson(() => ({ name: "Junk", supportedInterfaces: [], skills: [{ id: "", description: "空" }, { id: "has space", description: "空格" }] }));
    try {
      assert.deepEqual(await loadRemoteSkills(missing.baseUrl), []);
      assert.deepEqual(await loadRemoteSkills(nameless.baseUrl), []);
      assert.deepEqual(await loadRemoteSkills(junk.baseUrl), []);
      assert.deepEqual(await loadRemoteSkills("http://127.0.0.1:9"), []);
    } finally {
      await missing.stop();
      await nameless.stop();
      await junk.stop();
    }
  });

  it("TC-A2A-019: the adapter card is the only source of the remote skills", async () => {
    const mock = await startMockOhServer({ sessionKey: "card-only" });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "card-only"), pollMs: 5 });
    try {
      const res = await fetch(`${adapter.baseUrl}/.well-known/agent-card.json`);
      assert.equal(res.ok, true);
      const body = (await res.json()) as { name?: string; supportedInterfaces?: Array<{ protocolBinding?: string }>; skills?: Array<{ id?: string }> };
      assert.equal(body.name, "OpenHands");
      assert.equal(body.supportedInterfaces?.[0]?.protocolBinding, "HTTP+JSON");
      assert.deepEqual((body.skills || []).map((skill) => skill.id).sort(), [
        "browse_on_computer",
        "edit_file",
        "read_public_document",
        "run_command",
        "web_search",
      ]);
      const skills = await loadRemoteSkills(adapter.baseUrl);
      assert.deepEqual(skills.map((skill) => skill.id).sort(), [
        "browse_on_computer",
        "edit_file",
        "read_public_document",
        "run_command",
        "web_search",
      ]);
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-020: a failed remote task keeps the long log out of the chat", async () => {
    const mock = await startMockOhServer({
      sessionKey: "fail-key",
      finishAfterPolls: 1,
      terminalStatus: "error",
      replyFor: () => DUMP,
    });
    const adapter = await startOpenHandsAdapter({ client: new OpenHandsClient(mock.baseUrl, "fail-key"), pollMs: 5 });
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      let step = 0;
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        kept: () => bag.remote?.fullText,
        tools: localTools({ client: new OpenHandsClient(adapter.baseUrl, "fail-key"), bag }),
        modelStream: (_model, context) => {
          if (step === 0) {
            step += 1;
            return toolCall("edit_file", { goal: EDIT_ASK });
          }
          assert.doesNotMatch(toolResultText(context), /REMOTE-DUMP-MARKER/);
          return say("这台电脑这轮没做成。你换一句再试。");
        },
      });
      try {
        const { shown, result } = await turn(EDIT_ASK, session, new OpenHandsClient(adapter.baseUrl, "fail-key"));
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(bag.remote?.failed, true);
        assert.equal(shown, "这台电脑这轮没做成。你换一句再试。");
        assert.equal(shown.includes(REMOTE_TIMER_LINE), false);
        assert.doesNotMatch(shown, /REMOTE-DUMP-MARKER/);
        assert.match(result.kept || "", /REMOTE-DUMP-MARKER/);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-021: without a card the old channel waits and is not called A2A", async () => {
    const mock = await startMockOhServer({
      sessionKey: "old-key",
      finishAfterPolls: 6,
      replyFor: () => "远程做完了。",
    });
    try {
      assert.deepEqual(await loadRemoteSkills(mock.baseUrl), []);
      const result = await runRemoteTask("跑一下 uname", {
        client: new OpenHandsClient(mock.baseUrl, "old-key"),
        pollMs: 5,
        language: "zh-CN",
      });
      const conv = [...mock.conversations.values()][0];
      assert.ok(conv && conv.polls >= 6);
      assert.equal(result.transport, "openhands");
      assert.notEqual(result.transport, "a2a");
      assert.equal(result.dispatched, undefined);
      assert.equal(result.text.includes(REMOTE_TIMER_LINE), false);
      assert.match(result.text, /远程做完了|uname/);
    } finally {
      await mock.stop();
    }
  });

  it("TC-A2A-022: local tools stay registered when there is no card", async () => {
    const bag: SessionToolBag = {};
    const session = await createOpenBotPiSession({
      language: "zh-CN",
      llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
      remoteSkills: [],
      tools: localTools({ client: new OpenHandsClient("http://127.0.0.1:9", "x"), bag }),
      modelStream: (_model, context) => {
        const blob = JSON.stringify(context.messages);
        assert.match(blob, /时钟是你自己的小工具/);
        assert.doesNotMatch(blob, /read_public_document|web_search|查询公开网页|读取用户给出的公开文档/);
        return say("在。");
      },
    });
    try {
      const names = session.toolNames();
      assert.equal(names.includes("clock"), true);
      assert.equal(names.includes("read_public_document"), false);
      assert.equal(names.includes("web_search"), false);
      assert.equal(names.includes("edit_file"), false);
      assert.equal(names.includes("run_command"), false);
      assert.equal(names.includes("browse_on_computer"), false);
      assert.equal(names.includes("ask_remote_agent"), false);
      assert.equal(session.skillKey, "");
    } finally {
      session.dispose();
    }
  });

  it("TC-A2A-023: an empty sentence is refused before any remote call", async () => {
    const mock = await startMockOhServer({ sessionKey: "empty-key" });
    try {
      await assert.rejects(
        () =>
          runThreadTurn("   ", {
            client: new OpenHandsClient(mock.baseUrl, "empty-key"),
            store: new HandoffStore(),
            emit: () => undefined,
            language: "zh-CN",
          }),
        /message required/,
      );
      assert.equal(mock.creates.length, 0);
    } finally {
      await mock.stop();
    }
  });
});
