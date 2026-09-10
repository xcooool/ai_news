import { researchConfig } from './research-llm.mjs';
export function researchAvailability(env=process.env) {
 const missing=[];
 if(!env.TAVILY_API_KEY)missing.push('公开检索服务');
 if(!researchConfig(env).configured)missing.push('研究模型');
 return {ready:missing.length===0,message:missing.length?`请先配置${missing.join('和')}`:'自动检索公开资料，提取带来源的经营字段'};
}
export function selectResearchBatch(items,ids,{now=Date.now(),limit=5}={}) {
 const lookup=new Map(items.map(i=>[i.id,i]));const selected=[],skipped=[];
 for(const id of [...new Set(ids)]) {
  const i=lookup.get(id);if(!i||i.type!=='startup'){skipped.push({id,reason:'不是创业候选'});continue;}
  const r=i.research||{};
  if(['queued','running'].includes(r.status)){skipped.push({id,reason:'已在调研队列'});continue;}
  if(r.finishedAt&&now-Date.parse(r.finishedAt)<7*86400000){skipped.push({id,reason:'近 7 天已尝试调研'});continue;}
  if(selected.length>=limit)break;
  selected.push(i);
 }
 return {selected,skipped};
}
