// Shared by the cards and filters: missing observations never become zero scores.
export const metricDefinitions = [
  ['potential','潜力指数','open_source', [20,40,60,80]],
  ['coverage','证据覆盖 %','open_source',[20,40,60,80]],
  ['heat','传播热度','all',[10,30,60]],
  ['platforms','来源数量','all',[2,3,5]],
  ['starsPerDay','累计 stars / 天','open_source',[1,5,10,50]],
  ['growthPerDay','实测日增 stars（≥7天）','open_source',[1,5,10,50]],
  ['stars','Stars','open_source',[10,100,1000]],
  ['forks','Forks','open_source',[5,20,100]],
  ['real_adoption','真实采用 / 下游集成','open_source',[20,40,60]],
  ['maintenance_delivery','维护与交付','open_source',[20,40,60]],
  ['growth_persistence','增长持续性','open_source',[20,40,60]],
  ['ecosystem_expansion','生态扩展','open_source',[20,40,60]],

];
export function metricValue(item,key) {
  if(key==='potential')return item.scoring.potentialIndex;
  if(key==='coverage')return item.scoring.coverage*100;
  if(key==='heat')return item.heat;
  if(Object.hasOwn(item.metrics,key))return item.metrics[key];
  return item.scoring.dimensions.find(d=>d.id===key)?.dimensionScore ?? null;
}
export function companyMetricRows(item, {includeMissing=false}={}) {
  if (item.type !== 'startup') return null;
  const company = item.company || {};
  return [
    ['融资情况', company.funding || '未披露'],
    ['产品发布', companyLabels.productStatus[company.productStatus] || '未披露'],
    ['盈利情况', companyLabels.profitStatus[company.profitStatus] || '未披露'],
    ['团队人数', company.teamSize == null ? '未披露' : `${company.teamSize} 人`],
    ['团队 Base', company.base || '未披露'],
    ['成立时间', company.founded || '未披露'],
  ].filter(([,v])=>includeMissing||!isMissingCompanyValue(v));
}
export function matchesMetrics(item,filters) {
  return Object.entries(filters).every(([key,min])=>{
    if(!min)return true;
    const def=metricDefinitions.find(d=>d[0]===key);
    const value=metricValue(item,key);
    return (!def||def[2]==='all'||def[2]===item.type)&&Number.isFinite(value)&&value>=Number(min);
  });
}
export function quickAssessment(item) {
  if(item.type==='startup'){const count=companyMetricRows(item).length;return {label:researchLabel(item),reason:count?`已收集 ${count} 项资料`:''};}
  if(item.type==='lead')return {label:'待识别',reason:'先确认项目官网或仓库，再评估项目。'};
  const p=item.scoring.potentialIndex;
  if(p==null)return {label:'待验证',reason:item.type==='open_source'?'先验证可运行 Demo、近期维护与真实使用案例。':'当前材料不足以判断潜力；优先核验客户案例、付费与重复使用。'};
  const label=p>=60?'优先关注':p>=30?'继续观察':'信号偏弱';
  const strongest=item.scoring.dimensions.filter(d=>d.dimensionScore!=null).sort((a,b)=>b.dimensionScore-a.dimensionScore)[0];
  return {label,reason:`${strongest?`当前最强信号：${strongest.label}。`:''}证据覆盖 ${Math.round(item.scoring.coverage*100)}%，${item.type==='open_source'?'下一步核验下游使用与持续增长。':'下一步核验客户付费与留存。'}`};
}

export const companyLabels = {
 fundingStage:{undisclosed:'暂无资料',disclosed:'已披露（其他/轮次未明）',pre_seed:'Pre-seed',seed:'种子轮',angel:'天使轮',a:'A 轮',b:'B 轮',c_plus:'C 轮及以后'},
 productStatus:{undisclosed:'暂无资料',announced:'已宣布 / 待发布',beta:'内测 / 公测',launched:'已发布',closed:'已停止服务'},
 profitStatus:{undisclosed:'暂无资料',profitable:'已披露盈利',unprofitable:'已披露未盈利',break_even:'已披露盈亏平衡'},
 teamSize:{undisclosed:'暂无资料',small:'1–10 人',medium:'11–50 人',large:'51–200 人',xl:'201 人及以上'},
};
export function matchesCompany(item, filters) {
 if(!Object.values(filters).some(v=>v && v!=='all'))return true;
 if(item.type!=='startup')return false;
 const c=item.company||{};
 return Object.entries(filters).every(([key,value])=>{
  if(!value||value==='all')return true;
  if(key==='teamSize')return value==='undisclosed'?c.teamSize==null:value==='small'?c.teamSize>=1&&c.teamSize<=10:value==='medium'?c.teamSize>=11&&c.teamSize<=50:value==='large'?c.teamSize>=51&&c.teamSize<=200:c.teamSize>=201;
  if(key==='base')return value==='undisclosed'?!c.base:c.base===value;
  if(value==='known')return Boolean(c[key]&&c[key]!=='undisclosed');
  return (c[key]||'undisclosed')===value;
 });
}

export function isMissingCompanyValue(value){return value==null||value===''||/^(未知|未披露|待补|暂无)/.test(String(value));}
export function hasBusinessFacts(item){return item.type==='startup'&&Boolean((item.company?.fundingStage&&item.company.fundingStage!=='undisclosed')||(item.company?.productStatus&&item.company.productStatus!=='undisclosed')||(item.company?.profitStatus&&item.company.profitStatus!=='undisclosed'));}
export function researchLabel(item){return ({not_started:'待调研',queued:'调研排队中',running:'调研中',done:'已调研',partial:'调研部分完成',error:'调研失败，可重试',needs_config:'调研需配置',interrupted:'调研中断，可重试'})[item.research?.status||'not_started']||'待调研';}

// Creation time is a fixed field; do not hide it with optional business metrics.
export function companyTimeRows(item) {
 const founded=item.company?.founded;
 if(!isMissingCompanyValue(founded))return [['创建时间',founded]];
 const earliest=kind=>(item.mentions||[]).filter(m=>m.kind===kind&&Number.isFinite(Date.parse(m.at))).map(m=>m.at).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]?.slice(0,10);
 const fallback=earliest('publish')||earliest('sighting')||item.company?.firstSeen||'待核实';
 return [['创建时间',fallback]];
}
