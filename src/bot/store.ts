import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BotError, type BotTask, type SubmitTask } from './contracts.js';

/** Atomic records; one runtime process owns this directory. Never stored in workspace. */
export class TaskStore {
  readonly tasks = new Map<string, BotTask>();
  readonly instanceId!: string;
  private lock: string;
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.lock = path.join(dir, 'runtime.lock');
    try {
      const fd = fs.openSync(this.lock, 'wx', 0o600);
      fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
    } catch {
      const pid = Number(fs.readFileSync(this.lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid runtime lock; inspect before removing');
      try { process.kill(pid, 0); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
        fs.unlinkSync(this.lock);
        const fd = fs.openSync(this.lock, 'wx', 0o600);
        fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
        this.initialize(); return;
      }
      throw new Error('A runtime already owns this data directory');
    }
    this.instanceId = this.initialize();
  }
  private initialize(): any {
    const identity = path.join(this.dir, 'identity');
    if (!fs.existsSync(identity)) fs.writeFileSync(identity, randomUUID(), { mode: 0o600 });
    (this as { instanceId: string }).instanceId = fs.readFileSync(identity, 'utf8').trim();
    for (const file of fs.readdirSync(this.dir).filter(f => /^[a-f0-9-]+\.json$/.test(f))) {
      const task = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8')) as BotTask;
      if (!task.id || !task.requestId || !Number.isInteger(task.revision)) throw new Error('Invalid task record');
      this.tasks.set(task.id, task);
    }
    return this.instanceId;
  }
  close() { fs.unlinkSync(this.lock); }
  save(task: BotTask) {
    const next = { ...task, revision: task.revision + 1, updatedAt: new Date().toISOString() };
    const target = path.join(this.dir, `${task.id}.json`);
    const temp = `${target}.tmp`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target); this.tasks.set(next.id, next); return next;
  }
  get(id: string) { const task = this.tasks.get(id); if (!task) throw new BotError('Task not found', 404); return task; }
  create(input: SubmitTask) {
    for (const key of ['requestId', 'threadId', 'goal'] as const) {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > (key === 'goal' ? 20000 : 128)) throw new BotError(`Invalid ${key}`);
    }
    if (input.source && (typeof input.source.kind !== 'string' || input.source.kind.length > 64 || (input.source.referenceId !== undefined && (typeof input.source.referenceId !== 'string' || input.source.referenceId.length > 256)))) throw new BotError('Invalid source');
    if (input.executionProfile !== undefined && !['computer', 'private_browser'].includes(input.executionProfile)) throw new BotError('Invalid executionProfile');
    if (input.observationPolicy !== undefined && !['confirm_all', 'auto_browser_reads', 'autonomous'].includes(input.observationPolicy)) throw new BotError('Invalid observationPolicy');
    const prior = [...this.tasks.values()].find(t => t.requestId === input.requestId);
    if (prior) {
      if ((prior.executionProfile || 'computer') !== (input.executionProfile || 'computer') || (prior.observationPolicy || 'confirm_all') !== (input.observationPolicy || 'autonomous') || prior.goal !== input.goal || prior.threadId !== input.threadId || JSON.stringify(prior.source) !== JSON.stringify(input.source)) throw new BotError('requestId already belongs to a different task', 409);
      return prior;
    }
    const id = randomUUID(), now = new Date().toISOString();
    return this.save({ id, executionProfile: input.executionProfile || 'computer', observationPolicy: input.observationPolicy || 'autonomous', requestId: input.requestId, threadId: input.threadId, goal: input.goal, source: input.source, status: 'queued', conversationId: id, revision: 0, createdAt: now, updatedAt: now });
  }
}
