import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesMetrics, quickAssessment } from '../public/analysis-metrics.js';
import { buildAnalysis } from '../lib/analysis.mjs';
const item={type:'startup',heat:20,metrics:{platforms:2},scoring:{potentialIndex:null,coverage:0,dimensions:[]}};
test('empty evidence produces actionable assessment without inventing a score',()=>{
 assert.equal(quickAssessment(item).label,'待调研');assert.equal(item.scoring.potentialIndex,null);
 assert.equal(matchesMetrics(item,{}),true);assert.equal(matchesMetrics(item,{potential:20}),false);
 assert.equal(matchesMetrics(item,{heat:10,platforms:2}),true);assert.equal(matchesMetrics(item,{heat:30,platforms:2}),false);
});
test('type-specific metrics and missing observations cannot match thresholds',()=>{
 assert.equal(matchesMetrics(item,{stars:10}),false);
 const oss={...item,type:'open_source',metrics:{stars:100,growthPerDay:null},scoring:{potentialIndex:35,coverage:.4,dimensions:[{id:'maintenance_delivery',dimensionScore:70}]}};
 assert.equal(matchesMetrics(oss,{stars:100,maintenance_delivery:60,coverage:40}),true);
 assert.equal(matchesMetrics(oss,{growthPerDay:1}),false);
 assert.equal(quickAssessment(oss).label,'继续观察');
});
test('analysis uses data source catalog labels including YC and Jike',()=>{
 const result=buildAnalysis({items:[]});
 assert.equal(result.sources.find(s=>s.id==='jike').name,'即刻');
 assert.equal(result.sources.find(s=>s.id==='yc').name,'YC AI 公司目录');
});
