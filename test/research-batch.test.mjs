import test from 'node:test';import assert from 'node:assert/strict';
import {selectResearchBatch,researchAvailability} from '../lib/research-batch.mjs';
import {companyMetricRows,hasBusinessFacts,quickAssessment} from '../public/analysis-metrics.js';
test('batch is bounded, deduplicated and skips fresh/running/non-startup entries',()=>{
 const now=Date.parse('2026-09-10');
 const items=Array.from({length:10},(_,i)=>({id:String(i),type:'startup',research:{status:'not_started'}}));
 items[0].research={status:'running'};items[1].research={status:'partial',finishedAt:'2026-09-09'};items[2].type='lead';
 const b=selectResearchBatch(items,['missing','0','1','2','3','3','4','5','6','7','8','9'],{now});
 assert.deepEqual(b.selected.map(i=>i.id),['3','4','5','6','7']);assert.equal(b.skipped.length,4);
 assert.equal(selectResearchBatch(items,['3'],{now,limit:0}).selected.length,0);
});
test('missing and stale placeholder fields are hidden, real negative facts stay visible',()=>{
 const empty={type:'startup',company:{founded:'未知 · 首次公开 2026-03-09',funding:'未知',profitStatus:'undisclosed'},research:{status:'not_started'}};
 assert.deepEqual(companyMetricRows(empty),[]);assert.equal(quickAssessment(empty).label,'待调研');
 assert.equal(hasBusinessFacts(empty),false);
 const known={...empty,company:{profitStatus:'unprofitable',teamSize:0},research:{status:'partial'}};
 assert.deepEqual(companyMetricRows(known),[['盈利情况','已披露未盈利'],['团队人数','0 人']]);assert.equal(hasBusinessFacts(known),true);assert.equal(quickAssessment(known).label,'调研部分完成');
});
test('batch configuration check returns only safe capability information',()=>{
 assert.equal(researchAvailability({}).ready,false);
 assert.equal(researchAvailability({TAVILY_API_KEY:'test',RESEARCH_LLM_PROVIDER:'deepseek',RESEARCH_LLM_API_KEY:'test'}).ready,true);
 assert.ok(!JSON.stringify(researchAvailability({TAVILY_API_KEY:'secret'})).includes('secret'));
});
