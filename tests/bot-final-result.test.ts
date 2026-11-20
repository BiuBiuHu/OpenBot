import assert from 'node:assert/strict';import {it} from 'node:test';import {agentReplyText} from '../src/oh-events.js';
it('reads final finish tool answer without exposing ordinary observations or reasoning',()=>{
 assert.equal(agentReplyText([{kind:'ActionEvent',reasoning_content:'hidden'},{kind:'ObservationEvent',observation:{kind:'TerminalObservation',content:[{text:'internal output'}]}},{kind:'ObservationEvent',observation:{kind:'FinishObservation',content:[{type:'text',text:'AUTO_AGENT_OK'}]}}]),'AUTO_AGENT_OK');
});
