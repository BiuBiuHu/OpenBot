import { briefChatText, linkifyReply, looksLikeOpenHandsIntro, voiceChatReply } from "./chat-voice.js";
import { applyChatLanguage, DEFAULT_CHAT_LANGUAGE, normalizeChatLanguage } from "./language.js";
import { type HandoffTurnDeps } from "./handoff.js";
import { createOpenBotPiSession, type OpenBotPiOptions, type PiSession } from "./pi-kernel.js";
import { connectionFailureText, isConnectError, loadRemoteSkills } from "./remote-agent.js";
import { createSessionTools, type SessionToolBag } from "./session-tools.js";
import type { AgentEvent, ApprovalRequest, ChatMessage, LlmConfig } from "./types.js";
import type { WorkerClient } from "./worker-client.js";
import type { OhConversation } from "./oh-client.js";
import type { PublicDocument } from "./page-read.js";
import type { SearchHit } from "./web-search.js";

export interface ThreadTurnDeps extends HandoffTurnDeps {
  llm?: LlmConfig;
  worker?: WorkerClient;
  history?: ChatMessage[];
  waitForApproval?: (req: ApprovalRequest) => Promise<boolean>;
  /**
   * Ignored as a router. Every sentence goes to the Pi session that owns this thread.
   * Kept so older callers still type-check.
   */
  forceHandoff?: boolean;
  /** Injected Pi session. Production creates one with createAgentSession. */
  pi?: PiSession;
  modelStream?: OpenBotPiOptions["modelStream"];
  /**
   * Ignored. Web search is not a local Pi tool. Older tests inject this to
   * fail if a router calls it before Pi.
   */
  searchWeb?: (query: string) => Promise<SearchHit[]>;
  /** Ignored. Public pages are not read in this process. */
  browsePublicPage?: (query: string) => Promise<SearchHit[]>;
  /** Ignored. Public documents are not read in this process. */
  readPublicDocument?: (url: string) => Promise<PublicDocument | undefined>;
  /** Saved chat language. Default zh-CN. */
  language?: string;
}

export interface ThreadTurnResult {
  path: "pi" | "handoff" | "local" | "worker" | "lookup" | "clock" | "coding" | "document";
  conversation?: OhConversation;
  history: ChatMessage[];
  /** Long remote body kept off the transcript. */
  kept?: string;
}

/**
 * One local chat thread, owned by the Pi session.
 * The user's sentence is prompted as-is. Clock is the local tool. Public
 * documents and web search are remote card skills when the agent card lists
 * them. The remote computer is a separate agent.
 */
export async function runThreadTurn(message: string, deps: ThreadTurnDeps): Promise<ThreadTurnResult> {
  const goal = message.trim();
  if (!goal) throw new Error("message required");
  const language = normalizeChatLanguage(deps.language ?? DEFAULT_CHAT_LANGUAGE);
  deps.emit({ type: "status", text: "thinking" });

  const owned = !deps.pi;
  const bag: SessionToolBag = {};
  const session =
    deps.pi ??
    (await createOpenBotPiSession({
      llm: deps.llm,
      language,
        remoteSkills: await loadRemoteSkills(deps.client.baseUrl),
      tools: createSessionTools({
        client: () => deps.client,
        oh: () => deps.oh,
        language: () => language,
        pollMs: deps.pollMs,
        threadId: deps.threadId,
        conversationId: () => deps.conversationId,
        bag,
      }),
      modelStream: deps.modelStream,
      conversation: () => bag.conversation,
      kept: () => bag.remote?.fullText,
    }));

  try {
    const turn = await session.prompt(goal);
    const text = presentPiText(goal, turn.text, language, turn.kept ?? bag.remote?.fullText);
    deps.emit({ type: "token", text });
    if (bag.remote?.failed) deps.emit({ type: "error", message: text });
    deps.emit({ type: "done" });
    return {
      path: "pi",
      conversation: turn.conversation ?? bag.conversation,
      history: appendHistory(deps.history, goal, text),
      kept: turn.kept ?? bag.remote?.fullText,
    };
  } catch (err) {
    const text = isConnectError(err) ? connectionFailureText(language) : localFailureText(language);
    deps.emit({ type: "token", text });
    deps.emit({ type: "error", message: text });
    deps.emit({ type: "done" });
    return { path: "pi", history: deps.history ?? [] };
  } finally {
    if (owned) session.dispose();
  }
}

function presentPiText(userMessage: string, text: string, language: string, kept?: string): string {
  const raw = String(text || "").trim();
  const lang = normalizeChatLanguage(language);
  if (!raw) return lang === "en" ? "No reply." : "这轮没有答上来。";
  if (raw === connectionFailureText(lang)) return raw;
  const voiced = looksLikeOpenHandsIntro(raw)
    ? voiceChatReply({
        userMessage,
        remoteText: raw,
        outcome: "succeeded",
        language: lang,
      }).text
    : applyChatLanguage(linkifyReply(raw), lang);
  return briefChatText(voiced, kept);
}

function localFailureText(language: string): string {
  return normalizeChatLanguage(language) === "en" ? "The local agent did not answer." : "本地代理这轮没答上来。";
}

function appendHistory(history: ChatMessage[] | undefined, user: string, assistant: string): ChatMessage[] {
  const next: ChatMessage[] = [
    ...(history ?? []),
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ];
  return next.slice(-40);
}

export function printThreadEvent(event: AgentEvent, io = { out: process.stdout, err: process.stderr }): void {
  switch (event.type) {
    case "token":
      io.out.write(event.text);
      break;
    case "thought":
      io.out.write(`${event.text}\n`);
      break;
    case "status":
      io.err.write(`· ${event.text}\n`);
      break;
    case "tool_start":
      io.err.write(`▸ ${event.name} ${JSON.stringify(event.args)}\n`);
      break;
    case "tool_result":
      io.out.write(`${event.result}\n`);
      break;
    case "output":
      io.out.write(event.chunk);
      break;
    case "error":
      io.err.write(`error: ${event.message}\n`);
      break;
    case "handoff_proposal":
      io.err.write(`handoff ${event.id}: ${event.goal}\n`);
      break;
    case "approval":
      io.err.write(`approval: ${event.reason}\n  ${event.command}\n`);
      break;
    default:
      break;
  }
}
