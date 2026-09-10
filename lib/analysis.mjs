import { createHash } from 'node:crypto';
import { sourceCatalog } from './sources.mjs';
import { scoreItem } from './scoring.mjs';
import { summarizeItem } from './plain-text.mjs';
import { isIncumbentItem, isStaleStartup } from './discovery.mjs';
import { companyWebsite, extractCompanyFacts } from './company-facts.mjs';

const idFor = key => 'entity_' + createHash('sha256').update(key).digest('hex').slice(0, 20);
export function repoKey(value) {
  try { const u = new URL(value); if (u.hostname.toLowerCase() !== 'github.com') return null;
    const p = u.pathname.split('/').filter(Boolean); if (p.length < 2 || ['topics','orgs','users','settings','collections','search','marketplace','features'].includes(p[0])) return null;
    if (!p.slice(0,2).every(x => /^[\w.-]+$/.test(x))) return null;
    return p.slice(0,2).join('/').replace(/\.git$/,'').toLowerCase();
  } catch { return null; }
}
const unique = a => [...new Set(a)];
const date = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const log = (n, max) => Math.min(100, Math.log1p(Math.max(0,n))/Math.log1p(max)*100);
const isShowHn = item => item.collection?.sourceId === 'hackernews' && [item.name, item.collection?.originalTitle, ...(item.aliases || [])].some(t => /^show hn:/i.test(String(t || '')));
function identities(item) {
  if(item.analysisEntity) {const a=item.analysisEntity;const repo=repoKey(a.url);return [{key:repo?'github:'+repo:a.url,name:a.name,type:repo?'open_source':a.type,url:a.url,direct:true}];}
  if(isShowHn(item)) {
    const url=companyWebsite(item) || (item.urls||[]).find(u=>{try{return !['news.ycombinator.com','github.com'].includes(new URL(u).hostname);}catch{return false;}});
    if(url && !repoKey(url)) return [{key:url,name:item.name.replace(/^show hn:\s*/i,''),type:'startup',url,direct:true}];
  }
  const direct = (item.urls || []).map(repoKey).filter(Boolean);
  const text = `${item.content?.text || ''} ${item.tagline || ''}`;
  const linked = [...(item.collection?.outboundLinks || []), ...(text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) || [])].map(v => repoKey(typeof v === 'string' ? v : v.url)).filter(Boolean);
  const repos = unique([...direct,...linked]);
  if (repos.length) return repos.map(key => ({key:'github:'+key, name:key,type:'open_source',url:'https://github.com/'+key,direct:direct.includes(key)}));
  if (item.type === 'open_source' && ['huggingface','hf_spaces'].includes(item.collection?.sourceId)) return [{key:item.urls?.[0] || item.id,name:item.name,type:'open_source',url:item.urls?.[0],direct:true}];
  if (item.collection?.entityVerified === true || ['yc','producthunt'].includes(item.collection?.sourceId) || item.collection?.mode === 'manual_import') {
    const url = companyWebsite(item) || item.urls?.[0] || item.id;
    return [{key:url,name:item.name,type:item.type,url,direct:true}];
  }
  return [{key:'lead:'+item.id,name:item.name,type:'lead',url:item.urls?.[0],direct:true}];
}
export function mentionEvents(item = {}) {
  const base = {
    id: item.id,
    title: item.name,
    url: item.urls?.[0],
    source: item.collection?.sourceId,
    author: item.collection?.author || null,
  };
  const events = [];
  const published = date(item.collection?.publishedAt || item.facts?.find(f => f.kind === 'published_at')?.value);
  const created = date(item.facts?.find(f => f.kind === 'created_at')?.value);
  const directRepo = ['github', 'github_kol', 'huggingface', 'hf_spaces'].includes(item.collection?.sourceId);
  if (published && !directRepo) events.push({ ...base, at: published, kind: 'publish' });
  if (created) events.push({ ...base, at: created, kind: 'repo_created', title: `${item.name} 仓库创建` });
  if (item.discoveredAt) events.push({ ...base, at: date(item.discoveredAt), kind: 'sighting', title: `${item.name} 入库观测` });
  if (item.lastSeenAt && item.lastSeenAt !== item.discoveredAt) {
    events.push({ ...base, at: date(item.lastSeenAt), kind: 'resighting', title: `${item.name} 再次观测` });
  }
  return events.filter(e => e.at);
}

