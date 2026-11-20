import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { OpenHandsClient } from '../oh-client.js';
import type { OpenHandsConfig } from '../types.js';
import { TaskStore } from './store.js';
import { PrivateBrowsers } from './private-browser.js';
import { TaskEngine } from './engine.js';
import { WorkspaceFiles } from './files.js';
import { BotError } from './contracts.js';
import { body, json, failure } from './http.js';

export async function startBotRuntime(opts: { dataDir: string; token: string; port?: number; oh: OpenHandsConfig; pollMs?: number }) {
  if (opts.token.length < 32) throw new Error('Bot service token must contain at least 32 characters');
  const store = new TaskStore(opts.dataDir);
  const files = new WorkspaceFiles(opts.oh.workspaceDir);
  let baseUrl = '';
  const privateBrowsers = new PrivateBrowsers(store, opts.oh.browser?.cdpUrl || '', () => baseUrl);
  for (const task of store.tasks.values()) if (task.executionProfile === 'private_browser' && !['succeeded','failed','interrupted'].includes(task.status)) store.save({ ...task, status: 'interrupted', error: '私密浏览器会话因执行服务重启已关闭。请重新发起任务并通过私密输入框填写；不会重放凭据。' });
  const engine = new TaskEngine(store, OpenHandsClient.fromConfig(opts.oh), opts.oh, opts.pollMs, privateBrowsers);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const mcp = url.pathname.match(/^\/mcp\/([a-f0-9]{64})$/);
      if (mcp) {
        const taskId = privateBrowsers.taskForToken(mcp[1]); if (!taskId) throw new BotError('Not found',404);
        if (req.method !== 'POST') { res.writeHead(405);res.end();return; }
        const b = await body(req);
        if (b.id === undefined) { res.writeHead(202);res.end();return; }
        let result: unknown;
        if (b.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'openbot-private-browser', version: '1.0.0' } };
        else if (b.method === 'ping') result = {};
        else if (b.method === 'tools/list') result = { tools: privateBrowsers.toolsFor(taskId) };
        else if (b.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(await privateBrowsers.call(taskId,b.params?.name,b.params?.arguments || {})) }] };
        else { json(res,200,{jsonrpc:'2.0',id:b.id,error:{code:-32601,message:'Method not found'}});return; }
        json(res,200,{jsonrpc:'2.0',id:b.id,result});return;
      }
      const got = Buffer.from(String(req.headers.authorization || '')), expected = Buffer.from(`Bearer ${opts.token}`);
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new BotError('Unauthorized', 401);
      if (req.method === 'GET' && url.pathname === '/v1/identity') {
        json(res, 200, { apiVersion: 1, instanceId: store.instanceId, capabilities: ['tasks', 'files.read', 'files.list', 'approvals', ...(opts.oh.browser ? ['browser'] : [])], execution: await engine.client.health() }); return;
      }
      if (url.pathname === '/v1/tasks' && req.method === 'POST') {
        const input = await body(req);
        if (input.executionProfile === 'private_browser' && !opts.oh.browser) throw new BotError('Protected browser unavailable',503);
        json(res, 202, { task: store.create(input) }); return;
      }
      if (url.pathname === '/v1/tasks' && req.method === 'GET') {
        const items = [...store.tasks.values()].filter(t => !url.searchParams.get('threadId') || t.threadId === url.searchParams.get('threadId')).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new BotError('Invalid offset');
        json(res, 200, { tasks: items.slice(offset, offset + 100), nextOffset: offset + 100 < items.length ? offset + 100 : null }); return;
      }
      const interaction = url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]+)\/interactions\/([a-f0-9-]+)\/(challenge|fill|complete|continue|takeover)$/);
      if (interaction && req.method === 'POST') {
        const [,taskId,requestId,action] = interaction; const b = await body(req);
        if(action==='challenge')json(res,200,{challenge:privateBrowsers.challenge(taskId,requestId)});
        else if(action==='fill'){await privateBrowsers.fill(taskId,requestId,b.envelope);json(res,200,{task:await engine.continueInteraction(taskId,requestId)});}
        else if(action==='takeover'){privateBrowsers.manualTakeover(taskId,requestId);json(res,200,{task:store.get(taskId)});}
        else if(action==='complete'){await privateBrowsers.completeTakeover(taskId,requestId);json(res,200,{task:await engine.continueInteraction(taskId,requestId)});}
        else json(res,200,{task:await engine.continueInteraction(taskId,requestId)});
        return;
      }
      const match = url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]+)(?:\/(approval|pause|resume|refresh|cancel|autonomy))?$/);
      if (match && req.method === 'GET' && !match[2]) { json(res, 200, { task: store.get(match[1]) }); return; }
      if (match && req.method === 'POST' && match[2]) { const b = await body(req); json(res, 200, { task: await engine.action(match[1], match[2], b.revision, b.accept) }); return; }
      if (req.method === 'GET' && url.pathname === '/v1/files') { json(res, 200, { entries: files.list(url.searchParams.get('path') || '') }); return; }
      if (req.method === 'GET' && url.pathname === '/v1/file') { json(res, 200, files.read(url.searchParams.get('path') || '')); return; }
      throw new BotError('Not found', 404);
    } catch (e) { failure(res, e); }
  });
  try { await new Promise<void>((resolve,reject) => { server.once('error', reject); server.listen(opts.port ?? 3850, '127.0.0.1', resolve); }); }
  catch (e) { store.close(); throw e; }
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}`; engine.start();
  return { baseUrl, store, engine, close: async () => { await engine.stop(); await privateBrowsers.close(); await new Promise<void>(r => server.close(() => r())); store.close(); } };
}
