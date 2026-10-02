import { ClientFactory, JsonRpcTransportFactory, RestTransportFactory, type Client } from "@a2a-js/sdk/client";
import { Role, TaskState, type Message, type Task } from "@a2a-js/sdk";
import { randomUUID } from "node:crypto";
import { outcomeFromRemote, REMOTE_TIMER_LINE, voiceChatReply } from "./chat-voice.js";
import { normalizeChatLanguage } from "./language.js";
import { agentReplyText } from "./oh-events.js";
import {
  OpenHandsClient,
  OpenHandsError,
  isTerminalStatus,
  type OhConversation,
} from "./oh-client.js";
import type { OpenHandsConfig } from "./types.js";

export { REMOTE_TIMER_LINE } from "./chat-voice.js";

export function connectionFailureText(language?: string): string {
  return normalizeChatLanguage(language) === "en" ? "Can't reach this computer." : "连不上这台电脑。";
}

export function remoteFailedText(language?: string): string {
  return normalizeChatLanguage(language) === "en"
    ? "The computer did not finish that."
    : "这台电脑这轮没做成。你换一句再试。";
}

export interface RemoteTaskResult {
  text: string;
  conversation?: OhConversation;
  connected: boolean;
  failed: boolean;
  /** Which transport actually ran the task. `none` means no A2A task was sent. */
  transport: "a2a" | "openhands" | "none";
  /** Long remote body. The chat keeps it and does not paste it. */
  fullText?: string;
  /** True only after an A2A message:send was issued. */
  dispatched?: boolean;
}

export interface RemoteSkill {
  id: string;
  name: string;
  description: string;
}

const SKILL_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Skills from a real agent card. A miss is an empty list, not a made-up A2A call. */
export async function loadRemoteSkills(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<RemoteSkill[]> {
  try {
    const url = new URL("/.well-known/agent-card.json", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      name?: unknown;
      supportedInterfaces?: unknown;
      skills?: unknown;
    };
    if (!body || typeof body.name !== "string" || !Array.isArray(body.supportedInterfaces) || !Array.isArray(body.skills)) {
      return [];
    }
    const skills: RemoteSkill[] = [];
    for (const skill of body.skills) {
      if (!skill || typeof skill !== "object") continue;
      const row = skill as { id?: unknown; name?: unknown; description?: unknown };
      if (typeof row.id !== "string" || !SKILL_ID.test(row.id)) continue;
      skills.push({
        id: row.id,
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id,
        description: typeof row.description === "string" && row.description.trim() ? row.description.trim() : row.id,
      });
    }
    return skills;
  } catch {
    return [];
  }
}

const STOPPED_TASK = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
  TaskState.TASK_STATE_INPUT_REQUIRED,
  TaskState.TASK_STATE_AUTH_REQUIRED,
]);

