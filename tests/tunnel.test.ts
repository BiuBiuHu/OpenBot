import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { it } from 'node:test';
import { defaultConfig } from '../src/config.js';
import { openLocalForward } from '../src/tunnel.js';
import { freePort } from './helpers.js';

it('waits for SSH forwarding after slow authentication and reports early SSH failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-ssh-test-'));
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = `${dir}:${previousPath}`;
    fs.writeFileSync(path.join(dir, 'ssh'), `#!${process.execPath}\nconst net=require('node:net'); const port=Number(process.argv[process.argv.indexOf('-L')+1].split(':')[1]); setTimeout(()=>net.createServer(s=>s.end()).listen(port,'127.0.0.1'),1400);`, {mode:0o700});
    const localPort = await freePort();
    const start = Date.now();
    const tunnel = await openLocalForward(defaultConfig(), {localPort, remotePort:3850, connectTimeoutSec:2});
    try {
      assert.ok(Date.now()-start >= 1300, 'must not report ready after a fixed 600ms');
      await new Promise<void>((resolve,reject)=>{const s=net.connect(localPort,'127.0.0.1',()=>{s.destroy();resolve()});s.on('error',reject)});
    } finally { await tunnel.stop(); }
    fs.writeFileSync(path.join(dir,'ssh'), `#!${process.execPath}\nprocess.stderr.write('Permission denied'); process.exit(255);`, {mode:0o700});
    await assert.rejects(openLocalForward(defaultConfig(),{localPort:await freePort(),remotePort:3850}),/Permission denied/);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
