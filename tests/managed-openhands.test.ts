import { runCommand } from '../src/ssh.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createEngineSetup, installManagedEngine, parseEngineResult, type EngineInstall } from '../src/managed-openhands.js';
import { defaultConfig } from '../src/config.js';
const result: EngineInstall = { version: '1.49.2', port: 18000, sessionApiKey: 'a'.repeat(64), changed: true, lockSha256: 'b'.repeat(64), stack: { runtimePort:13850, desktopPort:16080, cdpPort:19322, token:'c'.repeat(64), instanceId:'00000000-0000-4000-8000-000000000000', sourceCommit:'d'.repeat(40), changed:true, nodeVersion:'22.23.5', browserVersion:'158.0.8127.36' } };
const response = { code: 0, stdout: JSON.stringify(result), stderr: '' };

test('installer validates pinned version and credentials, never echoes raw output on error', () => {
  assert.deepEqual(parseEngineResult(response), result);
  assert.throws(() => parseEngineResult({ ...response, stdout: JSON.stringify({ ...result, version: 'latest' }) }), /校验失败/);
  assert.throws(() => parseEngineResult({ code: 1, stdout: '', stderr: 'SECRET-PASSWORD' }), error => !String(error).includes('SECRET-PASSWORD'));
});

test('SSH installer sends hash lock over stdin and deduplicates simultaneous requests', async () => {
  const config = defaultConfig({ host: { hostname: 'example.test', user: 'ubuntu', port: 22, name: 'test' } });
  config.openhands.llmModel = 'test/model'; config.openhands.llmApiKey = 'TEST_MODEL_KEY';
  const bundle = async () => ({archive:'test',sha256:'e'.repeat(64),sourceCommit:'d'.repeat(40)});
  let calls = 0;
  const runner = async (command: string, args: string[], opts: { input: string }) => {
    calls++;
    assert.equal(command, 'ssh');
    assert.ok(!args.join(' ').includes('TEST_MODEL_KEY'));
    assert.equal(JSON.parse(opts.input).model.apiKey,'TEST_MODEL_KEY');
    assert.match(args.at(-1)!, /sudo -n \/usr\/bin\/python3 -c /);
    assert.match(JSON.parse(opts.input).lock, /openhands-agent-server==1.49.2/);
    assert.match(JSON.parse(opts.input).lock, /--hash=sha256:/);
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ...response, stdout: JSON.stringify({ ...result, lockSha256: createHash('sha256').update(JSON.parse(opts.input).lock).digest('hex') }) };
  };
  const a = installManagedEngine(config, runner, bundle);
  const b = installManagedEngine(config, runner, bundle);
  assert.equal(a, b);
  await a;
  assert.equal(calls, 1);
});

test('setup preserves configuration on failure/host switch, retries and exposes no credential', async () => {
  const before = process.env.OPENBOT_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-engine-test-'));
  process.env.OPENBOT_HOME = home;
  try {
    let config = defaultConfig({ host: { hostname: 'first.test', user: 'ubuntu', port: 22, name: 'test' } });
    config.openhands.llmModel = 'test/model'; config.openhands.llmApiKey = 'TEST_MODEL_KEY';
    let applied = 0, calls = 0;
    const setup = createEngineSetup(() => config, next => { config = next; applied++; }, async () => { calls++; if (calls === 1) throw new Error('网络失败'); return result; });
    setup.start(); setup.start(); await setup.settled();
    assert.equal(calls, 1); assert.equal(applied, 0); assert.equal(setup.state().status, 'failed');
    setup.start(); await setup.settled();
    assert.equal(applied, 1); assert.equal(setup.state().status, 'succeeded');
    assert.ok(!JSON.stringify(setup.state()).includes(result.sessionApiKey));
    assert.equal(fs.statSync(path.join(home, '.env')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(home, 'bot-connection.json')).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'bot-connection.json'),'utf8')).remotePort,13850);
    assert.equal(config.desktop.remotePort,16080);
    assert.ok(!fs.readFileSync(path.join(home, 'config.json'), 'utf8').includes(result.sessionApiKey));
    const changed = createEngineSetup(() => config, () => { applied++; }, async () => { config = { ...config, host: { ...config.host, hostname: 'second.test' } }; return result; });
    changed.start(); await changed.settled(); assert.equal(applied, 1); assert.equal(changed.state().status, 'failed');
  } finally {
    if (before === undefined) delete process.env.OPENBOT_HOME; else process.env.OPENBOT_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an early SSH/sudo-style rejection with a large payload does not crash the process', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.exit(1)'], { input: 'x'.repeat(1024 * 1024) });
  assert.equal(result.code, 1);
});
