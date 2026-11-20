/** Versioned, UI-independent contract. Anpai is a future API consumer. */
export type TaskStatus = 'queued' | 'starting' | 'running' | 'waiting_approval' | 'paused' | 'waiting_user' | 'succeeded' | 'failed' | 'interrupted';
export type ObservationPolicy = 'confirm_all' | 'auto_browser_reads' | 'autonomous';
export interface HumanInteraction {
  id: string; kind: 'private_input' | 'takeover'; state: 'waiting' | 'applying' | 'completed';
  reason: string; origin?: string; createdAt: string;
  fields?: Array<{ id: string; label: string; elementId: string; sensitive?: boolean }>;
}
export interface BotTask {
  executionProfile?: 'computer' | 'private_browser'; interaction?: HumanInteraction;
  observationPolicy?: ObservationPolicy; autoApprovedActionIds?: string[];
  id: string; requestId: string; threadId: string; goal: string;
  source?: { kind: string; referenceId?: string };
  status: TaskStatus; conversationId: string; createdAt: string; updatedAt: string;
  revision: number; result?: string; error?: string; pendingActions?: unknown[]; decidedActionIds?: string[];
}
export interface SubmitTask { executionProfile?: 'computer' | 'private_browser'; observationPolicy?: ObservationPolicy; requestId: string; threadId: string; goal: string; source?: BotTask['source'] }
export const TERMINAL = new Set<TaskStatus>(['succeeded', 'failed', 'interrupted']);
export class BotError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
