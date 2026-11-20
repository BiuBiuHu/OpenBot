import assert from 'node:assert/strict';
import http from 'node:http';
import {it} from 'node:test';
import {defaultConfig} from '../src/config.js';
import {OpenHandsClient} from '../src/oh-client.js';
it('keeps SSH destination distinct from local gateway port',()=>{
 const c=defaultConfig();
 const gateway=defaultConfig({openhands:{...c.openhands,baseUrl:'http://127.0.0.1:18010',remotePort:8010}});
 assert.equal(gateway.openhands.remotePort,8010);
 assert.equal(gateway.openhands.baseUrl,'http://127.0.0.1:18010');
});
it('recognizes an A2A gateway without /health but rejects a missing card',async()=>{
 let card=true;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(card&&req.url==='/.well-known/agent-card.json')res.end(JSON.stringify({name:'gateway',supportedInterfaces:[{url:'http://localhost',protocolBinding:'HTTP+JSON'}],skills:[{id:'run_command'}]}));else{res.statusCode=404;res.end('{"error":"not found"}')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as import('node:net').AddressInfo;const c=defaultConfig();c.openhands.baseUrl=`http://127.0.0.1:${address.port}`;const client=OpenHandsClient.fromConfig(c);assert.equal((await client.health()).ok,true);card=false;assert.equal((await client.health()).ok,false)}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
