import { BotError } from './bot/contracts.js';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { repoRoot, openbotHome } from './paths.js';
import { runCommand, shellQuote, sshBaseArgs, sshTarget, type RunResult } from './ssh.js';
import { saveConfig, upsertHomeEnv } from './config.js';
import type { OpenBotConfig } from './types.js';

export const OPENHANDS_VERSION = '1.49.2';
export interface EngineInstall { version: string; port: number; sessionApiKey: string; changed: boolean; lockSha256: string; stack?: { runtimePort: number; desktopPort: number; cdpPort: number; token: string; instanceId: string; sourceCommit: string; changed: boolean; nodeVersion: string; browserVersion: string } }
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

export function setupModel(config: OpenBotConfig) {
  if (config.openhands.llmApiKey) return { name: config.openhands.llmModel || 'deepseek/deepseek-chat', apiKey: config.openhands.llmApiKey, baseUrl: config.openhands.llmBaseUrl || '' };
  // Existing local providers use the OpenAI-compatible API; preserve their model id.
  return { name: config.llm.apiKey ? 'openai/' + config.llm.model : '', apiKey: config.llm.apiKey || '', baseUrl: config.llm.baseUrl || '' };
}

export async function buildRuntimeBundle() {
  const revision = await runCommand('git', ['rev-parse', 'HEAD']);
  if (revision.code !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim())) throw new Error('无法确定 Runtime 源码版本。请在 Git 仓库中初始化。');
  const sourceCommit = revision.stdout.trim();
  const artifact = path.join(repoRoot(), 'dist', `openbot-runtime-${sourceCommit.slice(0, 7)}.tar.gz`);
  if (!fs.existsSync(artifact)) {
    const packed = await runCommand(process.execPath, [path.join(repoRoot(), 'scripts/build-bot.mjs'), sourceCommit], { timeoutMs: 120000 });
    if (packed.code !== 0) throw new Error('Runtime 打包失败，请先运行 npm ci 和 npm run build 后重试。');
  }
  const bytes = fs.readFileSync(artifact);
  return { archive: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), sourceCommit };
}

export function installManagedEngine(config: OpenBotConfig, runner: InstallerRunner = runCommand, bundle = buildRuntimeBundle): Promise<EngineInstall> {
  if (!config.host.hostname) return Promise.reject(new Error('请先保存 ECS 连接信息。'));
  const host = JSON.stringify(config.host);
  const active = pending.get(host);
  if (active) return active;
  const installation = (async () => {
    const root = path.join(repoRoot(), 'runtime/openhands');
    const base = fs.readFileSync(path.join(root, 'install.py'), 'utf8').split("if __name__ == '__main__':")[0];
    const script = base + '\n' + fs.readFileSync(path.join(repoRoot(), 'runtime/desktop/install.py'), 'utf8');
    const assets = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'runtime/desktop/assets.json'), 'utf8'));
    const runtime = await bundle();
    const model = setupModel(config);
    if (!model.name || !model.apiKey) throw new Error('请先填写远端模型名称和 API Key，再初始化电脑。');
    const lock = fs.readFileSync(path.join(root, 'requirements.lock'), 'utf8');
    const elevate = config.host.user === 'root' ? '' : 'sudo -n ';
    const bootstrap = `if [ ! -x /usr/bin/python3 ]; then . /etc/os-release; [ \"$ID:$VERSION_ID\" = ubuntu:24.04 ] || exit 1; ${elevate}apt-get update >&2 && ${elevate}apt-get install -y python3 >&2 || exit 1; fi; `;
    const command = bootstrap + `${elevate}/usr/bin/python3 -c ${shellQuote(script)}`;
    // Passwords are neither command arguments nor returned to the browser.
    const result = await runner('ssh', [...sshBaseArgs(config), sshTarget(config), command], { input: JSON.stringify({ lock, assets, runtime, model, browserProbe: fs.readFileSync(path.join(repoRoot(), 'runtime/desktop/browser-smoke.mjs'), 'utf8') }), timeoutMs: 30 * 60_000 });
    const installed = parseEngineResult(result);
    if (installed.lockSha256 !== createHash('sha256').update(lock).digest('hex')) throw new Error('远端依赖锁与当前客户端不一致；连接配置未更改。');
    const stack = installed.stack;
    if (!stack || stack.runtimePort !== 13850 || stack.desktopPort !== 16080 || stack.cdpPort !== 19322 || !/^[a-f0-9]{64}$/.test(stack.token) || !/^[a-f0-9-]{36}$/.test(stack.instanceId) || stack.sourceCommit !== runtime.sourceCommit) throw new Error('电脑环境初始化结果校验失败；连接配置未更改。');
    return installed;
  })().finally(() => pending.delete(host));
  pending.set(host, installation);
  return installation;
}

