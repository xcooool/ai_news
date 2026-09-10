import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCompanyFacts} from '../lib/company-facts.mjs';
import {companyMetricRows,matchesCompany} from '../public/analysis-metrics.js';
const cited=(value)=>({value,source:'https://acme.example/about',quote:'The company has published this information.'});
test('directory team and base usable; YC launch and batch never imply founding or product launch',()=>{
 const c=extractCompanyFacts([{urls:['https://yc.example/acme'],collection:{sourceId:'yc',raw:{team_size:30,all_locations:'New York, NY, USA',batch:'W23',launched_at:1723238839}}}]);
 assert.equal(c.teamSize,30);assert.equal(c.base,'New York, NY, USA');assert.equal(c.productStatus,'undisclosed');assert.equal(c.founded,'未披露');
 assert.equal(matchesCompany({type:'startup',company:c},{teamSize:'medium',base:c.base}),true);
 assert.equal(matchesCompany({type:'startup',company:c},{profitStatus:'profitable'}),false);
});
test('structured cited funding, release and profitability enter filters; ARR is not profit',()=>{
 const c=extractCompanyFacts([{content:{text:'Raised $10M, ARR $1M, cash-flow positive'}}],{funding:[{...cited(null),round:'Series A',amount:'$10M',date:'2025-10'}],companyFacts:{productStatus:cited('beta'),profitability:cited('unprofitable'),teamSize:cited(12),base:cited('上海')}});
 assert.equal(c.fundingStage,'a');assert.equal(c.productStatus,'beta');assert.equal(c.profitStatus,'unprofitable');
 assert.equal(matchesCompany({type:'startup',company:c},{fundingStage:'a',productStatus:'beta',teamSize:'medium'}),true);
 assert.equal(extractCompanyFacts([{content:{text:'ARR $1M, profitable clients'}}]).profitStatus,'undisclosed');
 assert.equal(companyMetricRows({type:'startup',company:c}).length,5);
});
test('uncited reports and summaries do not populate business filters',()=>{
 const c=extractCompanyFacts([],{summary:'Profitable company in New York',funding:[{round:'Seed',amount:'$4M'}],companyFacts:{base:{value:'NY'},profitability:{value:'profitable'}}});
 assert.equal(c.fundingStage,'undisclosed');assert.equal(c.base,null);assert.equal(c.profitStatus,'undisclosed');
 assert.equal(matchesCompany({type:'startup',company:c},{fundingStage:'undisclosed'}),true);
 assert.equal(matchesCompany({type:'open_source'},{fundingStage:'undisclosed'}),false);
});
test('existing reports follow exact original directory URLs after a website identity change',async()=>{
 const {createHash}=await import('node:crypto');const {buildAnalysis}=await import('../lib/analysis.mjs');
 const url='https://www.ycombinator.com/companies/acme';
 const id='entity_'+createHash('sha256').update(url).digest('hex').slice(0,20);
 const item=buildAnalysis({items:[{id:'a',name:'Acme',type:'startup',urls:[url],collection:{sourceId:'yc',raw:{website:'https://acme.example/',batch:'Winter 2025',status:'Active'}}}]},{research:{[id]:{funding:[{...cited(null),round:'Seed',amount:'$4M'}]}}}).items[0];
 assert.equal(item.researchReportId,id);assert.equal(item.company.fundingStage,'seed');
});
test('founding time never uses local collection sightings',async()=>{
 const {companyTimeRows}=await import('../public/analysis-metrics.js');
 assert.deepEqual(companyTimeRows({company:{founded:'2023'}}),[['成立时间','2023']]);
 assert.deepEqual(companyTimeRows({metrics:{batch:'Summer 2025'}}),[['成立时间','Summer 2025（YC 批次）']]);
 assert.deepEqual(companyTimeRows({company:{founded:'未披露'},mentions:[{kind:'publish',at:'2026-03-09T12:00:00Z'},{kind:'sighting',at:'2026-09-09T12:00:00Z'}]}),[['首次公开','2026-03-09']]);
 assert.deepEqual(companyTimeRows({mentions:[{kind:'sighting',at:'2026-09-09T12:00:00Z'}]}),[['成立时间','待核实']]);
 assert.deepEqual(companyTimeRows({}),[['成立时间','待核实']]);
});
