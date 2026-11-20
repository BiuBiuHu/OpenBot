import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { startBotRuntime } from '../src/bot/runtime.js';
import { defaultConfig } from '../src/config.js';
import { startMockOhServer } from './oh-mock.js';
import { WorkspaceFiles } from '../src/bot/files.js';
import { TaskStore } from '../src/bot/store.js';
const token = 'test-token-000000000000000000000000000000';
const sleep = (n:number) => new Promise(r=>setTimeout(r,n));

it('durable plugin API: authenticated, idempotent tasks survive runtime restart without another create', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-api-'));
  const mock=await startMockOhServer({finishAfterPolls:12, replyFor:()=> '远端结果：notes.md 已写好'});
  const oh={...defaultConfig().openhands,baseUrl:mock.baseUrl,sessionApiKey:mock.sessionKey,workspaceDir:path.join(root,'workspace')};
  const opts={dataDir:path.join(root,'state'),token,port:0,oh,pollMs:15};
  let runtime=await startBotRuntime(opts);
  async function api(route:string,method='GET',b?:unknown){const r=await fetch(runtime.baseUrl+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json() as any}}
  try{
    assert.equal((await fetch(runtime.baseUrl+'/v1/tasks')).status,401);
    const input={requestId:'once',threadId:'one',goal:'创建 notes.md',source:{kind:'anpai',referenceId:'test-event'}};
    const first=await api('/v1/tasks','POST',input); assert.equal(first.status,202);
    const id=first.body.task.id;
    assert.equal((await api('/v1/tasks','POST',input)).body.task.id,id);
    assert.equal((await api('/v1/tasks','POST',{...input,goal:'different'})).status,409);
    for(let i=0;i<100&&mock.creates.length===0;i++)await sleep(10);
    assert.equal(mock.creates.length,1);
    assert.deepEqual((mock.creates[0].body as any).confirmation_policy,{kind:'AlwaysConfirm'});
    const identity=(await api('/v1/identity')).body.instanceId;
    await runtime.close();
    runtime=await startBotRuntime(opts);
    assert.equal((await api('/v1/identity')).body.instanceId,identity);
    let task:any;
    for(let i=0;i<100;i++){task=(await api('/v1/tasks/'+id)).body.task;if(task.status==='succeeded')break;await sleep(20)}
    assert.equal(task.status,'succeeded');assert.match(task.result,/notes.md/);assert.equal(mock.creates.length,1);
    assert.equal(task.source.referenceId,'test-event');
    fs.writeFileSync(path.join(oh.workspaceDir,'notes.md'),'实际文件内容');
    const file=await api('/v1/file?path=notes.md');assert.equal(file.body.content,'实际文件内容');assert.equal(file.body.sha256.length,64);
    assert.equal((await api('/v1/file?path=../state/identity')).status,400);
    const list=await api('/v1/files');assert.equal(list.body.entries[0].name,'notes.md');
  }finally{await runtime.close();await mock.stop();fs.rmSync(root,{recursive:true,force:true})}
});

it('file previews deny symlink escape, directories and oversized files',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-files-'));
  try{const files=new WorkspaceFiles(path.join(root,'workspace'));fs.writeFileSync(path.join(root,'secret'),'private');fs.symlinkSync(path.join(root,'secret'),path.join(files.root,'link'));assert.throws(()=>files.read('link'),/leaves workspace/);assert.throws(()=>files.read(''),/regular file/);fs.writeFileSync(path.join(files.root,'large'),Buffer.alloc(1024*1024+1));assert.throws(()=>files.read('large'),/limit/);assert.equal(files.list().some(f=>f.name==='link'),false)}finally{fs.rmSync(root,{recursive:true,force:true})}
});

it('one runtime owns the data directory; restart retains idempotency',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-store-'));
  let store=new TaskStore(root);
  try{assert.throws(()=>new TaskStore(root),/already owns/);const task=store.create({requestId:'r',threadId:'t',goal:'hello'});store.close();store=new TaskStore(root);assert.equal(store.create({requestId:'r',threadId:'t',goal:'hello'}).id,task.id);assert.throws(()=>store.create({requestId:'',threadId:'t',goal:'a'}),/Invalid/)}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});

