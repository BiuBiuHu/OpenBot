import { textsFromEvent } from "./oh-events.js";
import type { OpenBotConfig, OpenHandsConfig } from "./types.js";

export class OpenHandsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenHandsError";
  }
}

/** OH ConversationExecutionStatus plus a few aliases we accept. */
export type OhExecutionStatus =
  | "idle"
  | "running"
  | "paused"
  | "waiting_for_confirmation"
  | "finished"
  | "error"
  | "stuck"
  | "deleting"
  | string;

/** Product task status from remote-agent.md, mapped from OH execution_status. */
export type ProductTaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout"
  | "unknown";

export interface OhConversation {
  id: string;
  executionStatus: OhExecutionStatus;
  status: ProductTaskStatus;
  raw: Record<string, unknown>;
}

export interface OhConversationPage {
  items: OhConversation[];
  nextPageId?: string;
  raw: unknown;
}

export interface OhEventPage {
  items: Record<string, unknown>[];
  nextPageId?: string;
  raw: unknown;
}

export interface CreateConversationInput {
  goal: string;
  conversationId?: string;
  workspaceDir?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxIterations?: number;
  run?: boolean;
  threadId?: string;
}

export interface PollOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Also stop when waiting_for_confirmation (default true). */
  stopOnApproval?: boolean;
}

const DEFAULT_TOOLS = [{ name: "terminal" }, { name: "file_editor" }, { name: "task_tracker" }];

export function mapExecutionStatus(status: string | undefined): ProductTaskStatus {
  switch ((status || "").toLowerCase()) {
    case "idle":
    case "queued":
      return "queued";
    case "running":
    case "paused":
      return "running";
    case "waiting_for_confirmation":
    case "awaiting_approval":
      return "awaiting_approval";
    case "finished":
    case "succeeded":
    case "success":
      return "succeeded";
    case "error":
    case "failed":
    case "stuck":
      return "failed";
    case "deleting":
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "timeout":
      return "timeout";
    default:
      return status ? "unknown" : "queued";
  }
}

export function isTerminalStatus(status: string | undefined, stopOnApproval = true): boolean {
  const mapped = mapExecutionStatus(status);
  if (stopOnApproval && mapped === "awaiting_approval") return true;
  return mapped === "succeeded" || mapped === "failed" || mapped === "cancelled" || mapped === "timeout";
}

/**
 * Agent Server 1.49.2 requires `agent.llm`. LLM.model only defaults
 * (gpt-5.6) when the llm object is present — omitting llm is a 422.
 * The server does not merge host LLM_API_KEY into the request; litellm
 * reads provider env from the model prefix. Default model is the host
 * DeepSeek id so an empty local OPENAI_API_KEY is never sent.
 */
export const DEFAULT_REMOTE_LLM_MODEL = "deepseek/deepseek-chat";

function isOpenAiShapedModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("openai/") || m === "openhands/default";
}

/** @deprecated use buildAgentLlm — kept so older tests can see the gate. */
export function remoteLlmOverride(
  input?: { model?: string; apiKey?: string },
  cfg?: OpenHandsConfig,
): { model: string; apiKey: string } | undefined {
  const llm = buildAgentLlm(input, cfg);
  if (!llm.api_key) return undefined;
  return { model: llm.model, apiKey: llm.api_key };
}

export function buildAgentLlm(
  input?: { model?: string; apiKey?: string; baseUrl?: string },
  cfg?: OpenHandsConfig,
): { model: string; api_key?: string; base_url?: string } {
  const requested = (input?.model || cfg?.llmModel || "").trim();
  const apiKey = (input?.apiKey || cfg?.llmApiKey || "").trim();
  const baseUrl = (input?.baseUrl || cfg?.llmBaseUrl || "").trim();
  const model =
    requested && !(isOpenAiShapedModel(requested) && !apiKey)
      ? requested
      : DEFAULT_REMOTE_LLM_MODEL;
  const llm: { model: string; api_key?: string; base_url?: string } = { model };
  if (apiKey) llm.api_key = apiKey;
  if (baseUrl) llm.base_url = baseUrl;
  return llm;
}

export function remoteConversationFailed(conv?: { status?: string; executionStatus?: string }): boolean {
  if (!conv) return false;
  const mapped = mapExecutionStatus(conv.executionStatus || conv.status);
  return mapped === "failed" || mapped === "timeout" || mapped === "cancelled";
}

export function normalizeConversation(raw: unknown): OhConversation {
  const rec = isRecord(raw) ? raw : {};
  const id = String(rec.id || rec.conversation_id || rec.conversationId || "");
  const executionStatus = String(
    rec.execution_status || rec.executionStatus || rec.status || "idle",
  );
  return {
    id,
    executionStatus,
    status: mapExecutionStatus(executionStatus),
    raw: rec,
  };
}

export function conversationSnippet(page: unknown, maxChars = 800): string {
  const items = extractItems(page);
  const texts: string[] = [];
  for (const item of items) {
    texts.push(...textsFromEvent(item));
  }
  return texts
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n")
    .slice(0, maxChars);
}

export class OpenHandsClient {
  constructor(
    readonly baseUrl: string,
    readonly sessionApiKey: string,
  ) {}

