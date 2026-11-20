import {it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PrivateBrowsers,PRIVATE_BROWSER_TOOLS} from '../src/bot/private-browser.js';import {TaskStore} from '../src/bot/store.js';import {BrowserCDP} from '../src/bot/browser-cdp.js';import {TaskEngine} from '../src/bot/engine.js';import {defaultConfig} from '../src/config.js';
it('private profile exposes bounded tools and a structured takeover prevents later operations',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'private-browser-'));const store=new TaskStore(root);let clicks=0;
 const browser={beginManualCapture:()=>{},endManualCapture:async()=>{},close:async()=>{},click:async()=>{clicks++},redact:(v:any)=>v} as unknown as BrowserCDP;
 const broker=new PrivateBrowsers(store,'http://127.0.0.1:9322',()=> 'http://127.0.0.1:3850',()=>browser);
 try{const t=store.create({requestId:'r',threadId:'t',goal:'login',executionProfile:'private_browser'});store.save({...t,status:'running'});const config=broker.prepare(t);assert.ok(config.private_browser.url.includes('/mcp/'));assert.ok(!PRIVATE_BROWSER_TOOLS.some(t=>/script|evaluate|cookie|terminal|screenshot/.test(t.name)));
 await broker.call(t.id,'request_user_takeover',{reason:'请扫码'});assert.equal(store.get(t.id).status,'waiting_user');await broker.call(t.id,'page_click',{elementId:'1'});assert.equal(clicks,0);
 const id=store.get(t.id).interaction!.id;await broker.completeTakeover(t.id,id);assert.equal(store.get(t.id).interaction?.state,'completed');
 }finally{await broker.close();store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('observer does not overwrite a concurrently created human interaction',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'private-race-'));const store=new TaskStore(root);
 try{const t=store.create({requestId:'r',threadId:'t',goal:'login'});store.save({...t,status:'running'});const client:any={getConversation:async()=>{store.save({...store.get(t.id),status:'waiting_user',interaction:{id:'request',kind:'takeover',state:'waiting',reason:'help',createdAt:''}});return{executionStatus:'finished',status:'succeeded'}},searchEvents:async()=>({items:[]})};await new TaskEngine(store,client,defaultConfig().openhands).tick();assert.equal(store.get(t.id).status,'waiting_user');assert.equal(store.get(t.id).interaction?.id,'request');}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('ordinary computer tasks can request takeover but cannot use the private browser capability',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'human-capability-'));const store=new TaskStore(root);const broker=new PrivateBrowsers(store,'',()=> 'http://127.0.0.1:3850');
 try{const t=store.create({requestId:'r',threadId:'t',goal:'operate'});store.save({...t,status:'running'});broker.prepare(t);assert.deepEqual(broker.toolsFor(t.id).map(t=>t.name),['request_user_takeover']);await assert.rejects(()=>broker.call(t.id,'page_observe',{}),/unavailable/);await broker.call(t.id,'request_user_takeover',{reason:'需要协助'});assert.equal(store.get(t.id).status,'waiting_user');}finally{await broker.close();store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('protected browsing does not expose loopback CDP or private network pages by default',async()=>{
 const {isPublicBrowserAddress}=await import('../src/bot/browser-cdp.js');for(const host of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(isPublicBrowserAddress(host),false,host);assert.equal(isPublicBrowserAddress('8.8.8.8'),true);const browser=new BrowserCDP('http://127.0.0.1:1',[]);await assert.rejects(()=>browser.navigate('http://127.0.0.1:9322/json'),/Private network/);
});
