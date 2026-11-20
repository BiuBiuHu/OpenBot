import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {it} from 'node:test';
import {TaskEngine,canAutoObserve} from '../src/bot/engine.js';import {TaskStore} from '../src/bot/store.js';import {defaultConfig} from '../src/config.js';import type {BotTask} from '../src/bot/contracts.js';
const read={id:'read-1',tool:'browser_get_state',action:{kind:'BrowserGetStateAction',include_screenshot:false}};
function task(pendingActions:any[]=[read]):BotTask{return {id:'t',requestId:'r',threadId:'th',goal:'observe',status:'waiting_approval',conversationId:'c',revision:1,createdAt:'',updatedAt:'',observationPolicy:'auto_browser_reads',pendingActions}}
it('only explicitly selected read capabilities qualify; mixed and malformed actions fail closed',()=>{
 assert.equal(canAutoObserve(task()),true);
 assert.equal(canAutoObserve({...task(),observationPolicy:undefined}),false);
 for(const tool of ['browser_click','browser_type','browser_navigate','browser_scroll','browser_get_storage','browser_set_storage','terminal','unknown'])assert.equal(canAutoObserve(task([{...read,tool}])),false,tool);
 assert.equal(canAutoObserve(task([read,{id:'write',tool:'browser_click',action:{kind:'BrowserClickAction',index:1}}])),false);
 assert.equal(canAutoObserve(task([{...read,action:{kind:'BrowserGetStateAction',script:'fetch(...)'}}])),false);
 assert.equal(canAutoObserve(task([{...read,action:{kind:'BrowserGetStateAction',include_screenshot:'yes'}}])),false);
 assert.equal(canAutoObserve({...task(),decidedActionIds:['read-1']}),false);
 assert.equal(canAutoObserve({...task(),error:'unknown outcome'}),false);
});
it('selected read decision is durable and not replayed after restart or repeated waiting observation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-auto-'));let store=new TaskStore(root);let approvals=0;let loseResponse=false;
 const client:any={getConversation:async()=>({executionStatus:'waiting_for_confirmation',status:'awaiting_approval'}),searchEvents:async()=>({items:[{kind:'ActionEvent',id:'read-1',tool_name:read.tool,action:read.action}]}),respondToConfirmation:async()=>{approvals++;if(loseResponse)throw Error('response lost')}};
 try{
  let t=store.create({requestId:'r',threadId:'th',goal:'observe',observationPolicy:'auto_browser_reads'});store.save({...t,status:'running'});
  let engine=new TaskEngine(store,client,defaultConfig().openhands);await engine.tick();assert.equal(approvals,1);assert.deepEqual(store.get(t.id).autoApprovedActionIds,['read-1']);
  store.close();store=new TaskStore(root);engine=new TaskEngine(store,client,defaultConfig().openhands);await engine.tick();assert.equal(approvals,1);
  // A lost delivery must stay paused and must not be resent on a fresh runtime.
  t=store.get(t.id);store.save({...t,decidedActionIds:[],autoApprovedActionIds:[],status:'running'});loseResponse=true;
  await assert.rejects(()=>engine.tick(),/response lost/);assert.equal(store.get(t.id).status,'paused');assert.equal(approvals,2);
  store.close();store=new TaskStore(root);engine=new TaskEngine(store,client,defaultConfig().openhands);await engine.tick();assert.equal(approvals,2);assert.match(store.get(t.id).error!,/pending/);
 }finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('request id cannot silently widen a prior approval policy',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-policy-id-'));const store=new TaskStore(root);
 try{const input={requestId:'r',threadId:'t',goal:'read',observationPolicy:'confirm_all' as const};const t=store.create(input);assert.equal(t.observationPolicy,'confirm_all');assert.equal(store.create({...input,observationPolicy:'confirm_all'}).id,t.id);assert.throws(()=>store.create({...input,observationPolicy:'auto_browser_reads'}),/different task/);assert.throws(()=>store.create({...input,requestId:'bad',observationPolicy:'everything' as any}),/Invalid/)}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('only a queued task can be cancelled, without calling the execution service',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-cancel-'));const store=new TaskStore(root);
 try{const t=store.create({requestId:'cancel',threadId:'t',goal:'read'});const engine=new TaskEngine(store,{} as any,defaultConfig().openhands);assert.equal((await engine.action(t.id,'cancel',t.revision)).status,'interrupted');const running=store.save({...t,status:'running'});await assert.rejects(()=>engine.action(t.id,'cancel',running.revision));}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('autonomous tasks default to automatic tool decisions; old policies stay explicit',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-auto-default-'));const store=new TaskStore(root);
 try{assert.equal(store.create({requestId:'r',threadId:'t',goal:'act'}).observationPolicy,'autonomous');const t={...task([{id:'write',tool:'terminal',action:{command:'echo example',kind:'TerminalAction'}}]),observationPolicy:'autonomous' as const};assert.equal(canAutoObserve(t),true);assert.equal(canAutoObserve({...t,error:'delivery unknown'}),false);assert.equal(canAutoObserve({...t,decidedActionIds:['write']}),false);}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('queue order survives filesystem reload even when UUID order differs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-order-'));let store=new TaskStore(root);let creates=0;
 try{const base=task();store.save({...base,id:'ffffffff-ffff',requestId:'old',status:'paused',createdAt:'2026-01-01'});store.save({...base,id:'aaaaaaaa-aaaa',requestId:'new',status:'queued',createdAt:'2026-01-02'});store.close();store=new TaskStore(root);const engine=new TaskEngine(store,{createConversation:async()=>{creates++;return{id:'new'}}} as any,defaultConfig().openhands);await engine.tick();assert.equal(creates,0);}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
it('refresh cannot revive a cancelled task and block the queue again',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-cancel-refresh-'));const store=new TaskStore(root);
 try{let pauses=0;const t=store.create({requestId:'cancel-waiting',threadId:'t',goal:'read'});const waiting=store.save({...t,status:'waiting_approval'});const engine=new TaskEngine(store,{pauseConversation:async()=>{pauses++}} as any,defaultConfig().openhands);const cancelled=await engine.action(t.id,'cancel',waiting.revision);assert.equal(pauses,1);assert.equal((await engine.action(t.id,'refresh',cancelled.revision)).status,'interrupted');}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