export function useManagedEngine(config: OpenBotConfig, result: EngineInstall): OpenBotConfig {
  const next = { ...config, ...(result.stack ? { desktop: { localPort: 16080, remotePort: result.stack.desktopPort } } : {}), openhands: { ...config.openhands, remotePort: result.port, baseUrl: `http://127.0.0.1:${result.port}`, workspaceDir: '/var/lib/openbot-engine/workspace', sessionApiKey: result.sessionApiKey } };
  // Store the session key only in the protected environment file.
  upsertHomeEnv({ OH_SESSION_API_KEY: result.sessionApiKey, OH_LLM_MODEL: config.openhands.llmModel, OH_LLM_API_KEY: config.openhands.llmApiKey, OH_LLM_BASE_URL: config.openhands.llmBaseUrl || '' });
  saveConfig({ ...next, openhands: { ...next.openhands, sessionApiKey: '', llmApiKey: '' } });
  if (result.stack) {
    const dest = path.join(openbotHome(), 'bot-connection.json');
    fs.writeFileSync(dest + '.tmp', JSON.stringify({ host: JSON.stringify(next.host), token: result.stack.token, remotePort: result.stack.runtimePort, instanceId: result.stack.instanceId }), { mode: 0o600 });
    fs.renameSync(dest + '.tmp', dest);
  }
  return next;
}

export function createEngineSetup(config: () => OpenBotConfig, applied: (next: OpenBotConfig) => void | Promise<void>, installer = installManagedEngine) {
  let state: InstallState = { status: 'idle', message: '自动准备执行引擎、浏览器、可视桌面和任务服务。', version: OPENHANDS_VERSION };
  let running: Promise<void> | undefined;
  return {
    state: () => ({ ...state }),
    start(model?: { name?: string; apiKey?: string; baseUrl?: string }) {
      if (running) return { ...state };
      const snapshot = structuredClone(config());
      if (!snapshot.host.hostname) throw new BotError('请先保存 ECS 连接信息。', 400);
      const existing = setupModel(snapshot);
      snapshot.openhands = { ...snapshot.openhands, llmModel: existing.name, llmApiKey: existing.apiKey, llmBaseUrl: existing.baseUrl };
      if (model) {
        for (const value of Object.values(model)) if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new BotError('模型配置格式不正确。');
        snapshot.openhands.llmModel = model.name?.trim() || snapshot.openhands.llmModel;
        snapshot.openhands.llmApiKey = model.apiKey?.trim() || snapshot.openhands.llmApiKey;
        snapshot.openhands.llmBaseUrl = model.baseUrl?.trim() || snapshot.openhands.llmBaseUrl;
      }
      if (!snapshot.openhands.llmModel || !snapshot.openhands.llmApiKey) throw new BotError('请先填写模型名称和 API Key。');
      state = { status: 'installing', version: OPENHANDS_VERSION, message: '正在准备系统依赖、执行引擎、浏览器、桌面和任务服务，首次初始化可能需要数分钟。' };
      running = installer(snapshot).then(async result => {
        if (JSON.stringify(config().host) !== JSON.stringify(snapshot.host)) throw new Error('安装期间连接目标发生变化。远端已安装，但未切换当前连接；请重新检查目标后重试。');
        await applied(useManagedEngine({ ...config(), openhands: snapshot.openhands }, result));
        state = { status: 'succeeded', version: result.version, message: '电脑环境已就绪，任务服务和可视桌面已连接。可以直接开始任务。' };
      }).catch(error => { state = { status: 'failed', version: OPENHANDS_VERSION, message: error instanceof Error ? error.message : '安装失败，请检查连接后重试。' }; }).finally(() => { running = undefined; });
      return { ...state };
    },
    settled: () => running,
  };
}