export function hourlyHeat(mentions, stars = [], now = new Date(), { starsPerDay = null } = {}) {
  const hour = 3600000, end = +now;
  const recent = mentions.filter(m => m.at && Date.parse(m.at) <= end && Date.parse(m.at) > end - 24 * hour);
  const windows = Object.fromEntries([1,6,24].map(h => {
    const current = recent.filter(m => Date.parse(m.at) > end - h * hour);
    const previous = mentions.filter(m => m.at && Date.parse(m.at) > end - 2*h*hour && Date.parse(m.at) <= end - h*hour);
    return [h, {mentions:current.length, previousMentions:previous.length, change:current.length-previous.length, platforms:unique(current.map(m=>m.source).filter(Boolean)).length}];
  }));
  const decayed = recent.reduce((sum,m)=>sum+Math.pow(0.5,(end-Date.parse(m.at))/(6*hour)),0);
  let score = recent.length ? Math.round(.75*log(decayed,30)+.25*log(windows[24].platforms,8)) : 0;
  const buckets = new Map();
  for(const m of recent) {const at=new Date(Math.floor(Date.parse(m.at)/hour)*hour).toISOString();buckets.set(at,(buckets.get(at)||0)+1);}
  const samples=stars.filter(p=>Date.parse(p.at)>end-24*hour && Date.parse(p.at)<=end);
  const span=samples.length>1?(Date.parse(samples.at(-1).at)-Date.parse(samples[0].at))/hour:0;
  const starGrowthPerHour = span>=.25?(samples.at(-1).value-samples[0].value)/span:null;
  let tractionSource = null;
  if (score === 0 && starGrowthPerHour != null && starGrowthPerHour > 0) {
    score = Math.round(Math.min(100, log(Math.max(0, starGrowthPerHour), 30)));
    tractionSource = 'star_snapshots_24h';
  } else if (score === 0 && Number.isFinite(starsPerDay) && starsPerDay > 0) {
    score = Math.round(Math.min(100, 0.75 * log(starsPerDay, 50) + 0.25 * log(starsPerDay * 7, 200)));
    tractionSource = 'stars_per_day';
  }
  return {score,windows,asOf:now.toISOString(),halfLifeHours:6,starGrowthPerHour,starObservationHours:span,tractionSource,series:[...buckets].sort().map(([at,value])=>({at,value})),coverage:tractionSource==='stars_per_day'?'暂无近24h传播提及，热度来自 stars/天  traction 估算；多源采集后会更新':tractionSource==='star_snapshots_24h'?'热度来自近24h star 快照增速':'已入库样本，零条不代表全网零条；当前小时未结束'};
}

