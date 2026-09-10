import { readTeamCache, saveTeamCache, researchCoverage } from './research-progress.mjs';
import { describeNetworkError, enrichResearch } from './research-llm.mjs';
import { researchCompositeScore, researchOverviewDimensions } from '../public/research-dimensions.js';
import { readStore } from './store.mjs';
import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import PQueue from 'p-queue';
const queue = new PQueue({concurrency:1});
const active = new Map();
const dir = () => path.join(process.cwd(),'data','research-reports');
const file = id => {if(!/^entity_[a-f0-9]{20}$/.test(id)) throw new Error('无效项目 ID');return path.join(dir(),id+'.json');};
async function save(report) {await mkdir(dir(),{recursive:true});const f=file(report.id);await writeFile(f+'.tmp',JSON.stringify(report,null,2));await rename(f+'.tmp',f);return report;}
export async function getResearch(id) {if(active.has(id)) return active.get(id);try {const r=JSON.parse(await readFile(file(id),'utf8'));if(['queued','running'].includes(r.status)) return {...r,status:'interrupted',message:'服务重启中断了调研，请重新点击。'};return r;}catch(e){if(e.code!=='ENOENT')throw e;return {id,status:'not_started',score:null};}}
export async function loadResearchFacts() {
  let names=[]; try { names=await readdir(dir()); } catch(e) { if(e.code!=='ENOENT') throw e; return {}; }
  const out={};
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp.json')) continue;
    try {
      const r=JSON.parse(await readFile(path.join(dir(),name),'utf8'));
      if (r.id) {
        const overviewDimensions = researchOverviewDimensions(r);
        out[r.id] = {
          funding: r.funding || [],
          companyFacts: r.companyFacts || {},
          finishedAt: r.finishedAt || null,
          status: active.has(r.id) ? active.get(r.id).status : (['queued', 'running'].includes(r.status) ? 'interrupted' : r.status),
          overviewDimensions,
          compositeScore: researchCompositeScore(overviewDimensions),
        };
      }
    } catch { /* skip malformed reports */ }
  }
  return out;
}
export async function enqueueResearch(entity, options={}) {
  if(active.has(entity.id))return active.get(entity.id);
  const previous=await getResearch(entity.researchReportId||entity.id);
  const report={...previous,id:entity.id,name:entity.name,status:'queued',score:null,startedAt:new Date().toISOString()};active.set(entity.id,report);await save(report);
  queue.add(async()=>{try{report.status='running';await save(report);Object.assign(report,await researchTeam(entity,{...options,onProgress:async progress=>{report.progress=progress;await save(report);}}));}catch(e){Object.assign(report,{status:'error',score:null,message:e.message});}finally{report.finishedAt=new Date().toISOString();await save(report);active.delete(entity.id);}}).catch(()=>active.delete(entity.id));return report;
}
export async function gatherGithubTeam(entity,{fetcher=fetch,env=process.env,cache,onProgress=async()=>{},persistCache=saveTeamCache}={}) {
  const headers={Accept:'application/vnd.github+json','User-Agent':'ai-news-research'};if(env.GITHUB_TOKEN)headers.Authorization=`Bearer ${env.GITHUB_TOKEN}`;
  const get=async url=>{const r=await fetcher(url,{headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`GitHub 返回 ${r.status}，可能需要配置 GITHUB_TOKEN 或稍后重试。`);return r.status===204?[]:r.json();};
  if(entity.key.startsWith('github:')) {
    const repo=entity.key.slice(7);if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw new Error('无效仓库');
    const progress=cache || {repo,contributors:[],people:[],nextPage:1,listingComplete:false};
    // Each click has a finite request batch, but subsequent clicks resume rather than restart.
    for(let batch=0;batch<3&&!progress.listingComplete;batch++) {
      const page=progress.nextPage;
      const list=await get(`https://api.github.com/repos/${repo}/contributors?per_page=100&page=${page}`);
      progress.contributors=[...new Map([...progress.contributors,...list].map(c=>[c.login||c.id,c])).values()];
      progress.nextPage=page+1;progress.listingComplete=list.length<100;
      if(cache)await persistCache(repo,progress);
      await onProgress({phase:'listing_members',listed:progress.contributors.length,nextPage:progress.nextPage});
    }
    const contributors=progress.contributors,truncated=!progress.listingComplete;
    const people=progress.people, errors=[];
    const humans=contributors.filter(c=>c.type==='User');
    const complete=new Set(people.map(p=>p.handle));
    for(const c of humans.filter(c=>!complete.has(c.login)).slice(0,30)) {
      try {
        const p=await get(`https://api.github.com/users/${encodeURIComponent(c.login)}`);
        const profile=`https://github.com/${c.login}`;
        people.push({name:p.name||c.login,handle:c.login,role:'公开贡献者（非雇佣关系认定）',bio:p.bio||'',company:p.company||null,publicRepos:p.public_repos,contributionSource:`https://api.github.com/repos/${repo}/contributors`,contributions:c.contributions,url:profile,source:profile,base:p.location?{city:String(p.location),source:profile,quote:String(p.location)}:null,credibility:'履历由个人自述，贡献数来自 GitHub',fetchedAt:new Date().toISOString()});
        if(cache)await persistCache(repo,progress);
      }catch(e){errors.push({name:c.login,error:e.message});}
      await onProgress({phase:'member_profiles',listed:humans.length,completed:people.length,pending:humans.length-people.length});
    }
    const total=humans.reduce((n,c)=>n+c.contributions,0);const topShare=total?Math.max(...humans.map(c=>c.contributions))/total:null;
    const dimensions=[{name:'协作广度',score:Math.min(100,Math.log1p(humans.length)/Math.log(21)*100),weight:40},{name:'贡献分散程度',score:topShare===null?null:(1-topShare)*100,weight:35},{name:'公开交付积累',score:people.length?Math.min(100,people.reduce((n,p)=>n+Math.min(20,p.publicRepos||0),0)/people.length/20*100):null,weight:25}];
    const available=dimensions.filter(d=>d.score!==null);const score=available.length&&people.length?Math.round(available.reduce((n,d)=>n+d.score*d.weight,0)/available.reduce((n,d)=>n+d.weight,0)):null;
    return {status:errors.length||truncated||people.length<humans.length?'partial':'done',score,scoreLabel:'团队公开工程证据分',dimensions,people,roster:humans.map(c=>({name:c.login,contributions:c.contributions,url:`https://github.com/${c.login}`})),errors,coverage:{listed:humans.length,researched:people.length,truncated,listingComplete:progress.listingComplete,remaining:truncated||people.length<humans.length},message:'贡献者不等于员工。每次补充最多 300 个名单与 30 份公开资料，后续点击会从保存进度继续；未核验完整团队、任职履历或商业能力。分数仅是工程证据启发式，不是成功概率。'};
  }
  return {people:[],roster:[],score:null};
}

export async function researchTeam(entity,{fetcher=fetch,env=process.env,store,onProgress=async()=>{}}={}) {
  const local=store || await readStore();
  const documents=local.items.filter(i=>entity.recordIds?.includes(i.id)).map(i=>({url:i.urls?.[0],text:JSON.stringify({name:i.name,content:i.content,facts:i.facts})}));
  let engineering={people:[],score:null},errors=[];
  if(entity.key.startsWith('github:')) {
    try { engineering=await gatherGithubTeam(entity,{fetcher,env,cache:await readTeamCache(entity.key.slice(7)),onProgress}); } catch(e) {errors.push(describeNetworkError(e, 'GitHub 公开资料'));}
    documents.push(...[...engineering.people].sort((a,b)=>(b.fetchedAt||'').localeCompare(a.fetchedAt||'')).map(p=>({url:p.source,text:JSON.stringify(p)})));
  }
  if(env.TAVILY_API_KEY) {
    for(const query of [`${entity.name} founders team background education`,`${entity.name} funding round investors product customers alternatives`,`${entity.name} product launch beta release date profitability net profit team size headquarters`]) {
      try {
        const r=await fetcher('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.TAVILY_API_KEY}`},body:JSON.stringify({query,max_results:8,search_depth:'advanced'}),signal:AbortSignal.timeout(30000)});
        if(!r.ok)throw new Error(`公开检索 HTTP ${r.status}`);
        documents.push(...((await r.json()).results||[]).map(r=>({url:r.url,text:r.content||''})));
      } catch(e){errors.push(describeNetworkError(e, '公开检索 Tavily'));}
    }
  } else errors.push('未配置 TAVILY_API_KEY：本次只分析已入库材料与 GitHub 公开资料，不能宣称已全面检索团队与融资。');
  let findings;
  await onProgress({phase:'model_analysis',documents:documents.length,people:engineering.people.length});
  try {findings=await enrichResearch(entity,documents,{env,fetcher});}catch(e){findings={llm:{status:'error'},score:null,message:e.message};}
  const coverage=researchCoverage({engineering,findings,documents,searchEnabled:Boolean(env.TAVILY_API_KEY)});
  return {...engineering,...findings,researchCoverage:coverage,people:engineering.people.length?engineering.people:findings.people||[],extractedPeople:findings.people||[],engineeringScore:engineering.score,errors:[...(engineering.errors||[]),...errors.map(error=>({error}))],status:findings.llm?.status==='needs_config'?'needs_config':findings.llm?.status==='error'?'error':'partial',sources:documents.map(d=>({url:d.url})),message:[findings.message,engineering.message,'人物、融资与产品评估按引用记录；未证实的关系不当作事实。'].filter(Boolean).join(' ')};
}
