// Probe a disposable page in the same visible browser used by the agent.
const version = await (await fetch('http://127.0.0.1:19322/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let sequence=0; const pending=new Map();
ws.addEventListener('message',({data})=>{const message=JSON.parse(data);if(message.id){const handler=pending.get(message.id);if(handler){pending.delete(message.id);clearTimeout(handler.timer);message.error?handler.reject(new Error(message.error.message)):handler.resolve(message.result);}}});
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser self-test timed out'));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
let targetId;
try {
  ({targetId}=await call('Target.createTarget',{url:'about:blank'}));
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Runtime.evaluate',{expression:`document.body.innerHTML='<input id="probe"><button id="go">Test</button><output id="result"></output>';document.querySelector('#go').onclick=()=>document.querySelector('#result').textContent=document.querySelector('#probe').value;document.querySelector('#probe').value='OPENBOT_BROWSER_OK';document.querySelector('#go').click();`},sessionId);
  const result=await call('Runtime.evaluate',{expression:"document.querySelector('#result').textContent",returnByValue:true},sessionId);
  if(result.result?.value!=='OPENBOT_BROWSER_OK')throw new Error('Browser input/click verification failed');
  console.log('OPENBOT_BROWSER_OK');
} finally {
  if(targetId)await call('Target.closeTarget',{targetId}).catch(()=>{});
  ws.close();
}
