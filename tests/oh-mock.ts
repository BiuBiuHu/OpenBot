import http from "node:http";
import { freePort } from "./helpers.js";

export interface MockConversation {
  id: string;
  execution_status: string;
  goal: string;
  polls: number;
  llm?: { model?: string; api_key?: string };
}

export interface MockOhServer {
  port: number;
  baseUrl: string;
  sessionKey: string;
  conversations: Map<string, MockConversation>;
  requests: Array<{ method: string; url: string; key?: string }>;
  creates: Array<{ id: string; body: Record<string, unknown>; llm?: { model?: string; api_key?: string } }>;
  stop: () => Promise<void>;
}

export async function startMockOhServer(
  opts: { sessionKey?: string; finishAfterPolls?: number; terminalStatus?: string } = {},
): Promise<MockOhServer> {
  const sessionKey = opts.sessionKey ?? "test-oh-session";
  const finishAfterPolls = opts.finishAfterPolls ?? 2;
  const terminalStatus = opts.terminalStatus ?? "finished";
  const conversations = new Map<string, MockConversation>();
  const requests: MockOhServer["requests"] = [];
  const creates: MockOhServer["creates"] = [];
  let seq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const key = String(req.headers["x-session-api-key"] || "");
    requests.push({ method: req.method || "GET", url: url.pathname, key });

    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/health") {
      send(200, { status: "ok" });
      return;
    }

    if (url.pathname.startsWith("/api/") && key !== sessionKey) {
      send(401, { detail: "invalid session api key" });
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }

      if (req.method === "POST" && url.pathname === "/api/conversations") {
        seq += 1;
        const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
        const initial = body.initial_message as { content?: Array<{ text?: string }> } | undefined;
        const goal = initial?.content?.[0]?.text || "";
        const agent = body.agent && typeof body.agent === "object" ? (body.agent as Record<string, unknown>) : {};
        const llmRaw = agent.llm && typeof agent.llm === "object" ? (agent.llm as Record<string, unknown>) : undefined;
        const llm = llmRaw
          ? {
              model: typeof llmRaw.model === "string" ? llmRaw.model : undefined,
              api_key: typeof llmRaw.api_key === "string" ? llmRaw.api_key : undefined,
            }
          : undefined;
        const conv: MockConversation = { id, execution_status: "running", goal, polls: 0, llm };
        conversations.set(id, conv);
        creates.push({ id, body, llm });
        send(200, { id, execution_status: conv.execution_status, workspace: body.workspace });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/conversations/search") {
        send(200, {
          items: [...conversations.values()].map((c) => ({
            id: c.id,
            execution_status: c.execution_status,
          })),
        });
        return;
      }

      const convMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (req.method === "GET" && convMatch) {
        const conv = conversations.get(convMatch[1]);
        if (!conv) {
          send(404, { detail: "not found" });
          return;
        }
        conv.polls += 1;
        if (conv.polls >= finishAfterPolls) conv.execution_status = terminalStatus;
        send(200, { id: conv.id, execution_status: conv.execution_status });
        return;
      }

      const eventsSearch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/events\/search$/);
      if (req.method === "GET" && eventsSearch) {
        const conv = conversations.get(eventsSearch[1]);
        if (!conv) {
          send(404, { detail: "not found" });
          return;
        }
        const items: Record<string, unknown>[] = [
          {
            id: `${conv.id}-user`,
            kind: "MessageEvent",
            source: "user",
            content: [{ type: "text", text: conv.goal }],
          },
        ];
        if (conv.polls >= 1) {
          items.push({
            id: `${conv.id}-action`,
            kind: "ActionEvent",
            source: "agent",
            action: { kind: "CmdRunAction", command: "uname -a" },
          });
        }
        if (conv.polls >= 1) {
          items.push({
            id: `${conv.id}-obs`,
            kind: "ObservationEvent",
            source: "agent",
            observation: { kind: "CmdOutputObservation", content: "Linux mock 6.12" },
          });
        }
        if (conv.polls >= finishAfterPolls || conv.execution_status === terminalStatus) {
          items.push({
            id: `${conv.id}-agent`,
            kind: "MessageEvent",
            source: "agent",
            content: [{ type: "text", text: `done: ${conv.goal}` }],
          });
        }
        if (terminalStatus === "error" && conv.polls >= finishAfterPolls) {
          items.push({
            id: `${conv.id}-err`,
            kind: "AgentErrorEvent",
            source: "agent",
            error: "mock remote failed",
          });
        }
        send(200, { items });
        return;
      }

      const sendMsg = url.pathname.match(/^\/api\/conversations\/([^/]+)\/events$/);
      if (req.method === "POST" && sendMsg) {
        send(200, { success: true });
        return;
      }

      const run = url.pathname.match(/^\/api\/conversations\/([^/]+)\/run$/);
      if (req.method === "POST" && run) {
        send(200, { success: true });
        return;
      }

      send(404, { detail: "not found" });
    });
  });

  const port = await freePort();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    sessionKey,
    conversations,
    requests,
    creates,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
