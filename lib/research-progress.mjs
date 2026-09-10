import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const cachePath=repo=>path.join(process.cwd(),'data','research-cache',createHash('sha256').update(repo).digest('hex')+'.json');
export async function readTeamCache(repo){try{return JSON.parse(await readFile(cachePath(repo),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {repo,contributors:[],people:[],nextPage:1,listingComplete:false};}}
export async function saveTeamCache(repo,cache){const f=cachePath(repo);await mkdir(path.dirname(f),{recursive:true});await writeFile(f+'.tmp',JSON.stringify(cache,null,2));await rename(f+'.tmp',f);}
export function researchCoverage({engineering={},findings={},documents=[],searchEnabled=false}={}){
 const profiles=engineering.roster||[];const researched=new Set((engineering.people||[]).map(p=>p.handle));
 const people=profiles.map(p=>({name:p.name,url:p.url,status:researched.has(p.name)?'profile_fetched':'pending',scope:'GitHub public profile; not employment verification'}));
 for(const p of findings.people||[])if(!people.some(x=>x.url&&(x.url===p.profileUrl||x.url===p.url)))people.push({name:p.name,url:p.profileUrl||null,status:'extracted_unverified',scope:'cited public material; identity and career require verification'});
 return {people,knownPeople:people.length,profilesFetched:researched.size,pendingProfiles:profiles.filter(p=>!researched.has(p.name)).length,listingComplete:engineering.coverage?.listingComplete??null,externalSearch:searchEnabled?'attempted':'not_configured',documentsAvailable:documents.length,documentsUsed:findings.sourceCount??0,contextTruncated:Boolean(findings.contextTruncated),teamComplete:false,fundingStatus:findings.funding?.length?'claims_with_citations':'unknown',nextAction:engineering.coverage?.remaining?'点击继续调研，补齐下一批公开成员资料':'完整员工名单、任职真实性和融资仍需独立核验'};
}
