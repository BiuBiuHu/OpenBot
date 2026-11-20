/** Versioned, UI-independent contract. Anpai is a future API consumer. */
export type TaskStatus = 'queued' | 'starting' | 'running' | 'waiting_approval' | 'paused' | 'succeeded' | 'failed' | 'interrupted';
export interface BotTask {
  id: string; requestId: string; threadId: string; goal: string;
  source?: { kind: string; referenceId?: string };
  status: TaskStatus; conversationId: string; createdAt: string; updatedAt: string;
  revision: number; result?: string; error?: string; pendingActions?: unknown[]; decidedActionIds?: string[];
}
export interface SubmitTask { requestId: string; threadId: string; goal: string; source?: BotTask['source'] }
export const TERMINAL = new Set<TaskStatus>(['succeeded', 'failed', 'interrupted']);
export class BotError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
