import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { OpenHandsClient } from '../oh-client.js';
import type { OpenHandsConfig } from '../types.js';
import { TaskStore } from './store.js';
import { TaskEngine } from './engine.js';
import { WorkspaceFiles } from './files.js';
import { BotError } from './contracts.js';
import { body, json, failure } from './http.js';

export async function startBotRuntime(opts: { dataDir: string; token: string; port?: number; oh: OpenHandsConfig; pollMs?: number }) {
  if (opts.token.length < 32) throw new Error('Bot service token must contain at least 32 characters');
  const store = new TaskStore(opts.dataDir);
  const files = new WorkspaceFiles(opts.oh.workspaceDir);
  const engine = new TaskEngine(store, OpenHandsClient.fromConfig(opts.oh), opts.oh, opts.pollMs);
  const server = http.createServer(async (req, res) => {
    try {
      const got = Buffer.from(String(req.headers.authorization || '')), expected = Buffer.from(`Bearer ${opts.token}`);
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new BotError('Unauthorized', 401);
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/v1/identity') {
        json(res, 200, { apiVersion: 1, instanceId: store.instanceId, capabilities: ['tasks', 'files.read', 'files.list', 'approvals'], execution: await engine.client.health() }); return;
      }
      if (url.pathname === '/v1/tasks' && req.method === 'POST') {
        json(res, 202, { task: store.create(await body(req)) }); return;
      }
      if (url.pathname === '/v1/tasks' && req.method === 'GET') {
        const items = [...store.tasks.values()].filter(t => !url.searchParams.get('threadId') || t.threadId === url.searchParams.get('threadId')).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new BotError('Invalid offset');
        json(res, 200, { tasks: items.slice(offset, offset + 100), nextOffset: offset + 100 < items.length ? offset + 100 : null }); return;
      }
      const match = url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]+)(?:\/(approval|pause|resume|refresh))?$/);
      if (match && req.method === 'GET' && !match[2]) { json(res, 200, { task: store.get(match[1]) }); return; }
      if (match && req.method === 'POST' && match[2]) { const b = await body(req); json(res, 200, { task: await engine.action(match[1], match[2], b.revision, b.accept) }); return; }
      if (req.method === 'GET' && url.pathname === '/v1/files') { json(res, 200, { entries: files.list(url.searchParams.get('path') || '') }); return; }
      if (req.method === 'GET' && url.pathname === '/v1/file') { json(res, 200, files.read(url.searchParams.get('path') || '')); return; }
      throw new BotError('Not found', 404);
    } catch (e) { failure(res, e); }
  });
  try { await new Promise<void>((resolve,reject) => { server.once('error', reject); server.listen(opts.port ?? 3850, '127.0.0.1', resolve); }); }
  catch (e) { store.close(); throw e; }
  engine.start();
  const port = (server.address() as { port: number }).port;
  return { baseUrl: `http://127.0.0.1:${port}`, store, engine, close: async () => { await engine.stop(); await new Promise<void>(r => server.close(() => r())); store.close(); } };
}