it('lost create response is reconciled without replaying a side effect; missing conversation is interrupted',async()=>{
  const {TaskEngine}=await import('../src/bot/engine.js');
  const {OpenHandsError}=await import('../src/oh-client.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-uncertain-'));const store=new TaskStore(root);let creates=0;
  const client:any={createConversation:async()=>{creates++;throw Error('connection lost')},getConversation:async()=>{throw new OpenHandsError('missing',404)}};
  const engine=new TaskEngine(store,client,defaultConfig().openhands);
  try{const t=store.create({requestId:'uncertain',threadId:'t',goal:'do once'});await engine.tick();assert.equal(store.get(t.id).status,'starting');await engine.tick();assert.equal(store.get(t.id).status,'interrupted');await engine.tick();assert.equal(creates,1)}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});

it('approval is revision-bound and a lost response cannot be granted twice',async()=>{
  const {TaskEngine}=await import('../src/bot/engine.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-approval-'));const store=new TaskStore(root);let approvals=0;
  const client:any={respondToConfirmation:async()=>{approvals++;throw Error('lost response')}};
  const engine=new TaskEngine(store,client,defaultConfig().openhands);
  try{let t=store.create({requestId:'approval',threadId:'t',goal:'write'});t=store.save({...t,status:'waiting_approval',pendingActions:[{id:'a',kind:'ActionEvent',action:{command:'echo hello'}}]});await assert.rejects(()=>engine.action(t.id,'approval',t.revision-1,true),/changed/);assert.equal(approvals,0);await assert.rejects(()=>engine.action(t.id,'approval',t.revision,true),/lost/);assert.equal(store.get(t.id).status,'paused');await assert.rejects(()=>engine.action(t.id,'approval',store.get(t.id).revision,true),/No matching/);store.save({...store.get(t.id),status:'waiting_approval'});await assert.rejects(()=>engine.action(t.id,'approval',store.get(t.id).revision,true),/already has/);assert.equal(approvals,1)}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});

it('approval transition race: observer keeps following waiting state until remote finishes',async()=>{
  const {TaskEngine}=await import('../src/bot/engine.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-race-'));const store=new TaskStore(root);let polls=0;
  const client:any={getConversation:async()=>++polls===1?{executionStatus:'waiting_for_confirmation',status:'awaiting_approval'}:{executionStatus:'finished',status:'succeeded'},searchEvents:async()=>({items:[{kind:'ActionEvent',id:'a',tool_name:'terminal',action:{command:'echo done'},reasoning_content:'private reasoning'}]})};
  const engine=new TaskEngine(store,client,defaultConfig().openhands);
  try{let t=store.create({requestId:'race',threadId:'t',goal:'write'});t=store.save({...t,status:'running'});await engine.tick();assert.equal(store.get(t.id).status,'waiting_approval');assert.doesNotMatch(JSON.stringify(store.get(t.id).pendingActions),/reasoning/);await engine.tick();assert.equal(store.get(t.id).status,'succeeded')}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});

it('configured browser is passed to remote tool initialization with visible CDP session',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-browser-'));const store=new TaskStore(root);let input:any;
  const client:any={createConversation:async(value:any)=>{input=value;return{id:value.conversationId}}};
  const config:any={workspaceDir:root,browser:{cdpUrl:'http://127.0.0.1:9322'}};
  const engine=new TaskEngine(store,client,config);
  try{store.create({requestId:'browser',threadId:'t',goal:'Use the remote browser'});await engine.tick();assert.deepEqual(input.tools.find((t:any)=>t.name==='browser_tool_set'),{name:'browser_tool_set',params:{cdp_url:'http://127.0.0.1:9322',headless:false}});assert.equal(input.confirmationPolicy,'AlwaysConfirm')}finally{store.close();fs.rmSync(root,{recursive:true,force:true})}
});
