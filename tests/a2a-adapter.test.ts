import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { startOpenHandsAdapter } from "../src/a2a-adapter/server.js";
import { HandoffStore } from "../src/handoff.js";
import { OpenHandsClient } from "../src/oh-client.js";
import { createOpenBotPiSession } from "../src/pi-kernel.js";
import { assistantTextMessage, emitAssistantMessage, userText } from "../src/pi-stream.js";
import { loadRemoteSkills } from "../src/remote-agent.js";
import { createSessionTools, type SessionToolBag } from "../src/session-tools.js";
import { runThreadTurn } from "../src/thread.js";
import type { AgentEvent } from "../src/types.js";
import { startMockOhServer } from "./oh-mock.js";

const DUMP = "REMOTE-DUMP-MARKER\n这是远端留下的长输出，聊天里不该原样出现。";

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

function shownOf(events: AgentEvent[]): string {
  return events.filter((event) => event.type === "token").map((event) => String(event.text || "")).join("");
}

describe("A2A adapter", () => {
  it("TC-A2A-001: a basic question is a short Pi reply and does not call the remote", async () => {
    const mock = await startMockOhServer({ sessionKey: "no-card" });
    const seen: string[] = [];
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(mock.baseUrl);
      assert.deepEqual(skills, []);
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: createSessionTools({
          client: () => new OpenHandsClient(mock.baseUrl, "no-card"),
          oh: () => undefined,
          language: () => "zh-CN",
          conversationId: () => undefined,
          bag,
        }),
        modelStream: (_model, context) => {
          const last = [...context.messages].reverse().find((message) => message.role === "user");
          seen.push(userText(last?.content));
          const stream = createAssistantMessageEventStream();
          emitAssistantMessage(stream, assistantTextMessage("在。\n1. 先打开文件\n2. 再改一行\n3. 最后保存"));
          return stream;
        },
      });
      try {
        assert.deepEqual(
          session.toolNames().filter((name) => name === "edit_file" || name === "run_command" || name === "browse_on_computer"),
          [],
        );
        const events: AgentEvent[] = [];
        const result = await runThreadTurn("在吗", {
          pi: session,
          client: new OpenHandsClient(mock.baseUrl, "no-card"),
          store: new HandoffStore(),
          emit: (event) => events.push(event),
          language: "zh-CN",
        });
        assert.deepEqual(seen, ["在吗"]);
        const shown = shownOf(events);
        assert.equal(shown, "在。");
        assert.doesNotMatch(shown, /1\.|2\.|3\./);
        assert.equal(mock.creates.length, 0);
        assert.equal(bag.remote, undefined);
        assert.equal(result.kept, undefined);
        assert.equal(mock.requests.some((req) => req.url.includes("message:send")), false);
      } finally {
        session.dispose();
      }
    } finally {
      await mock.stop();
    }
  });

  it("TC-A2A-002: editing a file or running a command is an A2A task, not work Pi does itself", async () => {
    const mock = await startMockOhServer({
      sessionKey: "card-key",
      finishAfterPolls: 1,
      replyFor: (goal) => `${DUMP}\n${goal}`,
    });
    const adapter = await startOpenHandsAdapter({
      client: new OpenHandsClient(mock.baseUrl, "card-key"),
      pollMs: 10,
    });
    const readme = path.join(process.cwd(), "README.md");
    const readmeBefore = fs.existsSync(readme) ? fs.readFileSync(readme, "utf8") : undefined;
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(adapter.baseUrl);
      assert.ok(skills.some((skill) => skill.id === "edit_file"));
      assert.ok(skills.some((skill) => skill.id === "run_command"));
      let step = 0;
      const seen: string[] = [];
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: createSessionTools({
          client: () => new OpenHandsClient(adapter.baseUrl, "card-key"),
          oh: () => undefined,
          language: () => "zh-CN",
          conversationId: () => undefined,
          pollMs: 10,
          bag,
        }),
        kept: () => bag.remote?.fullText,
        modelStream: (_model, context) => {
          const last = [...context.messages].reverse().find((message) => message.role === "user");
          const text = userText(last?.content);
          if (text) seen.push(text);
          const blob = JSON.stringify(context.messages);
          assert.doesNotMatch(blob, /REMOTE-DUMP-MARKER/);
          if (step === 0) {
            step += 1;
            return toolCallStream("edit_file", { goal: "把 README.md 改成一行：你好" });
          }
          if (step === 1) {
            step += 1;
            assert.ok(adapter.tasks.length >= 1);
            const stream = createAssistantMessageEventStream();
            emitAssistantMessage(stream, assistantTextMessage("改好了。写进那个文件了。"));
            return stream;
          }
          if (step === 2) {
            step += 1;
            return toolCallStream("run_command", { goal: "跑一下 uname" });
          }
          const stream = createAssistantMessageEventStream();
          emitAssistantMessage(stream, assistantTextMessage("跑完了。"));
          return stream;
        },
      });
      try {
        const names = session.toolNames();
        for (const skill of skills) assert.ok(names.includes(skill.id));
        assert.equal(names.includes("ask_remote_agent"), false);
        const editEvents: AgentEvent[] = [];
        const edit = await runThreadTurn("把 README.md 改成一行：你好", {
          pi: session,
          client: new OpenHandsClient(adapter.baseUrl, "card-key"),
          store: new HandoffStore(),
          emit: (event) => editEvents.push(event),
          language: "zh-CN",
        });
        const editShown = shownOf(editEvents);
        assert.equal(editShown, "改好了。写进那个文件了。");
        assert.doesNotMatch(editShown, /REMOTE-DUMP-MARKER/);
        assert.match(edit.kept || "", /REMOTE-DUMP-MARKER/);
        assert.equal(adapter.tasks[0]?.skillId, "edit_file");
        assert.match(adapter.tasks[0]?.goal || "", /README\.md/);
        assert.equal(mock.creates.length, 1);
        assert.match(JSON.stringify(mock.creates[0]?.body), /README\.md/);
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(bag.remote?.dispatched, true);

        const commandEvents: AgentEvent[] = [];
        const command = await runThreadTurn("跑一下 uname", {
          pi: session,
          client: new OpenHandsClient(adapter.baseUrl, "card-key"),
          store: new HandoffStore(),
          emit: (event) => commandEvents.push(event),
          language: "zh-CN",
        });
        assert.equal(adapter.tasks.at(-1)?.skillId, "run_command");
        assert.match(adapter.tasks.at(-1)?.goal || "", /uname/);
        assert.equal(mock.creates.length, 2);
        assert.equal(bag.remote?.transport, "a2a");
        assert.equal(shownOf(commandEvents), "跑完了。");
        assert.doesNotMatch(shownOf(commandEvents), /REMOTE-DUMP-MARKER/);
        assert.match(command.kept || "", /REMOTE-DUMP-MARKER/);
        assert.equal(seen[0], "把 README.md 改成一行：你好");
        assert.equal(fs.existsSync(readme) ? fs.readFileSync(readme, "utf8") : undefined, readmeBefore);
      } finally {
        session.dispose();
      }
    } finally {
      await adapter.stop();
      await mock.stop();
    }
  });

  it("TC-A2A-003: without an agent card, a file edit is not reported as A2A", async () => {
    const mock = await startMockOhServer({ sessionKey: "bare-oh" });
    const bag: SessionToolBag = {};
    try {
      const skills = await loadRemoteSkills(mock.baseUrl);
      assert.deepEqual(skills, []);
      const session = await createOpenBotPiSession({
        language: "zh-CN",
        llm: { baseUrl: "http://127.0.0.1:9/v1", model: "stub", apiKey: "test-key" },
        remoteSkills: skills,
        tools: createSessionTools({
          client: () => new OpenHandsClient(mock.baseUrl, "bare-oh"),
          oh: () => undefined,
          language: () => "zh-CN",
          conversationId: () => undefined,
          bag,
        }),
        modelStream: (_model, context) => {
          const blob = JSON.stringify(context.messages);
          assert.match(blob, /把 README\.md 改成一行：你好/);
          assert.doesNotMatch(blob, /edit_file|run_command|ask_remote_agent/);
          const stream = createAssistantMessageEventStream();
          emitAssistantMessage(stream, assistantTextMessage("这会儿没有远端能力，我这边改不了那个文件。"));
          return stream;
        },
      });
      try {
        assert.equal(session.toolNames().includes("edit_file"), false);
        const events: AgentEvent[] = [];
        const result = await runThreadTurn("把 README.md 改成一行：你好", {
          pi: session,
          client: new OpenHandsClient(mock.baseUrl, "bare-oh"),
          store: new HandoffStore(),
          emit: (event) => events.push(event),
          language: "zh-CN",
        });
        const shown = shownOf(events);
        assert.match(shown, /改不了/);
        assert.doesNotMatch(shown, /REMOTE-DUMP|A2A|agent card 已/);
        assert.equal(mock.creates.length, 0);
        assert.equal(bag.remote?.transport, undefined);
        assert.notEqual(bag.remote?.transport, "a2a");
        assert.equal(result.kept, undefined);
        assert.equal(mock.requests.some((req) => req.url.includes("message:send") || req.url === "/api/conversations"), false);
      } finally {
        session.dispose();
      }
    } finally {
      await mock.stop();
    }
  });
});
