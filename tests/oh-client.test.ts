import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import { deliverConfirmedHandoff, HandoffStore } from "../src/handoff.js";
import {
  conversationSnippet,
  mapExecutionStatus,
  OpenHandsClient,
  OpenHandsError,
} from "../src/oh-client.js";
import { repoRoot } from "../src/paths.js";
import { startControlPlane } from "../src/server.js";
import { freePort, startWorker } from "./helpers.js";
import { startMockOhServer } from "./oh-mock.js";

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
      OPENHANDS_BASE_URL: mock.baseUrl,
      OPENHANDS_API_KEY: "cli-key",
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
    assert.match(html, /handoffs\/stream/);
    const status = (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()) as {
      ok?: boolean;
      openhands?: { ok?: boolean };
    };
    assert.equal(status.openhands?.ok, true);
    assert.equal(status.ok, true);
  });

  it("TC-OH-009: stream proposes handoff; confirm creates conversation and returns snippet", async () => {
    const port = plane.config.controlPlane.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/handoffs/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "list workspace", timeout_ms: 3000, poll_ms: 20 }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.body);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events: Array<Record<string, unknown>> = [];
    let buf = "";
    let confirmed = false;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
        events.push(ev);
        if (ev.type === "handoff_proposal" && !confirmed) {
          confirmed = true;
          const allow = await fetch(`http://127.0.0.1:${port}/api/handoffs/${ev.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allow: true }),
          });
          assert.equal(allow.status, 200);
        }
      }
      if (events.some((e) => e.type === "done")) break;
    }
    assert.ok(events.some((e) => e.type === "handoff_proposal"));
    assert.ok(events.some((e) => e.type === "thought"));
    assert.ok(events.some((e) => e.type === "done"));
    const thought = events.find((e) => e.type === "thought");
    assert.match(String(thought?.text || ""), /list workspace/);
    const listed = (await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json()) as {
      conversations: Array<{ id: string }>;
    };
    assert.ok(listed.conversations.length >= 1);
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
