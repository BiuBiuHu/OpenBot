import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { openbotHome, repoRoot } from '../paths.js';
import { openLocalForward, type TunnelHandle } from '../tunnel.js';
import type { OpenBotConfig } from '../types.js';
import { BotError } from './contracts.js';
import { body, json, failure } from './http.js';

interface Connection { host: string; token: string; remotePort: number; instanceId?: string }
export function createBotProxy(config: () => OpenBotConfig) {
  const session = randomBytes(32).toString('hex');
  const connectionFile = path.join(openbotHome(), 'bot-connection.json');
  let connection: Connection | undefined = fs.existsSync(connectionFile) ? JSON.parse(fs.readFileSync(connectionFile, 'utf8')) : undefined;
  let tunnel: TunnelHandle | undefined, baseUrl = '';
  let connecting: Promise<any> | undefined;
  const hostKey = () => JSON.stringify(config().host);
  const save = () => { fs.mkdirSync(path.dirname(connectionFile), { recursive: true, mode: 0o700 }); fs.writeFileSync(connectionFile + '.tmp', JSON.stringify(connection), { mode: 0o600 }); fs.renameSync(connectionFile + '.tmp', connectionFile); };
  async function request(route: string, method = 'GET', value?: unknown) {
    const res = await fetch(baseUrl + route, { method, headers: { Authorization: `Bearer ${connection!.token}`, 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(35000), redirect: 'error' });
    const data = await res.json(); if (!res.ok) throw new BotError(String((data as any).error || 'Remote request failed'), res.status); return data as any;
  }
  async function connect() {
    if (connecting) return connecting;
    connecting = (async () => {
      if (!connection || connection.host !== hostKey()) throw new BotError('Connect this host with its Bot service token first', 409);
      await tunnel?.stop(); tunnel = undefined; baseUrl = '';
      // Always create a new forward; never trust whichever service occupies a fixed local port.
      const port = await new Promise<number>((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
      if (!config().host.hostname) throw new BotError('Set SSH host in Settings first');
      tunnel = await openLocalForward(config(), { localPort: port, remotePort: connection.remotePort, connectTimeoutSec: 8 });
      baseUrl = `http://127.0.0.1:${port}`;
      try {
        const identity = await request('/v1/identity');
        if (identity.apiVersion !== 1 || typeof identity.instanceId !== 'string') throw new BotError('Unsupported Bot runtime', 409);
        if (connection.instanceId && connection.instanceId !== identity.instanceId) throw new BotError('Runtime identity changed; verify the host before reconnecting', 409);
        connection.instanceId = identity.instanceId; save(); return identity;
      } catch (e) { await tunnel?.stop(); tunnel = undefined; baseUrl = ''; throw e; }
    })().finally(() => { connecting = undefined; });
    return connecting;
  }
  return {
    async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
      const url = new URL(req.url || '/', 'http://localhost');
      const home = url.pathname === '/' || url.pathname === '/index.html';
      if (!home && url.pathname !== '/bot' && !url.pathname.startsWith('/api/bot/')) return false;
      try {
        const host = String(req.headers.host || '');
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new BotError('Invalid host', 403);
        if ((home || url.pathname === '/bot') && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
          res.end(fs.readFileSync(path.join(repoRoot(), home ? 'src/ui/index.html' : 'src/ui/bot.html'), 'utf8').replace('__SESSION__', session).replace('__BOT_SESSION__', session)); return true;
        }
        if (req.headers['x-openbot-session'] !== session) throw new BotError('Reload the Bot page to connect', 403);
        if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new BotError('Invalid origin', 403);
        if (url.pathname === '/api/bot/connection' && req.method === 'GET') { json(res, 200, { configured: !!connection && connection.host === hostKey(), connected: !!baseUrl, hostName: config().host.name }); return true; }
        if (url.pathname === '/api/bot/connect' && req.method === 'POST') {
          const b = await body(req);
          if (b.token) {
            if (typeof b.token !== 'string' || b.token.length < 32 || b.token.length > 256) throw new BotError('Invalid service token');
            const remotePort = b.remotePort ?? 3850;
            if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw new BotError('Invalid port');
            const same = connection?.host === hostKey();
            connection = { host: hostKey(), token: b.token, remotePort, instanceId: same ? connection?.instanceId : undefined };
          }
          json(res, 200, await connect()); return true;
        }
        if (!baseUrl || connection?.host !== hostKey()) throw new BotError('Connection interrupted. Reconnect to recover tasks.', 503);
        const route = url.pathname.slice('/api/bot'.length);
        if (!/^\/(tasks(?:\/[a-f0-9-]+(?:\/(approval|pause|resume|refresh|cancel|autonomy))?)?|files|file)$/.test(route)) throw new BotError('Not found', 404);
        const data = await request('/v1' + route + url.search, req.method, req.method === 'POST' ? await body(req) : undefined);
        json(res, req.method === 'POST' && route === '/tasks' ? 202 : 200, data);
      } catch (e) { failure(res, e); }
      return true;
    },
    close: async () => { await connecting?.catch(() => {}); await tunnel?.stop(); },
  };
}