export function isConnectError(err: unknown): boolean {
  if (err instanceof OpenHandsError) {
    if (err.status === undefined) return true;
    return /unreachable|ECONNREFUSED|fetch failed|ENOTFOUND|network/i.test(err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|network|unreachable|aborted/i.test(message);
}

/**
 * Agent card discovery only. A miss means this peer still speaks the existing
 * OpenHands conversation API. This is not the task deadline.
 */
export async function remoteSpeaksA2a(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const url = new URL("/.well-known/agent-card.json", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { supportedInterfaces?: unknown; name?: unknown };
    return Boolean(body && typeof body.name === "string" && Array.isArray(body.supportedInterfaces));
  } catch {
    return false;
  }
}

export async function waitForTerminalConversation(
  read: () => Promise<OhConversation>,
  opts: { pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<OhConversation> {
  const pollMs = opts.pollMs ?? 250;
  const pause = opts.sleep ?? sleep;
  let last = await read();
  while (!isTerminalStatus(last.executionStatus)) {
    await pause(pollMs);
    last = await read();
  }
  return last;
}

export interface RemoteTaskDeps {
  client: OpenHandsClient;
  oh?: OpenHandsConfig;
  language?: string;
  pollMs?: number;
  threadId?: string;
  conversationId?: string;
}

export async function runRemoteTask(goal: string, deps: RemoteTaskDeps): Promise<RemoteTaskResult> {
  if (await remoteSpeaksA2a(deps.client.baseUrl)) {
    try {
      return await runA2aTask(goal, deps);
    } catch (err) {
      if (isConnectError(err)) {
        return { text: connectionFailureText(deps.language), connected: false, failed: true, transport: "a2a" };
      }
      // The card did not line up with a usable A2A task. Keep the existing channel.
    }
  }
  try {
    return await runOpenHandsTask(goal, deps);
  } catch (err) {
    const text = isConnectError(err) ? connectionFailureText(deps.language) : remoteFailedText(deps.language);
    return { text, connected: false, failed: true, transport: "openhands" };
  }
}

async function runOpenHandsTask(goal: string, deps: RemoteTaskDeps): Promise<RemoteTaskResult> {
  let last: OhConversation | undefined;
  let id = (deps.conversationId || "").trim();
  if (id) {
    try {
      last = await deps.client.getConversation(id);
      await deps.client.sendMessage(id, goal);
    } catch (err) {
      if (isConnectError(err)) throw err;
      id = "";
      last = undefined;
    }
  }
  if (!id) {
    last = await deps.client.createConversation(
      {
        goal,
        threadId: deps.threadId,
        workspaceDir: deps.oh?.workspaceDir,
        model: deps.oh?.llmModel || undefined,
        apiKey: deps.oh?.llmApiKey || undefined,
        baseUrl: deps.oh?.llmBaseUrl || undefined,
      },
      deps.oh,
    );
    id = last.id;
  }
  if (!id || !last) {
    return {
      text: remoteFailedText(deps.language),
      connected: false,
      failed: true,
      transport: "openhands",
      conversation: last,
    };
  }

  last = await waitForTerminalConversation(() => deps.client.getConversation(id), { pollMs: deps.pollMs });
  let items: unknown[] = [];
  try {
    items = (await deps.client.searchEvents(id, { limit: 80 })).items;
  } catch (err) {
    if (isConnectError(err)) throw err;
  }
  const raw = agentReplyText(items);
  const outcome = outcomeFromRemote(last.status, false);
  const voiced = voiceChatReply({
    userMessage: goal,
    remoteText: raw,
    outcome: outcome === "timeout" || outcome === "running" ? "failed" : outcome,
    language: deps.language,
  });
  if (voiced.text.includes(REMOTE_TIMER_LINE)) {
    return {
      text: remoteFailedText(deps.language),
      conversation: last,
      connected: true,
      failed: true,
      transport: "openhands",
    };
  }
  return {
    text: voiced.text,
    conversation: last,
    connected: true,
    failed: voiced.kind === "fail",
    transport: "openhands",
  };
}

/** Send one card skill as an A2A task. Does not fall back to another channel. */
export async function sendA2aSkill(skillId: string, goal: string, deps: RemoteTaskDeps): Promise<RemoteTaskResult> {
  try {
    return await runA2aTask(goal, deps, skillId);
  } catch (err) {
    const connected = !isConnectError(err);
    return {
      text: connected ? remoteFailedText(deps.language) : connectionFailureText(deps.language),
      connected,
      failed: true,
      transport: "none",
      dispatched: false,
    };
  }
}

async function runA2aTask(goal: string, deps: RemoteTaskDeps, skillId?: string): Promise<RemoteTaskResult> {
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory(), new RestTransportFactory()],
  });
  const client = await factory.createFromUrl(deps.client.baseUrl);
  const options = deps.client.sessionApiKey
    ? { serviceParameters: { "X-Session-API-Key": deps.client.sessionApiKey } }
    : undefined;
  const sent = await client.sendMessage(a2aMessage(goal, skillId), options);
  const task = await settleA2a(client, sent, deps.pollMs ?? 250, options);
  const fullText = (task ? textFromTask(task) : textFromMessage(sent as Message)).trim();
  const failed = task ? !completed(task) : !fullText;
  return {
    text: fullText || remoteFailedText(deps.language),
    fullText,
    connected: true,
    failed,
    transport: "a2a",
    dispatched: true,
  };
}

function a2aMessage(goal: string, skillId?: string) {
  const message: Message = {
    messageId: randomUUID(),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: "text", value: goal },
        metadata: undefined,
        filename: "",
        mediaType: "text/plain",
      },
    ],
    metadata: skillId ? { skillId } : undefined,
    extensions: [],
    referenceTaskIds: [],
  };
  return {
    tenant: "",
    message,
    configuration: {
      acceptedOutputModes: ["text/plain"],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    metadata: undefined,
  };
}

async function settleA2a(
  client: Client,
  sent: Message | Task,
  pollMs: number,
  options: { serviceParameters: Record<string, string> } | undefined,
): Promise<Task | undefined> {
  if (!isTask(sent)) return undefined;
  let task = sent;
  while (!STOPPED_TASK.has(task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED)) {
    await sleep(pollMs);
    task = await client.getTask({ tenant: "", id: task.id }, options);
  }
  return task;
}

function isTask(value: Message | Task): value is Task {
  return Boolean(value && typeof value === "object" && "status" in value && "id" in value && !("messageId" in value));
}

function completed(task: Task): boolean {
  return task.status?.state === TaskState.TASK_STATE_COMPLETED;
}

function textFromMessage(message: Message | undefined): string {
  return partsText(message?.parts);
}

function textFromTask(task: Task): string {
  const artifacts = (task.artifacts || []).map((artifact) => partsText(artifact.parts)).filter(Boolean);
  if (artifacts.length) return artifacts.join("\n");
  const statusText = textFromMessage(task.status?.message);
  if (statusText) return statusText;
  const history = [...(task.history || [])].reverse().find((message) => message.role === Role.ROLE_AGENT);
  return textFromMessage(history);
}

function partsText(parts: Message["parts"] | undefined): string {
  if (!parts?.length) return "";
  const bits: string[] = [];
  for (const part of parts) {
    const content = part.content;
    if (content?.$case === "text" && typeof content.value === "string") bits.push(content.value);
  }
  return bits.join("\n").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