  static fromConfig(config: OpenBotConfig | OpenHandsConfig): OpenHandsClient {
    const oh = "openhands" in config ? config.openhands : config;
    return new OpenHandsClient(oh.baseUrl.replace(/\/$/, ""), oh.sessionApiKey);
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.sessionApiKey) headers["X-Session-API-Key"] = this.sessionApiKey;
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new OpenHandsError(
        `OpenHands unreachable at ${this.baseUrl} (${why}). Is \`ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host\` up?`,
      );
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        if (!res.ok) {
          throw new OpenHandsError(
            `OpenHands returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
            res.status,
          );
        }
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const rec = isRecord(data) ? data : {};
      const detail =
        (typeof rec.detail === "string" && rec.detail) ||
        (typeof rec.error === "string" && rec.error) ||
        (typeof rec.message === "string" && rec.message) ||
        `OpenHands HTTP ${res.status}`;
      throw new OpenHandsError(detail, res.status);
    }
    return data as T;
  }

  async health(): Promise<{ ok: boolean; raw: unknown }> {
    try {
      const raw = await this.request<unknown>("GET", "/health");
      const rec = isRecord(raw) ? raw : {};
      const ok = rec.status === "ok" || rec.ok === true || rec.status === "healthy";
      return { ok, raw };
    } catch (err) {
      if (err instanceof OpenHandsError && err.status && err.status < 500) {
        return { ok: false, raw: { error: err.message, status: err.status } };
      }
      return { ok: false, raw: { error: err instanceof Error ? err.message : String(err) } };
    }
  }

  async createConversation(input: CreateConversationInput, cfg?: OpenHandsConfig): Promise<OhConversation> {
    const workspaceDir = input.workspaceDir || cfg?.workspaceDir || "workspace/project";
    const run = input.run !== false;
    const payload: Record<string, unknown> = {
      agent: {
        kind: "Agent",
        llm: buildAgentLlm(input, cfg),
        tools: DEFAULT_TOOLS,
      },
      workspace: {
        kind: "LocalWorkspace",
        working_dir: workspaceDir,
      },
      initial_message: {
        role: "user",
        content: [{ type: "text", text: input.goal }],
        run,
      },
      max_iterations: input.maxIterations ?? 20,
      confirmation_policy: { kind: "NeverConfirm" },
    };
    if (input.conversationId) payload.conversation_id = input.conversationId;
    const raw = await this.request<unknown>("POST", "/api/conversations", payload);
    return normalizeConversation(raw);
  }

  async getConversation(id: string): Promise<OhConversation> {
    const raw = await this.request<unknown>("GET", `/api/conversations/${encodeURIComponent(id)}`);
    return normalizeConversation(raw);
  }

  async listConversations(opts: { limit?: number; status?: string } = {}): Promise<OhConversationPage> {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.status) qs.set("status", opts.status);
    const query = qs.toString() ? `?${qs}` : "";
    let raw: unknown;
    try {
      raw = await this.request<unknown>("GET", `/api/conversations/search${query}`);
    } catch (err) {
      if (err instanceof OpenHandsError && err.status === 404) {
        raw = await this.request<unknown>("GET", `/api/conversations${query}`);
      } else {
        throw err;
      }
    }
    return normalizeConversationPage(raw);
  }

  async sendMessage(id: string, text: string, run = true): Promise<{ success: boolean; raw: unknown }> {
    const raw = await this.request<unknown>("POST", `/api/conversations/${encodeURIComponent(id)}/events`, {
      role: "user",
      content: [{ type: "text", text }],
      run,
    });
    const rec = isRecord(raw) ? raw : {};
    return { success: rec.success !== false, raw };
  }

  async runConversation(id: string): Promise<{ success: boolean; raw: unknown }> {
    const raw = await this.request<unknown>(
      "POST",
      `/api/conversations/${encodeURIComponent(id)}/run`,
      {},
    );
    const rec = isRecord(raw) ? raw : {};
    return { success: rec.success !== false, raw };
  }

  async searchEvents(
    id: string,
    opts: { limit?: number; kind?: string } = {},
  ): Promise<OhEventPage> {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.kind) qs.set("kind", opts.kind);
    const query = qs.toString() ? `?${qs}` : "";
    let raw: unknown;
    try {
      raw = await this.request<unknown>(
        "GET",
        `/api/conversations/${encodeURIComponent(id)}/events/search${query}`,
      );
    } catch (err) {
      if (err instanceof OpenHandsError && err.status === 404) {
        raw = await this.request<unknown>(
          "GET",
          `/api/conversations/${encodeURIComponent(id)}/events${query}`,
        );
      } else {
        throw err;
      }
    }
    return normalizeEventPage(raw);
  }

  async pollConversation(id: string, opts: PollOptions = {}): Promise<OhConversation> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollMs = opts.pollMs ?? 400;
    const stopOnApproval = opts.stopOnApproval !== false;
    const deadline = Date.now() + timeoutMs;
    let last = await this.getConversation(id);
    while (!isTerminalStatus(last.executionStatus, stopOnApproval)) {
      if (Date.now() >= deadline) return last;
      await sleep(pollMs);
      last = await this.getConversation(id);
    }
    return last;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractItems(page: unknown): unknown[] {
  if (Array.isArray(page)) return page;
  if (!isRecord(page)) return [];
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.conversations)) return page.conversations;
  if (Array.isArray(page.events)) return page.events;
  if (Array.isArray(page.results)) return page.results;
  return [];
}

function normalizeConversationPage(raw: unknown): OhConversationPage {
  const rec = isRecord(raw) ? raw : {};
  const items = extractItems(raw).map(normalizeConversation);
  const nextPageId =
    (typeof rec.next_page_id === "string" && rec.next_page_id) ||
    (typeof rec.nextPageId === "string" && rec.nextPageId) ||
    undefined;
  return { items, nextPageId, raw };
}

function normalizeEventPage(raw: unknown): OhEventPage {
  const rec = isRecord(raw) ? raw : {};
  const items = extractItems(raw).filter(isRecord);
  const nextPageId =
    (typeof rec.next_page_id === "string" && rec.next_page_id) ||
    (typeof rec.nextPageId === "string" && rec.nextPageId) ||
    undefined;
  return { items, nextPageId, raw };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
