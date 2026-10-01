import { outcomeFromRemote, voiceChatReply } from "./chat-voice.js";
import { agentReplyText } from "./oh-events.js";
import {
  OpenHandsClient,
  isTerminalStatus,
  type CreateConversationInput,
  type OhConversation,
} from "./oh-client.js";
import type { AgentEvent, HandoffProposal, OpenHandsConfig } from "./types.js";

export interface HandoffDelivery {
  proposal: HandoffProposal;
  conversation: OhConversation;
}

/** In-memory pending handoffs — same pattern as control-plane approvals. */
export class HandoffStore {
  private readonly pending = new Map<string, HandoffProposal>();

  propose(input: { goal: string; reason?: string; threadId?: string; id?: string }): HandoffProposal {
    const goal = input.goal.trim();
    if (!goal) throw new Error("handoff goal required");
    const proposal: HandoffProposal = {
      id: input.id || `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      goal,
      reason: (input.reason || "needs the host computer").trim(),
      threadId: input.threadId || "chat_default",
      createdAt: Date.now(),
    };
    this.pending.set(proposal.id, proposal);
    return proposal;
  }

  get(id: string): HandoffProposal | undefined {
    return this.pending.get(id);
  }

  take(id: string): HandoffProposal | undefined {
    const found = this.pending.get(id);
    if (found) this.pending.delete(id);
    return found;
  }

  deny(id: string): HandoffProposal | undefined {
    return this.take(id);
  }
}

/**
 * Confirmed handoff → create an OpenHands conversation with the goal as
 * the user message. Does not invent a third chat mode.
 */
export async function deliverConfirmedHandoff(
  client: OpenHandsClient,
  proposal: { goal: string; reason?: string; threadId?: string; id?: string },
  oh?: OpenHandsConfig,
): Promise<HandoffDelivery> {
  const normalized: HandoffProposal = {
    id: proposal.id || `ho_${Date.now().toString(36)}`,
    goal: proposal.goal.trim(),
    reason: proposal.reason || "confirmed handoff",
    threadId: proposal.threadId || "chat_default",
    createdAt: Date.now(),
  };
  if (!normalized.goal) throw new Error("handoff goal required");
  const input: CreateConversationInput = {
    goal: normalized.goal,
    threadId: normalized.threadId,
    workspaceDir: oh?.workspaceDir,
    model: oh?.llmModel || undefined,
    apiKey: oh?.llmApiKey || undefined,
    baseUrl: oh?.llmBaseUrl || undefined,
  };
  const conversation = await client.createConversation(input, oh);
  return { proposal: normalized, conversation };
}

export interface HandoffTurnDeps {
  client: OpenHandsClient;
  oh?: OpenHandsConfig;
  store: HandoffStore;
  waitForConfirm?: (proposal: HandoffProposal) => Promise<boolean>;
  emit: (event: AgentEvent) => void;
  pollMs?: number;
  timeoutMs?: number;
  threadId?: string;
  /** Existing OpenHands conversation on this thread — continue instead of create. */
  conversationId?: string;
  language?: string;
}

/**
 * This computer → OpenHands immediately. No confirm card.
 * Creates a conversation, or continues one already on this thread.
 */
export async function runHandoffTurn(goal: string, deps: HandoffTurnDeps): Promise<OhConversation | undefined> {
  const proposal = deps.store.propose({ goal, threadId: deps.threadId });
  deps.store.take(proposal.id);
  deps.emit({ type: "status", text: "thinking" });

  let last: OhConversation | undefined;
  let id = (deps.conversationId || "").trim();
  if (id) {
    try {
      last = await deps.client.getConversation(id);
      await deps.client.sendMessage(id, goal);
    } catch {
      id = "";
      last = undefined;
    }
  }
  if (!id) {
    const delivery = await deliverConfirmedHandoff(deps.client, proposal, deps.oh);
    last = delivery.conversation;
    id = last.id;
  }
  if (!id || !last) {
    deps.emit({ type: "error", message: "OpenHands created a conversation without an id" });
    deps.emit({ type: "done" });
    return last;
  }

  const timeoutMs = deps.timeoutMs ?? 60_000;
  const pollMs = deps.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let lastItems: unknown[] = [];
  while (Date.now() < deadline) {
    last = await deps.client.getConversation(id);
    try {
      const page = await deps.client.searchEvents(id, { limit: 80 });
      lastItems = page.items;
    } catch {
      /* events search is optional across OH versions */
    }
    if (isTerminalStatus(last.executionStatus)) break;
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    await sleep(pollMs);
  }
  if (!isTerminalStatus(last.executionStatus)) {
    timedOut = true;
  }
  const raw = agentReplyText(lastItems);
  const outcome = outcomeFromRemote(last.status, timedOut);
  const voiced = voiceChatReply({ userMessage: goal, remoteText: raw, outcome, language: deps.language });
  deps.emit({ type: "token", text: voiced.text });
  if (voiced.kind === "fail") {
    deps.emit({ type: "error", message: voiced.text });
  }
  deps.emit({ type: "done" });
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
