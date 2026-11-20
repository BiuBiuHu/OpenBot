import { OpenHandsClient, OpenHandsError } from '../oh-client.js';
import { agentReplyText } from '../oh-events.js';
import type { OpenHandsConfig } from '../types.js';
import { BotError, TERMINAL, type BotTask } from './contracts.js';
import { TaskStore } from './store.js';

/** Observer runs on ECS. Disconnecting a client never cancels the model loop. */
export class TaskEngine {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private ticking?: Promise<void>;
  private actions = new Set<string>();
  constructor(readonly store: TaskStore, readonly client: OpenHandsClient, readonly config: OpenHandsConfig, readonly pollMs = 1000) {}
  start() { this.schedule(0); }
  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick().catch(() => { /* state remains queryable; retry observation */ }).finally(() => this.schedule(this.pollMs));
    }, delay);
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.ticking; }
  async tick() {
    // Serialize writes to the shared workspace. Waiting/paused tasks hold the queue.
    const task = [...this.store.tasks.values()].find(t => !TERMINAL.has(t.status));
    if (!task || this.actions.has(task.id)) return;
    if (task.status === 'queued') {
      const pending = this.store.save({ ...task, status: 'starting', error: undefined });
      try {
        const conv = await this.client.createConversation({ goal: task.goal, conversationId: task.id, workspaceDir: this.config.workspaceDir, confirmationPolicy: 'AlwaysConfirm' }, this.config);
        this.store.save({ ...pending, conversationId: conv.id, status: 'running' });
      } catch {
        // Creation may have succeeded despite a lost response. Never POST again.
        this.store.save({ ...pending, error: 'Submission uncertain; checking the existing conversation. No automatic resubmission.' });
      }
      return;
    }
    if (task.status === 'paused') return;
    await this.observe(task);
  }
  private async observe(task: BotTask) {
    try {
      const conv = await this.client.getConversation(task.conversationId);
      let status: BotTask['status'] = 'running';
      if (conv.executionStatus === 'paused') status = 'paused';
      else if (conv.status === 'awaiting_approval') status = 'waiting_approval';
      else if (conv.status === 'succeeded') status = 'succeeded';
      else if (['failed', 'cancelled', 'timeout'].includes(conv.status)) status = 'failed';
      let result = task.result, pendingActions = task.pendingActions;
      if (status === 'succeeded' || status === 'failed' || status === 'waiting_approval') {
        const events: Record<string, unknown>[] = [];
        let pageId: string | undefined;
        for (let page = 0; page < 50; page++) {
          const next = await this.client.searchEvents(task.conversationId, { limit: 100, pageId });
          events.push(...next.items); pageId = next.nextPageId;
          if (!pageId) break;
        }
        if (pageId) throw new Error('Event history exceeds observation limit');
        const observed = new Set(events.filter(e => e.kind === 'ObservationEvent').map(e => e.action_id));
        result = agentReplyText(events).slice(0, 100000);
        // Only show actual action records, never fabricate a command from the goal.
        pendingActions = status === 'waiting_approval' ? events.filter(e => e.kind === 'ActionEvent' && !observed.has(e.id)).slice(-10).map(e => ({ id: e.id, toolCallId: e.tool_call_id, tool: e.tool_name, action: e.action, summary: e.summary })) : undefined;
      }
      if (status !== task.status || result !== task.result || task.error || JSON.stringify(pendingActions) !== JSON.stringify(task.pendingActions)) this.store.save({ ...task, status, result, pendingActions, error: undefined });
    } catch (e) {
      const missing = e instanceof OpenHandsError && e.status === 404;
      this.store.save({ ...task, status: missing ? 'interrupted' : task.status, error: missing ? 'Runtime conversation missing. Inspect remote side effects before creating a new task.' : 'Cannot reach execution service; task outcome is not yet known.' });
    }
  }
  async action(id: string, action: string, revision: number, accept?: boolean) {
    if (this.actions.has(id)) throw new BotError('Action already in progress', 409);
    this.actions.add(id);
    try {
      await this.ticking;
      const task = this.store.get(id);
      if (task.revision !== revision) throw new BotError('Task changed; refresh before acting', 409);
      if (action === 'approval') {
        if (task.status !== 'waiting_approval' || !task.pendingActions?.length || typeof accept !== 'boolean') throw new BotError('No matching approval', 409);
        const actionIds = task.pendingActions.map(a => String((a as { id?: string }).id || ''));
        if (actionIds.some(id => !id || task.decidedActionIds?.includes(id))) throw new BotError('This action already has a recorded decision; reconcile remote state', 409);
        // Persist before sending: a lost response must never regrant this approval.
        const next = this.store.save({ ...task, status: 'paused', decidedActionIds: [...(task.decidedActionIds || []), ...actionIds], error: 'Approval delivery pending; refresh to reconcile before retrying.' });
        await this.client.respondToConfirmation(task.conversationId, accept);
        return this.store.save({ ...next, status: accept ? 'running' : 'paused', pendingActions: undefined, error: undefined });
      }
      if (action === 'refresh') { await this.observe(task); return this.store.get(id); }
      if (action === 'pause' && task.status === 'running') {
        await this.client.pauseConversation(task.conversationId);
        await this.observe(task); return this.store.get(id);
      }
      if (action === 'resume' && task.status === 'paused' && !task.error) {
        await this.client.runConversation(task.conversationId);
        return this.store.save({ ...task, status: 'running' });
      }
      throw new BotError('Action not allowed for this task', 409);
    } finally { this.actions.delete(id); }
  }
}
