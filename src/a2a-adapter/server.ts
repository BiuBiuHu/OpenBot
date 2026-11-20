import {
  AgentCard,
  Role,
  SendMessageRequest,
  SendMessageResponse,
  TaskState,
  type Message,
  type Task,
} from "@a2a-js/sdk";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { adapterCard } from "./card.js";
import { agentReplyText } from "../oh-events.js";
import { OpenHandsClient, type OhConversation } from "../oh-client.js";
import { connectionFailureText, isConnectError, waitForTerminalConversation } from "../remote-agent.js";
import type { OpenHandsConfig } from "../types.js";

export interface AdapterTask {
  skillId: string;
  goal: string;
}

export interface OpenHandsAdapter {
  baseUrl: string;
  tasks: AdapterTask[];
  stop: () => Promise<void>;
}

/**
 * A2A face for the OpenHands we deploy. It does not edit files or run commands
 * itself. It publishes the agent card, forwards each task to the existing
 * conversation API, and waits for a terminal state.
 */
export async function startOpenHandsAdapter(opts: {
  client: OpenHandsClient;
  oh?: OpenHandsConfig;
  pollMs?: number;
}): Promise<OpenHandsAdapter> {
  const tasks: AdapterTask[] = [];
  const done = new Map<string, Task>();
  let baseUrl = "http://127.0.0.1:0";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", baseUrl);
    try {
      if (req.method === "GET" && (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent-card.json/")) {
        json(res, 200, AgentCard.toJSON(adapterCard(baseUrl)));
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/tasks/")) {
        const id = decodeURIComponent(url.pathname.slice("/tasks/".length).split("/")[0] || "");
        const task = done.get(id);
        if (!task) {
          json(res, 404, { error: "not found" });
          return;
        }
        json(res, 200, task);
        return;
      }
      if (req.method === "POST" && url.pathname === "/message:send") {
        const raw = JSON.parse(await readBody(req)) as unknown;
        const request = SendMessageRequest.fromJSON(raw);
        const goal = messageText(request.message);
        const skillId = skillOf(request.message);
        tasks.push({ skillId, goal });
        const task = await runForward(opts, goal);
        done.set(task.id, task);
        json(res, 200, SendMessageResponse.toJSON({ payload: { $case: "task", value: task } }));
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      const text = isConnectError(err) ? connectionFailureText() : "这台电脑这轮没做成。你换一句再试。";
      const task = finishedTask(text, false);
      done.set(task.id, task);
      json(res, 200, SendMessageResponse.toJSON({ payload: { $case: "task", value: task } }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    tasks,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function runForward(
  opts: { client: OpenHandsClient; oh?: OpenHandsConfig; pollMs?: number },
  goal: string,
): Promise<Task> {
  const created = await opts.client.createConversation(
    {
      goal,
      workspaceDir: opts.oh?.workspaceDir,
      model: opts.oh?.llmModel || undefined,
      apiKey: opts.oh?.llmApiKey || undefined,
      baseUrl: opts.oh?.llmBaseUrl || undefined,
    },
    opts.oh,
  );
  const last: OhConversation = await waitForTerminalConversation(() => opts.client.getConversation(created.id), {
    pollMs: opts.pollMs ?? 250,
  });
  let full = "";
  try {
    const page = await opts.client.searchEvents(created.id, { limit: 80 });
    full = agentReplyText(page.items);
  } catch (err) {
    if (isConnectError(err)) throw err;
  }
  const ok = last.status === "succeeded";
  return finishedTask(full || goal, ok);
}

function finishedTask(text: string, ok: boolean): Task {
  const id = randomUUID();
  const contextId = randomUUID();
  const part = {
    content: { $case: "text" as const, value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
  return {
    id,
    contextId,
    status: {
      state: ok ? TaskState.TASK_STATE_COMPLETED : TaskState.TASK_STATE_FAILED,
      message: {
        messageId: randomUUID(),
        contextId,
        taskId: id,
        role: Role.ROLE_AGENT,
        parts: [part],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
      timestamp: new Date().toISOString(),
    },
    artifacts: [
      {
        artifactId: randomUUID(),
        name: "result",
        description: "",
        parts: [part],
        metadata: undefined,
        extensions: [],
      },
    ],
    history: [],
    metadata: undefined,
  };
}

function messageText(message: Message | undefined): string {
  const bits: string[] = [];
  for (const part of message?.parts || []) {
    if (part.content?.$case === "text" && part.content.value.trim()) bits.push(part.content.value.trim());
  }
  return bits.join("\n");
}

function skillOf(message: Message | undefined): string {
  const meta = message?.metadata;
  const skillId = meta && typeof meta.skillId === "string" ? meta.skillId : "";
  return skillId;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
