import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {it} from 'node:test';
import {defaultConfig} from '../src/config.js';import {startControlPlane} from '../src/server.js';
import {freePort} from './helpers.js';
it('plugin UI uses a session boundary; foreign origins cannot invoke the remote proxy',async()=>{
  const previous=process.env.OPENBOT_HOME;const home=fs.mkdtempSync(path.join(os.tmpdir(),'bot-proxy-'));process.env.OPENBOT_HOME=home;
  const config=defaultConfig();config.host.hostname='';config.controlPlane.port=await freePort();
  const plane=await startControlPlane(config,{allowWithoutWorker:true,skipTunnel:true});
  const url=`http://127.0.0.1:${config.controlPlane.port}`;
  try{
    const html=await (await fetch(url+'/bot')).text();assert.match(html,/独立测试入口/);
    const session=html.match(/const session='([a-f0-9]+)'/)![1];
    const home=await (await fetch(url+'/')).text();
    assert.ok(home.includes('content="'+session+'"'));
    assert.ok(home.includes('/home-bot.js'));
    assert.equal((await fetch(url+'/home-bot.js')).status,200);
    for (const asset of ['/i18n.js', '/locales.js']) {
      const response = await fetch(url + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /javascript/);
      assert.match(await response.text(), /export /);
    }
    assert.equal((await fetch(url+'/api/bot/tasks')).status,403);
    assert.equal((await fetch(url+'/api/bot/connect',{method:'POST',headers:{'X-OpenBot-Session':session,Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(url+'/api/bot/engine-setup',{method:'POST'})).status,403);
    assert.equal((await fetch(url+'/api/bot/engine-setup',{method:'POST',headers:{'X-OpenBot-Session':session,Origin:'https://untrusted.example'}})).status,403);
    const setup=await fetch(url+'/api/bot/engine-setup',{headers:{'X-OpenBot-Session':session}});
    const state=await setup.json() as any;assert.equal(state.status,'idle');assert.ok(!JSON.stringify(state).includes('sessionApiKey'));
    const missing=await fetch(url+'/api/bot/engine-setup',{method:'POST',headers:{'X-OpenBot-Session':session}});assert.equal(missing.status,400);assert.match((await missing.json() as any).error,/请先保存/);
    const connection=await fetch(url+'/api/bot/connection',{headers:{'X-OpenBot-Session':session}});assert.equal((await connection.json() as any).configured,false);
    assert.equal((await fetch(url+'/api/bot/tasks',{headers:{'X-OpenBot-Session':session}})).status,503);
  }finally{await plane.close();if(previous===undefined)delete process.env.OPENBOT_HOME;else process.env.OPENBOT_HOME=previous;fs.rmSync(home,{recursive:true,force:true})}
});
