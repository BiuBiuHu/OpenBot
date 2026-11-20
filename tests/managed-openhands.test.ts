import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngineSetup, installManagedEngine, parseEngineResult, type EngineInstall } from '../src/managed-openhands.js';
import { defaultConfig } from '../src/config.js';
const result: EngineInstall = { version: '1.49.2', port: 18000, sessionApiKey: 'a'.repeat(64), changed: true, lockSha256: 'b'.repeat(64) };
const response = { code: 0, stdout: JSON.stringify(result), stderr: '' };

test('installer validates pinned version and credentials, never echoes raw output on error', () => {
  assert.deepEqual(parseEngineResult(response), result);
  assert.throws(() => parseEngineResult({ ...response, stdout: JSON.stringify({ ...result, version: 'latest' }) }), /校验失败/);
  assert.throws(() => parseEngineResult({ code: 1, stdout: '', stderr: 'SECRET-PASSWORD' }), error => !String(error).includes('SECRET-PASSWORD'));
});

test('SSH installer sends hash lock over stdin and deduplicates simultaneous requests', async () => {
  const config = defaultConfig({ host: { hostname: 'example.test', user: 'ubuntu', port: 22, name: 'test' } });
  let calls = 0;
  const runner = async (command: string, args: string[], opts: { input: string }) => {
    calls++;
    assert.equal(command, 'ssh');
    assert.match(args.at(-1)!, /^sudo -n \/usr\/bin\/python3 -c /);
    assert.match(JSON.parse(opts.input).lock, /openhands-agent-server==1.49.2/);
    assert.match(JSON.parse(opts.input).lock, /--hash=sha256:/);
    await new Promise(resolve => setTimeout(resolve, 10));
    return response;
  };
  const a = installManagedEngine(config, runner);
  const b = installManagedEngine(config, runner);
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
    let applied = 0, calls = 0;
    const setup = createEngineSetup(() => config, next => { config = next; applied++; }, async () => { calls++; if (calls === 1) throw new Error('网络失败'); return result; });
    setup.start(); setup.start(); await setup.settled();
    assert.equal(calls, 1); assert.equal(applied, 0); assert.equal(setup.state().status, 'failed');
    setup.start(); await setup.settled();
    assert.equal(applied, 1); assert.equal(setup.state().status, 'succeeded');
    assert.ok(!JSON.stringify(setup.state()).includes(result.sessionApiKey));
    assert.equal(fs.statSync(path.join(home, '.env')).mode & 0o777, 0o600);
    const changed = createEngineSetup(() => config, () => { applied++; }, async () => { config = { ...config, host: { ...config.host, hostname: 'second.test' } }; return result; });
    changed.start(); await changed.settled(); assert.equal(applied, 1); assert.equal(changed.state().status, 'failed');
  } finally {
    if (before === undefined) delete process.env.OPENBOT_HOME; else process.env.OPENBOT_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
