import assert from 'node:assert/strict';import {it} from 'node:test';import {agentReplyText} from '../src/oh-events.js';
it('reads final finish tool answer without exposing ordinary observations or reasoning',()=>{
 assert.equal(agentReplyText([{kind:'ActionEvent',reasoning_content:'hidden'},{kind:'ObservationEvent',observation:{kind:'TerminalObservation',content:[{text:'internal output'}]}},{kind:'ObservationEvent',observation:{kind:'FinishObservation',content:[{type:'text',text:'AUTO_AGENT_OK'}]}}]),'AUTO_AGENT_OK');
});
it('after user handoff, the visible result contains the resumed answer rather than obsolete waiting messages',()=>{
 assert.equal(agentReplyText([{kind:'MessageEvent',source:'agent',llm_message:{content:[{text:'waiting for input'}]}},{kind:'MessageEvent',source:'user',llm_message:{content:[{text:'input completed'}]}},{kind:'ObservationEvent',observation:{kind:'FinishObservation',content:[{text:'final summary'}]}}]),'final summary');
});
