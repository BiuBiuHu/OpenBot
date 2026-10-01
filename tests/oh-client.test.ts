import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { defaultConfig, hasLocalModelKey, loadConfig } from "../src/config.js";
import { deliverConfirmedHandoff, HandoffStore, runHandoffTurn } from "../src/handoff.js";
import {
  conversationSnippet,
  mapExecutionStatus,
  OpenHandsClient,
  OpenHandsError,
  remoteConversationFailed,
  remoteLlmOverride,
  buildAgentLlm,
  DEFAULT_REMOTE_LLM_MODEL,
} from "../src/oh-client.js";
import {
  agentEventsFromOh,
  agentReplyText,
  clientVisibleReplyTexts,
  messageTextsFromEvent,
  normalizeOhEvent,
} from "../src/oh-events.js";
import { repoRoot } from "../src/paths.js";
import { startControlPlane } from "../src/server.js";
import { runThreadTurn } from "../src/thread.js";
import { freePort, startWorker } from "./helpers.js";
import { startMockOhServer } from "./oh-mock.js";
import type { AgentEvent } from "../src/types.js";

describe("OH runtime adapter (mocked Agent Server)", () => {
  it("TC-OH-000: maps OH execution_status onto the product task machine", () => {
    assert.equal(mapExecutionStatus("idle"), "queued");
    assert.equal(mapExecutionStatus("running"), "running");
    assert.equal(mapExecutionStatus("waiting_for_confirmation"), "awaiting_approval");
    assert.equal(mapExecutionStatus("finished"), "succeeded");
    assert.equal(mapExecutionStatus("error"), "failed");
    assert.equal(mapExecutionStatus("stuck"), "failed");
    assert.equal(mapExecutionStatus("deleting"), "cancelled");
  });

  it("TC-OH-000b: extracts a final snippet from OH event pages", () => {
    const snippet = conversationSnippet({
      items: [
        { kind: "MessageEvent", content: [{ type: "text", text: "user goal" }] },
        { kind: "MessageEvent", message: { content: [{ text: "agent reply" }] } },
      ],
    });
    assert.match(snippet, /user goal/);
    assert.match(snippet, /agent reply/);
  });
});

