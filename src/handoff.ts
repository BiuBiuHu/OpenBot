import { emitUnseenOhEvents } from "./oh-events.js";
import {
  OpenHandsClient,
  conversationSnippet,
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
  };
  const conversation = await client.createConversation(input, oh);
  return { proposal: normalized, conversation };
}

export interface HandoffTurnDeps {
  client: OpenHandsClient;
  oh?: OpenHandsConfig;
  store: HandoffStore;
  waitForConfirm: (proposal: HandoffProposal) => Promise<boolean>;
  emit: (event: AgentEvent) => void;
  pollMs?: number;
  timeoutMs?: number;
  threadId?: string;
}

/**
 * Same-thread handoff: emit a confirm card, then create an OH conversation
 * and poll events back as `thought` / `status`. Does not call the local LLM.
 */
export async function runHandoffTurn(goal: string, deps: HandoffTurnDeps): Promise<OhConversation | undefined> {
  const proposal = deps.store.propose({ goal, threadId: deps.threadId });
  deps.emit({
    type: "handoff_proposal",
    id: proposal.id,
    goal: proposal.goal,
    reason: proposal.reason,
  });
  const allowed = await deps.waitForConfirm(proposal);
  if (!allowed) {
    deps.store.deny(proposal.id);
    deps.emit({ type: "error", message: "Handoff denied — nothing sent to the computer." });
    deps.emit({ type: "done" });
    return undefined;
  }
  deps.store.take(proposal.id);
  deps.emit({ type: "status", text: `handoff ${proposal.id} → OpenHands` });
  const delivery = await deliverConfirmedHandoff(deps.client, proposal, deps.oh);
  const id = delivery.conversation.id;
  deps.emit({
    type: "status",
    text: `remote conversation ${id} ${delivery.conversation.executionStatus}`,
  });
  if (!id) {
    deps.emit({ type: "error", message: "OpenHands created a conversation without an id" });
    deps.emit({ type: "done" });
    return delivery.conversation;
  }

  const seen = new Set<string>();
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const pollMs = deps.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let last = delivery.conversation;
  let timedOut = false;
  let mappedEvents = 0;
  while (Date.now() < deadline) {
    last = await deps.client.getConversation(id);
    deps.emit({ type: "status", text: `remote ${last.executionStatus} (${last.status})` });
    try {
      const page = await deps.client.searchEvents(id, { limit: 80 });
      mappedEvents += emitUnseenOhEvents(page.items, seen, deps.emit);
      if (!mappedEvents) {
        const snippet = conversationSnippet(page);
        if (snippet && !seen.has(`snippet:${snippet}`)) {
          seen.add(`snippet:${snippet}`);
          deps.emit({ type: "thought", text: snippet });
        }
      }
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
  if (timedOut) {
    deps.emit({
      type: "error",
      message: `remote conversation ${id} timed out while ${last.executionStatus} (${last.status})`,
    });
  } else if (last.status === "failed" || last.status === "timeout") {
    deps.emit({
      type: "error",
      message: `remote conversation ${id} ${last.executionStatus} (${last.status})`,
    });
  } else if (last.status === "cancelled") {
    deps.emit({ type: "error", message: `remote conversation ${id} cancelled` });
  }
  deps.emit({ type: "done" });
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