export function momentumScore(item = {}) {
  const potential = item.scoring?.potentialIndex;
  const heat = item.heat ?? 0;
  if (item.type !== 'open_source') {
    if (potential == null) return heat || null;
    return Math.round(potential * 0.8 + heat * 0.2);
  }
  const traction = Number.isFinite(item.metrics?.starsPerDay)
    ? Math.min(100, log(Math.max(0.01, item.metrics.starsPerDay), 50))
    : null;
  if (potential == null && traction == null) return heat;
  const p = potential ?? 0;
  const t = traction ?? 0;
  return Math.round(p * 0.45 + t * 0.35 + heat * 0.2);
}
export function buildAnalysis(store, {now = new Date(), excludeIncumbents = true, research = {}} = {}) {
  const raw = store.items.filter(i => !i.sampleMode && !(excludeIncumbents && isIncumbentItem(i)) && !isStaleStartup(i, now));
  const groups = new Map();
  for (const item of raw) for (const identity of identities(item)) {
    let g = groups.get(identity.key);
    if (!g) groups.set(identity.key, g = {...identity,id:idFor(identity.key),records:[],directRecords:[]});
    g.records.push(item); if(identity.direct) g.directRecords.push(item);
  }
  const items = [...groups.values()].map(g => {
    const facts = g.directRecords.flatMap(i => i.facts || []).sort((a,b) => Date.parse(b.collectedAt || 0)-Date.parse(a.collectedAt || 0));
    const latest = kind => facts.find(f => f.kind === kind)?.value;
    const evidence = [...new Map(g.directRecords.flatMap(i => i.evidence || []).map(e => [e.id,e])).values()];
    const sourceIds = unique(g.records.map(i => i.collection?.sourceId).filter(Boolean));
    const sourceId = g.directRecords[0]?.collection?.sourceId || sourceIds[0];
    if (g.type === 'open_source') {
    for (const [kind,dimension,confidence,max] of [['stars','real_adoption',.25,50000],['forks','ecosystem_expansion',.35,8000],['downloads','real_adoption',.55,500000]]) {
      if (Number.isFinite(latest(kind)) && !evidence.some(e => e.metric?.name===kind)) evidence.push({id:g.id+kind,sourceId,dimensionId:dimension,credibility:'fact',confidence,metric:{name:kind,value:latest(kind),method:'log',excellent:max},note:kind==='stars'?'关注线索，不代表真实用户。':'采用线索，需排除自动化与镜像。',url:g.url});
    }
    }
    const series = kind => [...new Map(facts.filter(f => f.kind===kind && Number.isFinite(f.value) && date(f.collectedAt)).map(f => [date(f.collectedAt),{at:date(f.collectedAt),value:f.value}])).values()].sort((a,b)=>a.at.localeCompare(b.at));
    const stars = g.type === 'open_source' ? series('stars') : [];
    const spanDays = stars.length>1 ? (Date.parse(stars.at(-1).at)-Date.parse(stars[0].at))/86400000 : 0;
    const growth = spanDays >= 7 ? (stars.at(-1).value-stars[0].value)/spanDays : null;
    if (g.type === 'open_source' && growth !== null && !evidence.some(e=>e.dimensionId==='growth_persistence')) evidence.push({id:g.id+'growth',sourceId,dimensionId:'growth_persistence',credibility:'fact',confidence:.6,metric:{name:'stars_per_day',value:growth,method:'log',excellent:1000},note:'至少七天实测快照的平均增量；不是用户增长。',url:g.url});
    const pushed = latest('pushed_at');
    if(g.type === 'open_source' && pushed && !evidence.some(e=>e.metric?.name==='pushed_at')) evidence.push({id:g.id+'push',sourceId,dimensionId:'maintenance_delivery',credibility:'fact',confidence:.7,metric:{name:'pushed_at',value:pushed,method:'recency'},url:g.url});
    const scoring = scoreItem({type:g.type,evidence}, {selectedSourceIds:unique([...sourceIds,...evidence.map(e=>e.sourceId)]),weights:store.settings?.weights});
    if(g.type==='lead') {scoring.potentialIndex=null;scoring.rankScore=-1;scoring.reason='尚未确认产品实体，不能将一条资讯直接当作创业公司。';}
    const createdAt = g.type === 'open_source' ? date(latest('created_at')) : null;
    const ageDays = createdAt ? Math.max(0, (now - Date.parse(createdAt)) / 86400000) : null;
    const starCount = g.type === 'open_source' ? latest('stars') : null;
    const starsPerDay = g.type === 'open_source' && ageDays != null && ageDays >= 0.5 && Number.isFinite(starCount) ? starCount / ageDays : null;
    const mentions = [...new Map(g.records.flatMap(mentionEvents).map(m => [`${m.id}:${m.at}:${m.kind}`, m])).values()];
    // Hide local collect footprints; only show real publish / platform mentions.
    const heatMentions = mentions.filter(m => m.kind !== 'sighting' && m.kind !== 'resighting');
    const heatDetail = hourlyHeat(heatMentions, stars, now, { starsPerDay: g.type === 'open_source' ? starsPerDay : null });
    const heat = heatDetail.score;
    const raw = g.directRecords[0]?.collection?.raw || {};
    const ossRisks = g.type === 'open_source' ? [...(growth===null && starsPerDay==null?['缺少可比历史，增长持续性未知']:[]),...(ageDays != null && ageDays < 2?['项目很新，stars/天 波动大，需继续观测']:[])] : [];
    const researchReportId = [g.id,...g.records.flatMap(r=>r.urls||[]).map(idFor)].find(id=>research[id]) || g.id;
    const company = g.type==='startup' ? extractCompanyFacts(g.records, research[researchReportId]) : null;
    const item = {id:g.id,key:g.key,name:g.name,type:g.type,url:g.url,tagline:summarizeItem(g.directRecords[0] || g.records[0]),sourceIds,recordIds:g.records.map(i=>i.id),scoring,heat,heatDetail,company,researchReportId,research:{status:research[researchReportId]?.status||'not_started',finishedAt:research[researchReportId]?.finishedAt||null,overviewDimensions:research[researchReportId]?.overviewDimensions||[],compositeScore:research[researchReportId]?.compositeScore??null},metrics:{stars:starCount ?? null,forks:g.type==='open_source'?latest('forks')??null:null,downloads:latest('downloads') ?? null,createdAt,pushedAt:g.type==='open_source'?pushed||null:null,ageDays:ageDays != null ? Math.round(ageDays * 10) / 10 : null,starsPerDay:starsPerDay != null ? Math.round(starsPerDay * 10) / 10 : null,growthPerDay:growth,growthPerHour:heatDetail.starGrowthPerHour,historyDays:spanDays,mentions:heatMentions.length,platforms:sourceIds.length,batch:raw.batch||company?.batch||null,teamSize:Number.isFinite(raw.team_size)?raw.team_size:null,companyStatus:raw.status||null,founded:company?.founded||null,funding:company?.funding||null,profit:company?.profit||null},trends:{stars,mentions:heatDetail.series},mentions:heatMentions.sort((a,b)=>(b.at||'').localeCompare(a.at||'')),facts,risks:[...(g.type==='lead'?['产品实体待确认']:[]),...ossRisks,'传播先后不能证明因果；平台覆盖不等于独立来源','付费、留存、收入与竞争壁垒缺少验证'],updatedAt:store.updatedAt};
    item.momentumScore = momentumScore(item);
    return item;
  }).sort((a,b)=>(b.momentumScore??-1)-(a.momentumScore??-1));
  return {sources:sourceCatalog.map(({id,name})=>({id,name})),items,summary:{raw:raw.length,candidates:items.filter(i=>i.type!=='lead').length,leads:items.filter(i=>i.type==='lead').length,scored:items.filter(i=>i.scoring.potentialIndex!==null).length},updatedAt:store.updatedAt};
}
