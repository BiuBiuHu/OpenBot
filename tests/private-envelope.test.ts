import {it} from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {PrivateEnvelopes,envelopeAAD,type EnvelopeChallenge} from '../src/bot/private-envelope.js';
const binding={taskId:'t',requestId:'r',origin:'https://example.test'};
async function seal(c:EnvelopeChallenge,values:Record<string,string>){
 const crypto=webcrypto;const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);const pub=await crypto.subtle.importKey('jwk',c.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(envelopeAAD(c))},key,new TextEncoder().encode(JSON.stringify(values)));const wrappedKey=await crypto.subtle.encrypt('RSA-OAEP',pub,await crypto.subtle.exportKey('raw',key));return{challengeId:c.id,wrappedKey:Buffer.from(wrappedKey).toString('base64'),iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};
}
it('browser-compatible envelope delivers only to the bound callback once, without plaintext in wire payload',async()=>{
 const broker=new PrivateEnvelopes();const c=broker.issue(binding);const value='random-canary-secret-7462';const envelope=await seal(c,{account:'canary-user',password:value});assert.ok(!JSON.stringify(envelope).includes(value));let called=0;
 assert.equal(await broker.consume(binding,envelope,['account','password'],async values=>{called++;assert.equal(values.password,value);return 'filled';}),'filled');await assert.rejects(()=>broker.consume(binding,envelope,['account','password'],async()=>{called++;}),/consumed/);assert.equal(called,1);
});
it('tampering, expiry, target change and unknown delivery cannot replay input',async()=>{
 let now=1000;const broker=new PrivateEnvelopes(()=>now);const c=broker.issue(binding);const env=await seal(c,{password:'canary'});const apply=async()=>assert.fail('must not fill');
 await assert.rejects(()=>broker.consume({...binding,origin:'https://evil.test'},env,['password'],apply),/target changed/);
 const bytes=Buffer.from(env.ciphertext,'base64');bytes[0]^=1;await assert.rejects(()=>broker.consume(binding,{...env,ciphertext:bytes.toString('base64')},['password'],apply),/Invalid/);
 await assert.rejects(()=>broker.consume(binding,env,['password'],async()=>{throw Error('browser response lost');}),/response lost/);await assert.rejects(()=>broker.consume(binding,env,['password'],apply),/consumed/);
 const expired=await seal(broker.issue(binding),{password:'canary'});now+=600001;await assert.rejects(()=>broker.consume(binding,expired,['password'],apply),/expired/);
});
it('public account is readable on the wire, password remains encrypted, and account substitution is rejected',async()=>{
 const {sealPrivateInput}=await import('../src/ui/private-input.js');
 const broker=new PrivateEnvelopes();const challenge=broker.issue(binding);
 const envelope=await sealPrivateInput(challenge,{password:'TEST-PASSWORD-NEVER-PLAIN'},{account:'test-account'});
 assert.equal(envelope.publicValues.account,'test-account');assert.ok(!JSON.stringify(envelope).includes('TEST-PASSWORD-NEVER-PLAIN'));
 await assert.rejects(()=>broker.consume(binding,{...envelope,publicValues:{account:'another-account'}},['password'],async()=>assert.fail('tampered account must not fill'),['account']),/Invalid/);
 await assert.rejects(()=>broker.consume(binding,{...envelope,publicValues:{password:'unprotected'}},['password'],async()=>assert.fail('password cannot be public'),['account']),/Invalid/);
 const result=await broker.consume(binding,envelope,['password'],async values=>({account:values.account,password:values.password}),['account']);assert.deepEqual(result,{account:'test-account',password:'TEST-PASSWORD-NEVER-PLAIN'});
});
