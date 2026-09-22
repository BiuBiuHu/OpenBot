import {
  OpenHandsClient,
  type CreateConversationInput,
  type OhConversation,
} from "./oh-client.js";
import type { HandoffProposal, OpenHandsConfig } from "./types.js";

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
    model: oh?.llmModel,
    apiKey: oh?.llmApiKey,
  };
  const conversation = await client.createConversation(input, oh);
  return { proposal: normalized, conversation };
}
