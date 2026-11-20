import { BotError } from './bot/contracts.js';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { repoRoot } from './paths.js';
import { runCommand, shellQuote, sshBaseArgs, sshTarget, type RunResult } from './ssh.js';
import { saveConfig, upsertHomeEnv } from './config.js';
import type { OpenBotConfig } from './types.js';

export const OPENHANDS_VERSION = '1.49.2';
export interface EngineInstall { version: string; port: number; sessionApiKey: string; changed: boolean; lockSha256: string }
export interface InstallState { status: 'idle' | 'installing' | 'succeeded' | 'failed'; message: string; version: string }
export type InstallerRunner = (command: string, args: string[], opts: { input: string; timeoutMs: number }) => Promise<RunResult>;
const pending = new Map<string, Promise<EngineInstall>>();

export function parseEngineResult(result: RunResult): EngineInstall {
  let data: any;
  try { data = JSON.parse(result.stdout.trim()); } catch { throw new Error('安装未返回完整结果。请检查 SSH 和 sudo 权限后重试；不要粘贴凭据或完整日志。'); }
  if (result.code !== 0) throw new Error(typeof data.error === 'string' ? data.error : '安装失败，请检查远端服务后重试。');
  if (data.version !== OPENHANDS_VERSION || data.port !== 18000 || !/^[a-f0-9]{64}$/.test(data.sessionApiKey) || !/^[a-f0-9]{64}$/.test(data.lockSha256) || typeof data.changed !== 'boolean') throw new Error('执行引擎版本或安装响应校验失败；连接配置未更改。');
  return data;
}

export function installManagedEngine(config: OpenBotConfig, runner: InstallerRunner = runCommand): Promise<EngineInstall> {
  if (!config.host.hostname) return Promise.reject(new Error('请先保存 ECS 连接信息。'));
  const host = JSON.stringify(config.host);
  const active = pending.get(host);
  if (active) return active;
  const installation = (async () => {
    const root = path.join(repoRoot(), 'runtime/openhands');
    const script = fs.readFileSync(path.join(root, 'install.py'), 'utf8');
    const lock = fs.readFileSync(path.join(root, 'requirements.lock'), 'utf8');
    const command = `sudo -n /usr/bin/python3 -c ${shellQuote(script)}`;
    // Passwords are neither command arguments nor returned to the browser.
    const result = await runner('ssh', [...sshBaseArgs(config), sshTarget(config), config.host.user === 'root' ? command.replace(/^sudo -n /, '') : command], { input: JSON.stringify({ lock }), timeoutMs: 20 * 60_000 });
    const installed = parseEngineResult(result);
    if (installed.lockSha256 !== createHash('sha256').update(lock).digest('hex')) throw new Error('远端依赖锁与当前客户端不一致；连接配置未更改。');
    return installed;
  })().finally(() => pending.delete(host));
  pending.set(host, installation);
  return installation;
}

export function useManagedEngine(config: OpenBotConfig, result: EngineInstall): OpenBotConfig {
  const next = { ...config, openhands: { ...config.openhands, remotePort: result.port, baseUrl: `http://127.0.0.1:${result.port}`, workspaceDir: '/var/lib/openbot-engine/workspace', sessionApiKey: result.sessionApiKey } };
  // Store the session key only in the protected environment file.
  upsertHomeEnv({ OH_SESSION_API_KEY: result.sessionApiKey });
  saveConfig({ ...next, openhands: { ...next.openhands, sessionApiKey: '' } });
  return next;
}

export function createEngineSetup(config: () => OpenBotConfig, applied: (next: OpenBotConfig) => void, installer = installManagedEngine) {
  let state: InstallState = { status: 'idle', message: '安装经过验证的执行引擎，无需手动配置 OpenHands。', version: OPENHANDS_VERSION };
  let running: Promise<void> | undefined;
  return {
    state: () => ({ ...state }),
    start() {
      if (running) return { ...state };
      const snapshot = structuredClone(config());
      if (!snapshot.host.hostname) throw new BotError('请先保存 ECS 连接信息。', 400);
      state = { status: 'installing', version: OPENHANDS_VERSION, message: '正在检查 ECS、安装锁定依赖并启动服务，首次安装可能需要数分钟。' };
      running = installer(snapshot).then(result => {
        if (JSON.stringify(config().host) !== JSON.stringify(snapshot.host)) throw new Error('安装期间连接目标发生变化。远端已安装，但未切换当前连接；请重新检查目标后重试。');
        applied(useManagedEngine(config(), result));
        state = { status: 'succeeded', version: result.version, message: '执行引擎已就绪，凭据已安全保存。下一步配置模型和 Bot Runtime；已有任务服务未被重启。' };
      }).catch(error => { state = { status: 'failed', version: OPENHANDS_VERSION, message: error instanceof Error ? error.message : '安装失败，请检查连接后重试。' }; }).finally(() => { running = undefined; });
      return { ...state };
    },
    settled: () => running,
  };
}
