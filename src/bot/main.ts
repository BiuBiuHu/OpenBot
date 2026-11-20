/** Minimal ECS entry: no Pi, UI, A2A SDK or frontend dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { startBotRuntime } from './runtime.js';
const dataDir = path.resolve(process.env.BOT_DATA_DIR || path.join(os.homedir(), '.openbot-runtime'));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const tokenFile = path.join(dataDir, 'service-token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const runtime = await startBotRuntime({ dataDir, token: fs.readFileSync(tokenFile, 'utf8').trim(), port: Number(process.env.BOT_PORT || 3850), oh: {
  ...(process.env.BOT_BROWSER_CDP_URL ? { browser: { cdpUrl: process.env.BOT_BROWSER_CDP_URL } } : {}),
  baseUrl: process.env.OH_BASE_URL || 'http://127.0.0.1:8000',
  sessionApiKey: process.env.OH_SESSION_API_KEY || process.env.OH_SESSION_API_KEYS_0 || '',
  workspaceDir: path.resolve(process.env.BOT_WORKSPACE || path.join(os.homedir(), 'openbot-workspace')),
  llmModel: process.env.OH_LLM_MODEL || '', llmApiKey: process.env.OH_LLM_API_KEY || '', llmBaseUrl: process.env.OH_LLM_BASE_URL || '',
} });
console.log(`OpenBot runtime listening on ${runtime.baseUrl}; credentials stay in ${dataDir}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await runtime.close(); process.exit(0); });