describe("OpenHandsClient against mock HTTP", () => {
  let mock: Awaited<ReturnType<typeof startMockOhServer>>;
  let client: OpenHandsClient;

  before(async () => {
    mock = await startMockOhServer({ sessionKey: "k-oh-test" });
    client = new OpenHandsClient(mock.baseUrl, "k-oh-test");
  });

  after(async () => {
    await mock?.stop();
  });

  it("TC-OH-001: health() is ok without treating extra fields as fatal", async () => {
    const probe = await client.health();
    assert.equal(probe.ok, true);
    assert.equal((probe.raw as { status?: string }).status, "ok");
  });

  it("TC-OH-002: createConversation + poll + events snippet", async () => {
    const created = await client.createConversation({
      goal: "write a uname note",
      model: "test/mock",
    });
    assert.match(created.id, /^00000000-0000-4000-8000-/);
    assert.equal(created.executionStatus, "running");
    assert.equal(created.status, "running");

    const final = await client.pollConversation(created.id, { timeoutMs: 2000, pollMs: 20 });
    assert.equal(final.executionStatus, "finished");
    assert.equal(final.status, "succeeded");

    const events = await client.searchEvents(created.id, { limit: 20 });
    assert.match(conversationSnippet(events), /done: write a uname note/);
  });

  it("TC-OH-003: listConversations and sendMessage send X-Session-API-Key", async () => {
    const page = await client.listConversations({ limit: 10 });
    assert.ok(page.items.length >= 1);
    const sent = await client.sendMessage(page.items[0].id, "follow up");
    assert.equal(sent.success, true);
    const apiCalls = mock.requests.filter((r) => r.url.startsWith("/api/"));
    assert.ok(apiCalls.every((r) => r.key === "k-oh-test"));
  });

  it("TC-OH-004: wrong session key is 401", async () => {
    const bad = new OpenHandsClient(mock.baseUrl, "wrong");
    await assert.rejects(() => bad.listConversations(), (err: unknown) => {
      assert.ok(err instanceof OpenHandsError);
      assert.equal(err.status, 401);
      return true;
    });
  });

  it("TC-OH-005: confirmed handoff creates an OH conversation", async () => {
    const delivery = await deliverConfirmedHandoff(
      client,
      { goal: "list /tmp", threadId: "chat_1" },
      {
        baseUrl: mock.baseUrl,
        sessionApiKey: "k-oh-test",
        workspaceDir: "workspace/project",
        llmModel: "test/mock",
        llmApiKey: "",
      },
    );
    assert.equal(delivery.proposal.goal, "list /tmp");
    assert.ok(delivery.conversation.id);
    assert.equal(mock.conversations.get(delivery.conversation.id)?.goal, "list /tmp");
  });

  it("TC-OH-016: create payload has agent.llm and no empty OpenAI api_key", async () => {
    const fromLocalOpenAi = buildAgentLlm({ model: "gpt-4o-mini", apiKey: "" });
    assert.equal(fromLocalOpenAi.model, DEFAULT_REMOTE_LLM_MODEL);
    assert.equal(fromLocalOpenAi.api_key, undefined);
    assert.equal(remoteLlmOverride({ model: "gpt-4o-mini", apiKey: "" }), undefined);
    const created = await client.createConversation({ goal: "do not send local openai" });
    const recorded = mock.creates.find((c) => c.id === created.id);
    assert.ok(recorded);
    const llm = (recorded?.body.agent as { llm?: Record<string, unknown> })?.llm;
    assert.ok(llm, "1.49.2 requires agent.llm");
    assert.equal(llm.model, DEFAULT_REMOTE_LLM_MODEL);
    assert.ok(!Object.hasOwn(llm, "api_key"), "empty OpenAI key must not be sent");
    assert.equal(recorded?.llm?.model, DEFAULT_REMOTE_LLM_MODEL);
    assert.equal(recorded?.llm?.api_key, undefined);
  });

  it("TC-OH-017: explicit remote model+key is sent on create", async () => {
    const llm = buildAgentLlm(undefined, {
      baseUrl: mock.baseUrl,
      sessionApiKey: "k-oh-test",
      workspaceDir: "workspace/project",
      llmModel: "test/remote",
      llmApiKey: "remote-key",
    });
    assert.deepEqual(llm, { model: "test/remote", api_key: "remote-key" });
    const created = await client.createConversation(
      { goal: "use host override", model: "test/remote", apiKey: "remote-key" },
    );
    const recorded = mock.creates.find((c) => c.id === created.id);
    assert.equal(recorded?.llm?.model, "test/remote");
    assert.equal(recorded?.llm?.api_key, "remote-key");
  });

  it("TC-OH-019: .env with OPENAI_MODEL and empty OPENAI_API_KEY still sends DeepSeek", async () => {
    const prevHome = process.env.OPENBOT_HOME;
    const prevModel = process.env.OPENAI_MODEL;
    const prevKey = process.env.OPENAI_API_KEY;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-env-empty-key-"));
    try {
      process.env.OPENBOT_HOME = home;
      delete process.env.OPENAI_MODEL;
      delete process.env.OPENAI_API_KEY;
      fs.writeFileSync(path.join(home, ".env"), "OPENAI_MODEL=gpt-4o-mini\nOPENAI_API_KEY=\n");
      fs.writeFileSync(
        path.join(home, "config.json"),
        JSON.stringify({
          llm: {
            model: "gpt-4o-mini",
            apiKey: "sk-leftover-from-init",
            baseUrl: "https://api.openai.com/v1",
          },
          openhands: { llmModel: "gpt-4o-mini" },
        }) + "\n",
      );
      const cfg = loadConfig();
      assert.equal(cfg.llm.apiKey, "");
      assert.equal(hasLocalModelKey(cfg.llm.apiKey), false);
      const created = await client.createConversation({ goal: "uname from file env" }, cfg.openhands);
      const recorded = mock.creates.find((c) => c.id === created.id);
      assert.ok(recorded);
      const llm = (recorded?.body.agent as { llm?: Record<string, unknown> })?.llm;
      assert.ok(llm, "1.49.2 requires agent.llm");
      assert.equal(llm.model, DEFAULT_REMOTE_LLM_MODEL);
      assert.ok(!Object.hasOwn(llm, "api_key"), "empty OpenAI key must not be sent");

      const events: AgentEvent[] = [];
      const result = await runThreadTurn("uname from file env", {
        client,
        oh: cfg.openhands,
        llm: cfg.llm,
        store: new HandoffStore(),
        emit: (e) => events.push(e),
        waitForConfirm: async () => true,
        timeoutMs: 2000,
        pollMs: 20,
      });
      assert.equal(result.path, "handoff");

      const cli = path.join(repoRoot(), "src/cli.ts");
      const env = {
        ...process.env,
        OPENBOT_HOME: home,
        OH_BASE_URL: mock.baseUrl,
        OH_SESSION_API_KEY: "k-oh-test",
      };
      delete env.OPENAI_API_KEY;
      delete env.OPENAI_MODEL;
      const run = await runCli([cli, "chat", "uname from file env", "--timeout", "5", "--poll-ms", "20"], env);
      assert.equal(run.code, 0, run.out);
      const cliCreate = mock.creates.at(-1);
      assert.equal(cliCreate?.llm?.model, DEFAULT_REMOTE_LLM_MODEL);
      assert.equal(cliCreate?.llm?.api_key, undefined);
    } finally {
      if (prevHome === undefined) delete process.env.OPENBOT_HOME;
      else process.env.OPENBOT_HOME = prevHome;
      if (prevModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = prevModel;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("CLI openbot oh against mock", () => {
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-oh-cli-"));
  let mock: Awaited<ReturnType<typeof startMockOhServer>>;

  before(async () => {
    process.env.OPENBOT_HOME = home;
    mock = await startMockOhServer({ sessionKey: "cli-key" });
  });

  after(async () => {
    await mock?.stop();
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-OH-006: openbot oh health / run print id and snippet", async () => {
    const cli = path.join(repoRoot(), "src/cli.ts");
    const env = {
      ...process.env,
      OPENBOT_HOME: home,
      OH_BASE_URL: mock.baseUrl,
      OH_SESSION_API_KEY: "cli-key",
      OPENHANDS_LLM_MODEL: "test/mock",
    };
    const health = await runCli([cli, "oh", "health"], env);
    assert.equal(health.code, 0, health.out);
    assert.match(health.out, /OpenHands /);
    assert.match(health.out, /ok/);

    const run = await runCli([cli, "oh", "run", "summarize uname", "--timeout", "5", "--poll-ms", "20"], env);
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /conversation=00000000-0000-4000-8000-/);
    assert.match(run.out, /status=finished/);
    assert.match(run.out, /snippet:/);
    assert.match(run.out, /done: summarize uname/);
  });
});

describe("control plane handoff stub", () => {
  let worker: Awaited<ReturnType<typeof startWorker>>;
  let plane: Awaited<ReturnType<typeof startControlPlane>>;
  let mock: Awaited<ReturnType<typeof startMockOhServer>>;
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-oh-plane-"));

  before(async () => {
    process.env.OPENBOT_HOME = home;
    worker = await startWorker();
    mock = await startMockOhServer({ sessionKey: "plane-key" });
    const config = defaultConfig();
    config.host.hostname = "127.0.0.1";
    config.worker.token = worker.token;
    config.worker.localPort = worker.port;
    config.controlPlane.port = await freePort();
    config.openhands.baseUrl = mock.baseUrl;
    config.openhands.sessionApiKey = "plane-key";
    plane = await startControlPlane(config, { skipTunnel: true, worker: worker.client });
  });

  after(async () => {
    await plane?.close();
    worker?.stop();
    await mock?.stop();
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-OH-007: /api/status reports OH health; propose then confirm creates a conversation", async () => {
    const port = plane.config.controlPlane.port;
    const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json() as {
      openhands?: { ok?: boolean; baseUrl?: string };
    };
    assert.equal(status.openhands?.ok, true);
    assert.equal(status.openhands?.baseUrl, mock.baseUrl);

    const proposed = await (
      await fetch(`http://127.0.0.1:${port}/api/handoffs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "touch NOTES.md", thread_id: "chat_default" }),
      })
    ).json() as { ok: boolean; needs_confirm?: boolean; proposal?: { id: string } };
    assert.equal(proposed.ok, true);
    assert.equal(proposed.needs_confirm, true);
    assert.ok(proposed.proposal?.id);

    const confirmed = await (
      await fetch(`http://127.0.0.1:${port}/api/handoffs/${proposed.proposal!.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow: true }),
      })
    ).json() as {
      ok: boolean;
      conversation?: { id: string; status: string };
    };
    assert.equal(confirmed.ok, true);
    assert.ok(confirmed.conversation?.id);
    assert.ok(mock.conversations.has(confirmed.conversation!.id));
  });
});

describe("web → OpenHands (no worker)", () => {
  let plane: Awaited<ReturnType<typeof startControlPlane>>;
  let mock: Awaited<ReturnType<typeof startMockOhServer>>;
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-oh-web-"));

  before(async () => {
    process.env.OPENBOT_HOME = home;
    mock = await startMockOhServer({ sessionKey: "web-key" });
    const config = defaultConfig();
    config.controlPlane.port = await freePort();
    config.openhands.baseUrl = mock.baseUrl;
    config.openhands.sessionApiKey = "web-key";
    plane = await startControlPlane(config, { skipTunnel: true, allowWithoutWorker: true });
  });

  after(async () => {
    await plane?.close();
    await mock?.stop();
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-OH-010: laptop trial page /oh-test and /api/oh/health", async () => {
    const port = plane.config.controlPlane.port;
    const page = await (await fetch(`http://127.0.0.1:${port}/oh-test`)).text();
    assert.match(page, /本机试连远端/);
    assert.match(page, /8000:127\.0\.0\.1:8000/);
    assert.match(page, /我确认，发给远端/);
    const health = (await (await fetch(`http://127.0.0.1:${port}/api/oh/health`)).json()) as {
      ok?: boolean;
      hasSessionKey?: boolean;
      baseUrl?: string;
    };
    assert.equal(health.ok, true);
    assert.equal(health.hasSessionKey, true);
    assert.equal(health.baseUrl, mock.baseUrl);
    assert.ok(!JSON.stringify(health).includes("web-key"));

    const created = (await (
      await fetch(`http://127.0.0.1:${port}/api/handoffs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "laptop trial ping", allow: true }),
      })
    ).json()) as { ok?: boolean; conversation?: { id: string } };
    assert.equal(created.ok, true);
    const id = created.conversation!.id;
    const snap = (await (await fetch(`http://127.0.0.1:${port}/api/conversations/${id}`)).json()) as {
      ok?: boolean;
      conversation?: { id: string };
      snippet?: string;
    };
    assert.equal(snap.ok, true);
    assert.equal(snap.conversation?.id, id);
  });

  it("TC-OH-008: serve without bind; page is This computer; status.ok follows OH", async () => {
    const port = plane.config.controlPlane.port;
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /This computer/);
    assert.match(html, /\/api\/chat/);
    assert.match(html, /直接开始对话/);
    assert.match(html, /Assistant/);
    assert.match(html, /: "You"/);
    assert.doesNotMatch(html, /Confirm handoff|Not now|REMOTE/);
    const status = (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()) as {
      ok?: boolean;
      openhands?: { ok?: boolean };
    };
    assert.equal(status.openhands?.ok, true);
    assert.equal(status.ok, true);
  });

  it("TC-OH-009: stream sends immediately and returns the final answer", async () => {
    const port = plane.config.controlPlane.port;
    const events = await readSse(`http://127.0.0.1:${port}/api/handoffs/stream`, {
      goal: "list workspace",
      timeout_ms: 3000,
      poll_ms: 20,
    });
    assert.ok(!events.some((e) => e.type === "handoff_proposal"));
    assert.ok(!events.some((e) => e.type === "status" && /ConversationStateUpdateEvent|running|finished/.test(String(e.text))));
    assert.ok(events.some((e) => e.type === "done"));
    const answers = events.filter((e) => e.type === "token").map((e) => String(e.text || ""));
    assert.ok(
      answers.some((t) => /list workspace/.test(t)),
      `expected a reply mentioning the goal, got ${JSON.stringify(answers)}`,
    );
    const listed = (await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json()) as {
      conversations: Array<{ id: string }>;
    };
    assert.ok(listed.conversations.length >= 1);
  });

  it("TC-OH-011: /api/chat without worker streams the same-thread reply", async () => {
    const port = plane.config.controlPlane.port;
    const events = await readSse(`http://127.0.0.1:${port}/api/chat`, {
      message: "uname and summarize",
      handoff: true,
      timeout_ms: 3000,
      poll_ms: 20,
    });
    assert.ok(!events.some((e) => e.type === "handoff_proposal"));
    assert.ok(events.some((e) => e.type === "token" && /uname and summarize/.test(String(e.text || ""))));
    assert.ok(events.some((e) => e.type === "done"));
    assert.ok(!events.some((e) => e.type === "error" && String(e.message || "").includes("worker not bound")));
  });

  it("TC-OH-021: second chat message continues the same conversation", async () => {
    const port = plane.config.controlPlane.port;
    const beforeCreates = mock.creates.length;
    const threadId = "chat_continue";
    const first = await readSse(`http://127.0.0.1:${port}/api/chat`, {
      message: "first turn",
      handoff: true,
      thread_id: threadId,
      timeout_ms: 3000,
      poll_ms: 20,
    });
    assert.ok(!first.some((e) => e.type === "handoff_proposal"));
    assert.ok(first.some((e) => e.type === "token" && /done: first turn/.test(String(e.text || ""))));
    assert.ok(first.some((e) => e.type === "done"));
    assert.equal(mock.creates.length, beforeCreates + 1);
    const convId = mock.creates[mock.creates.length - 1]?.id;
    assert.ok(convId);

    const second = await readSse(`http://127.0.0.1:${port}/api/chat`, {
      message: "second turn",
      handoff: true,
      thread_id: threadId,
      timeout_ms: 3000,
      poll_ms: 20,
    });
    assert.equal(mock.creates.length, beforeCreates + 1);
    assert.ok(mock.messages.some((m) => m.id === convId && m.text === "second turn"));
    assert.ok(!second.some((e) => e.type === "handoff_proposal"));
    assert.ok(second.some((e) => e.type === "token" && /done: second turn/.test(String(e.text || ""))));
    assert.ok(second.some((e) => e.type === "done"));
  });
});

describe("OH event mapping", () => {
  it("TC-OH-012: maps action / observation / agent text; skips user echo", () => {
    const user = normalizeOhEvent(
      { id: "u1", kind: "MessageEvent", source: "user", content: [{ text: "goal" }] },
      0,
    );
    assert.deepEqual(agentEventsFromOh(user), []);
    const action = normalizeOhEvent(
      { id: "a1", kind: "ActionEvent", source: "agent", action: { kind: "CmdRunAction", command: "uname -a" } },
      1,
    );
    const actionEv = agentEventsFromOh(action);
    assert.equal(actionEv[0]?.type, "tool_start");
    const obs = normalizeOhEvent(
      {
        id: "o1",
        kind: "ObservationEvent",
        source: "agent",
        observation: { kind: "CmdOutputObservation", content: "Linux box" },
      },
      2,
    );
    const obsEv = agentEventsFromOh(obs);
    assert.equal(obsEv[0]?.type, "tool_result");
    assert.match((obsEv[0] as { result?: string }).result || "", /Linux box/);
    const answer = normalizeOhEvent(
      { id: "t1", kind: "MessageEvent", source: "agent", content: [{ text: "all done" }] },
      3,
    );
    const mappedAnswer = agentEventsFromOh(answer);
    assert.equal(mappedAnswer[0]?.type, "token");
    assert.equal(mappedAnswer[0] && "text" in mappedAnswer[0] ? mappedAnswer[0].text : "", "all done");
    const monologue = normalizeOhEvent(
      {
        id: "t2",
        kind: "ActionEvent",
        source: "agent",
        thought: [{ type: "text", text: "I will look around." }],
        action: { kind: "CmdRunAction", command: "ls" },
      },
      4,
    );
    const monoEv = agentEventsFromOh(monologue);
    assert.equal(monoEv[0]?.type, "thought");
    assert.equal(monoEv[1]?.type, "tool_start");
  });

  it("TC-OH-020: 1.49.2 finished conversation shows agent reply, not only state kinds", () => {
    const fixture = [
      {
        id: "s1",
        kind: "ConversationStateUpdateEvent",
        source: "environment",
        key: "execution_status",
        value: "idle",
      },
      {
        id: "u1",
        kind: "MessageEvent",
        source: "user",
        llm_message: { role: "user", content: [{ type: "text", text: "你是谁？" }] },
      },
      {
        id: "s2",
        kind: "ConversationStateUpdateEvent",
        source: "environment",
        key: "execution_status",
        value: "running",
      },
      {
        id: "s3",
        kind: "ConversationStateUpdateEvent",
        source: "environment",
        key: "full_state",
        value: { execution_status: "running" },
      },
      {
        id: "a1",
        kind: "MessageEvent",
        source: "agent",
        llm_message: {
          role: "assistant",
          content: [{ type: "text", text: "我是 OpenHands 助手，跑在你的主机上。" }],
        },
      },
      {
        id: "s4",
        kind: "ConversationStateUpdateEvent",
        source: "environment",
        key: "execution_status",
        value: "finished",
      },
    ];
    const extracted = messageTextsFromEvent(fixture[4]);
    assert.match(extracted.join("\n"), /OpenHands/);
    assert.equal(messageTextsFromEvent(fixture[0]).join(""), "");
    const replies = clientVisibleReplyTexts(fixture);
    assert.ok(
      replies.some((t) => /OpenHands/.test(t)),
      `expected reply text, got ${JSON.stringify(replies)}`,
    );
    assert.ok(!replies.some((t) => /ConversationStateUpdateEvent/.test(t)));
    assert.equal(agentReplyText(fixture), "我是 OpenHands 助手，跑在你的主机上。");
    const state = normalizeOhEvent(fixture[2], 2);
    assert.deepEqual(agentEventsFromOh(state), []);
    const finished = normalizeOhEvent(fixture[5], 5);
    assert.deepEqual(agentEventsFromOh(finished), []);
    const user = normalizeOhEvent(fixture[1], 1);
    assert.deepEqual(agentEventsFromOh(user), []);
    const agent = normalizeOhEvent(fixture[4], 4);
    assert.equal(agentEventsFromOh(agent)[0]?.type, "token");
  });
});

describe("handoff error and chat CLI against mock", () => {
  const prevHome = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-oh-err-"));
  let mock: Awaited<ReturnType<typeof startMockOhServer>>;

  before(async () => {
    process.env.OPENBOT_HOME = home;
    mock = await startMockOhServer({ sessionKey: "err-key", terminalStatus: "error", finishAfterPolls: 2 });
  });

  after(async () => {
    await mock?.stop();
    if (prevHome === undefined) delete process.env.OPENBOT_HOME;
    else process.env.OPENBOT_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("TC-OH-013: failed remote conversation emits error then done", async () => {
    const client = new OpenHandsClient(mock.baseUrl, "err-key");
    const events: AgentEvent[] = [];
    const last = await runHandoffTurn("explode", {
      client,
      store: new HandoffStore(),
      emit: (e) => events.push(e),
      waitForConfirm: async () => true,
      timeoutMs: 2000,
      pollMs: 20,
    });
    assert.equal(last?.status, "failed");
    assert.ok(events.some((e) => e.type === "error"));
    assert.ok(events.some((e) => e.type === "done"));
    assert.ok(events.some((e) => e.type === "tool_start" || e.type === "thought"));
  });

  it("TC-OH-014: openbot chat without worker uses OH_BASE_URL / OH_SESSION_API_KEY", async () => {
    const okMock = await startMockOhServer({ sessionKey: "chat-key" });
    try {
      const cli = path.join(repoRoot(), "src/cli.ts");
      const env = {
        ...process.env,
        OPENBOT_HOME: home,
        OH_BASE_URL: okMock.baseUrl,
        OH_SESSION_API_KEY: "chat-key",
        OPENHANDS_LLM_MODEL: "test/mock",
      };
      delete env.OPENAI_API_KEY;
      const run = await runCli(
        [cli, "chat", "summarize uname", "--handoff", "true", "--timeout", "5", "--poll-ms", "20"],
        env,
      );
      assert.equal(run.code, 0, run.out);
      assert.match(run.out, /done: summarize uname|summarize uname/);
    } finally {
      await okMock.stop();
    }
  });

  it("TC-OH-015: no local key chooses the handoff path", async () => {
    const client = new OpenHandsClient(mock.baseUrl, "err-key");
    const events: AgentEvent[] = [];
    const result = await runThreadTurn("plain task", {
      client,
      store: new HandoffStore(),
      llm: { baseUrl: "http://127.0.0.1:9", model: "none", apiKey: "" },
      emit: (e) => events.push(e),
      waitForConfirm: async () => true,
      timeoutMs: 2000,
      pollMs: 20,
    });
    assert.equal(result.path, "handoff");
    assert.ok(!events.some((e) => e.type === "handoff_proposal"));
    assert.ok(!events.some((e) => e.type === "status" && /no local model key/.test(e.text)));
  });

  it("TC-OH-018: openbot chat exits non-zero when remote conversation fails", async () => {
    assert.equal(remoteConversationFailed({ status: "failed", executionStatus: "error" }), true);
    assert.equal(remoteConversationFailed({ status: "succeeded", executionStatus: "finished" }), false);
    const cli = path.join(repoRoot(), "src/cli.ts");
    const env = {
      ...process.env,
      OPENBOT_HOME: home,
      OH_BASE_URL: mock.baseUrl,
      OH_SESSION_API_KEY: "err-key",
    };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_MODEL;
    delete env.OH_LLM_MODEL;
    delete env.OH_LLM_API_KEY;
    const run = await runCli(
      [cli, "chat", "this should fail", "--handoff", "true", "--timeout", "5", "--poll-ms", "20"],
      env,
    );
    assert.notEqual(run.code, 0, run.out);
    assert.match(run.out, /error|failed/i);
  });
});

describe("HandoffStore", () => {
  it("propose / take / deny", () => {
    const store = new HandoffStore();
    const p = store.propose({ goal: "uname -a" });
    assert.equal(store.get(p.id)?.goal, "uname -a");
    assert.equal(store.take(p.id)?.id, p.id);
    assert.equal(store.get(p.id), undefined);
    const q = store.propose({ goal: "ls" });
    assert.equal(store.deny(q.id)?.goal, "ls");
    assert.equal(store.get(q.id), undefined);
  });
});

async function readSse(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  assert.ok(res.body);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
    if (events.some((e) => e.type === "done")) break;
  }
  return events;
}

async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; out: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", ...argv], { env, cwd: repoRoot() });
  let out = "";
  child.stdout.on("data", (c) => {
    out += String(c);
  });
  child.stderr.on("data", (c) => {
    out += String(c);
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (n) => resolve(n ?? 1));
  });
  return { code, out };
}
