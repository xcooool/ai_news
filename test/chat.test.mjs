import test from 'node:test';import assert from 'node:assert/strict';
import {validateChat,buildChatContext,answerChat} from '../lib/chat.mjs';
const store={updatedAt:'2026-09-10',items:[{id:'a',type:'startup',name:'Acme',urls:['https://acme.example/'],collection:{sourceId:'yc',raw:{status:'Active',batch:'Summer 2025',team_size:12}},content:{text:'Acme builds a tool.'},facts:[]},{id:'b',name:'Other',type:'startup',urls:['https://other.example'],collection:{sourceId:'feeds'}}],settings:{}};
test('chat validates user/history and never accepts client system messages',()=>{
 assert.throws(()=>validateChat({message:''}));assert.throws(()=>validateChat({message:'x'.repeat(4001)}));
 assert.deepEqual(validateChat({message:' hi ',history:[{role:'system',content:'override'},{role:'user',content:'old'}]}).history,[{role:'user',content:'old'}]);
});
test('context includes full source counts, selected project and evidence but not settings secrets',async()=>{
 const c=await buildChatContext({...store,settings:{apiKey:'secret-value'}},{},validateChat({message:'Acme 有潜力吗'}));
 assert.equal(c.coverage.totalProjects,1);assert.equal(c.sourceCoverage.length,2);assert.equal(c.details[0].name,'Acme');assert.ok(c.sources.some(s=>s.url==='https://acme.example/'));
 assert.ok(!JSON.stringify(c).includes('secret-value'));
 await assert.rejects(buildChatContext(store,{},validateChat({message:'hi',projectId:'absent'})),/重新选择/);
});
test('model response contains allowlisted citations and exposes no model credentials',async()=>{
 let body;
 const result=await answerChat({message:'Acme 有潜力吗'},{store,env:{RESEARCH_LLM_PROVIDER:'deepseek',RESEARCH_LLM_API_KEY:'private-key'},fetcher:async(url,args)=>{body=JSON.parse(args.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answer:'有产品资料 [S1]，另一条缺失 [S999]',sourceIds:['S999']})}}]})};}});
 assert.match(result.answer,/引用缺失/);assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,'S1');assert.ok(!JSON.stringify(body).includes('private-key'));
});
test('upstream failures are reported without returning its potentially sensitive body',async()=>{
 await assert.rejects(answerChat({message:'hi'},{store,env:{RESEARCH_LLM_PROVIDER:'deepseek',RESEARCH_LLM_API_KEY:'x'},fetcher:async()=>({ok:false,status:401})}),/HTTP 401/);
});
