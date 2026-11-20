import type http from 'node:http';
import { BotError } from './contracts.js';
export function json(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
}
export async function body(req: http.IncomingMessage): Promise<any> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 128 * 1024) throw new BotError('Request too large', 413); chunks.push(chunk); }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; } catch { throw new BotError('JSON object required'); }
}
export function failure(res: http.ServerResponse, error: unknown) {
  const status = error instanceof BotError ? error.status : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 503;
  json(res, status, { error: error instanceof BotError ? error.message : status === 404 ? 'Not found' : 'Service unavailable; inspect runtime logs or retry observation.' });
}
