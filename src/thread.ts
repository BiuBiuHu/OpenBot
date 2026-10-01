import { runAgentTurn, runLocalChatTurn } from "./agent.js";
import { hasLocalModelKey } from "./config.js";
import { runHandoffTurn, type HandoffTurnDeps } from "./handoff.js";
import type { AgentEvent, ApprovalRequest, ChatMessage, LlmConfig } from "./types.js";
import type { WorkerClient } from "./worker-client.js";
import type { OhConversation } from "./oh-client.js";

export interface ThreadTurnDeps extends HandoffTurnDeps {
  llm?: LlmConfig;
  worker?: WorkerClient;
  history?: ChatMessage[];
  waitForApproval?: (req: ApprovalRequest) => Promise<boolean>;
  /** Force the remote OpenHands path (This computer). */
  forceHandoff?: boolean;
}

export interface ThreadTurnResult {
  path: "handoff" | "local" | "worker";
  conversation?: OhConversation;
  history: ChatMessage[];
}

/**
 * One local chat thread.
 * - Remote OpenHands is the important path (no local key, or forceHandoff).
 * - Local BYOK chat is optional and never requires a worker.
 * - The PR#1 worker tool loop stays available when both a key and worker exist.
 */
export async function runThreadTurn(message: string, deps: ThreadTurnDeps): Promise<ThreadTurnResult> {
  const goal = message.trim();
  if (!goal) throw new Error("message required");
  const hasLocalKey = hasLocalModelKey(deps.llm?.apiKey);
  const useHandoff = deps.forceHandoff || !hasLocalKey;

  if (useHandoff) {
    const conversation = await runHandoffTurn(goal, deps);
    return { path: "handoff", conversation, history: deps.history ?? [] };
  }

  if (deps.worker && deps.llm && deps.waitForApproval) {
    const history = await runAgentTurn(goal, {
      worker: deps.worker,
      llm: deps.llm,
      history: deps.history,
      emit: deps.emit,
      waitForApproval: deps.waitForApproval,
    });
    return { path: "worker", history };
  }

  if (!deps.llm) {
    deps.emit({ type: "error", message: "local chat needs an LLM config" });
    deps.emit({ type: "done" });
    return { path: "local", history: deps.history ?? [] };
  }
  const history = await runLocalChatTurn(goal, {
    llm: deps.llm,
    history: deps.history,
    emit: deps.emit,
  });
  return { path: "local", history };
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
