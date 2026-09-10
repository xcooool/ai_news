import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalysis, mentionEvents, repoKey} from '../lib/analysis.mjs';
import {researchTeam, gatherGithubTeam} from '../lib/team-research.mjs';
const row=(id,patch={})=>({id,type:'startup',name:'story',urls:['https://news.example/'+id],evidence:[],facts:[],collection:{sourceId:'feeds',publishedAt:'2026-09-09'},...patch});
const store=items=>({items,settings:{selectedSourceIds:['feeds']}});
test('raw leads stay visible, samples excluded, collectors do not restrict analysis evidence',()=>{
 const a=buildAnalysis(store([row('a'),row('sample',{sampleMode:true}),row('repo',{urls:['https://github.com/Test/Repo'],facts:[{kind:'stars',value:100,collectedAt:'2026-09-09'}],collection:{sourceId:'github_kol'}})]));
 assert.equal(a.summary.raw,2);assert.equal(a.summary.leads,1);assert.equal(a.summary.scored,1);assert.equal(a.items.find(i=>i.type==='lead').scoring.potentialIndex,null);
});
test('exact repo links aggregate distinct platforms; similar names do not merge; missing history remains unknown',()=>{
 const a=buildAnalysis(store([row('1',{urls:['https://github.com/A/One'],facts:[{kind:'stars',value:100,collectedAt:'2026-09-09'}]}),row('2',{content:{text:'https://github.com/a/one'},collection:{sourceId:'jike'}}),row('3')]));
 const repo=a.items.find(i=>i.key==='github:a/one');assert.equal(repo.recordIds.length,2);assert.equal(repo.metrics.platforms,2);assert.equal(repo.metrics.growthPerDay,null);assert.equal(repo.trends.stars.length,1);assert.equal(a.summary.leads,1);
 assert.equal(repoKey('https://evil.com/github.com/a/b'),null);
});
test('seven day measured growth and stable observations, no extrapolation from same-day snapshots',()=>{
 const facts=[{kind:'stars',value:100,collectedAt:'2026-09-01'},{kind:'stars',value:170,collectedAt:'2026-09-08'}];
 const i=buildAnalysis(store([row('r',{urls:['https://github.com/a/b'],facts})])).items[0];assert.equal(i.metrics.growthPerDay,10);assert.equal(i.trends.stars.length,2);
});
test('confirmed startup identity does not overwrite source; Show HN recognized as candidate only',()=>{
 const a=buildAnalysis(store([row('a',{analysisEntity:{name:'Acme',url:'https://acme.example/',type:'startup'}})]));assert.equal(a.items[0].name,'Acme');assert.equal(a.items[0].type,'startup');assert.equal(a.items[0].scoring.potentialIndex,null);
});
test('Show HN with a product website is a startup even after the title prefix is stripped',()=>{
 const site=buildAnalysis(store([row('s',{name:'Acme Agent',aliases:['Show HN: Acme Agent'],urls:['https://acme.example/'],collection:{sourceId:'hackernews',originalTitle:'Show HN: Acme Agent'}})]));
 assert.equal(site.items[0].type,'startup');assert.equal(site.items[0].url,'https://acme.example/');
 const gh=buildAnalysis(store([row('g',{name:'tool',aliases:['Show HN: tool'],urls:['https://github.com/a/tool'],collection:{sourceId:'hackernews',originalTitle:'Show HN: tool'}})]));
 assert.equal(gh.items[0].type,'open_source');
});
test('startup analysis omits github star metrics and star-growth risks',()=>{
 const a=buildAnalysis(store([row('yc',{name:'Acme',urls:['https://acme.example/'],facts:[{kind:'stars',value:12,collectedAt:'2026-09-09'},{kind:'created_at',value:'2026-01-01',collectedAt:'2026-09-09'}],collection:{sourceId:'yc'}})]));
 const i=a.items.find(x=>x.type==='startup');
 assert.equal(i.metrics.stars,null);assert.equal(i.metrics.starsPerDay,null);assert.equal(i.metrics.ageDays,null);
 assert.ok(!i.risks.some(r=>/stars|增速|可比历史/.test(r)));
});
test('YC directory ingest does not invent identical 24h heat from collection time',()=>{
 const now=new Date('2026-09-09T12:00:00Z');
 const a=buildAnalysis(store([
  row('a',{name:'Alpha',urls:['https://alpha.example/'],discoveredAt:'2026-09-09T11:00:00Z',collection:{sourceId:'yc',raw:{batch:'Summer 2024',team_size:8,status:'Active'}}}),
  row('b',{name:'Beta',urls:['https://beta.example/'],discoveredAt:'2026-09-09T11:00:00Z',collection:{sourceId:'yc',raw:{batch:'Winter 2025',team_size:2,status:'Active'}}}),
 ]),{now});
 const [x,y]=a.items.filter(i=>i.type==='startup');
 assert.equal(x.heat,0);assert.equal(y.heat,0);assert.equal(x.momentumScore,null);assert.equal(x.scoring.potentialIndex,null);
 assert.equal(x.metrics.batch,'Summer 2024');assert.equal(y.metrics.teamSize,2);
});
test('potential analysis drops inactive, acquired, public, and decade-old YC batches',()=>{
 const now=new Date('2026-09-09T12:00:00Z');
 const a=buildAnalysis(store([
  row('dead',{name:'Canopy Labs',urls:['https://www.ycombinator.com/companies/canopy-labs'],collection:{sourceId:'yc',raw:{batch:'Summer 2012',status:'Inactive',team_size:11}}}),
  row('bought',{name:'Casetext',urls:['https://casetext.example/'],collection:{sourceId:'yc',raw:{batch:'Summer 2013',status:'Acquired'}}}),
  row('old',{name:'Checkr',urls:['https://checkr.example/'],collection:{sourceId:'yc',raw:{batch:'Summer 2014',status:'Active'}}}),
  row('fresh',{name:'NewCo',urls:['https://newco.example/'],collection:{sourceId:'yc',raw:{batch:'Summer 2025',status:'Active'}}}),
 ]),{now});
 assert.deepEqual(a.items.filter(i=>i.type==='startup').map(i=>i.name),['NewCo']);
});
test('startup research without keys returns configuration need without outbound calls or invented score',async()=>{
 const r=await researchTeam({key:'https://acme.example'}, {env:{},store:{items:[]},fetcher:()=>{throw Error('must not fetch');}});assert.equal(r.status,'needs_config');assert.equal(r.score,null);
});
test('GitHub team evidence retains individual sources and labels limited coverage',async()=>{
 const urls=[];const r=await gatherGithubTeam({key:'github:a/b'},{env:{},fetcher:async u=>{urls.push(u);return {ok:true,status:200,json:async()=>u.includes('contributors')?[{type:'User',login:'one',contributions:10},{type:'Bot',login:'bot',contributions:99}]:{name:'One',public_repos:5,bio:'Developer'}};}});
 assert.equal(urls.length,2);assert.equal(r.people.length,1);assert.equal(r.people[0].contributions,10);assert.equal(r.people[0].base,null);assert.ok(Number.isFinite(r.score));assert.match(r.message,/贡献者不等于员工/);
});

test('hourly heat gives fresh launches priority and excludes old/future mentions', async()=>{
 const {hourlyHeat}=await import('../lib/analysis.mjs');const now=new Date('2026-09-09T12:00:00Z');
 const m=(at,source='feeds')=>({at,source});
 const h=hourlyHeat([m('2026-09-09T11:45:00Z'),m('2026-09-09T10:30:00Z','jike'),m('2026-09-09T02:00:00Z'),m('2026-09-07T12:00:00Z'),m('2026-09-10T12:00:00Z')],[],now);
 assert.equal(h.windows[1].mentions,1);assert.equal(h.windows[1].previousMentions,1);assert.equal(h.windows[6].mentions,2);assert.equal(h.windows[24].mentions,3);assert.equal(h.series.length,3);assert.equal(h.starGrowthPerHour,null);
 assert.ok(hourlyHeat([m('2026-09-09T11:55:00Z')],[],now).score>hourlyHeat([m('2026-09-09T01:00:00Z')],[],now).score);
 assert.equal(hourlyHeat([m('2026-09-08T11:00:00Z')],[],now).score,0);
});
test('github repos get traction heat from stars/day when social mentions are absent', async () => {
  const { hourlyHeat } = await import('../lib/analysis.mjs');
  const now = new Date('2026-09-09T12:00:00Z');
  const cold = hourlyHeat([], [], now, { starsPerDay: null });
  const warm = hourlyHeat([], [], now, { starsPerDay: 12 });
  assert.equal(cold.score, 0);
  assert.ok(warm.score > 0);
  assert.equal(warm.tractionSource, 'stars_per_day');
});

test('mention events include repo creation and collection sightings for github items', () => {
  const events = mentionEvents({
    id: 'r1',
    name: 'acme/agent',
    urls: ['https://github.com/acme/agent'],
    discoveredAt: '2026-09-09T10:00:00Z',
    facts: [{ kind: 'created_at', value: '2026-09-01T00:00:00Z' }],
    collection: { sourceId: 'github', publishedAt: '2026-09-08T00:00:00Z' },
  });
  assert.ok(events.some(e => e.kind === 'repo_created'));
  assert.ok(events.some(e => e.kind === 'sighting'));
  const item = buildAnalysis(store([{
    id: 'r1',
    type: 'open_source',
    name: 'acme/agent',
    urls: ['https://github.com/acme/agent'],
    facts: [
      { kind: 'created_at', value: '2026-09-01T00:00:00Z', collectedAt: '2026-09-09' },
      { kind: 'stars', value: 80, collectedAt: '2026-09-09' },
    ],
    collection: { sourceId: 'github' },
    discoveredAt: '2026-09-09T10:00:00Z',
  }]), { now: new Date('2026-09-09T12:00:00Z') }).items[0];
  assert.equal(item.metrics.ageDays, 8.5);
  assert.equal(item.metrics.starsPerDay, 9.4);
  assert.ok(item.heat > 0);
});

test('star hourly velocity uses measured intervals, retaining unknown for single or too-close snapshots',async()=>{
 const {hourlyHeat}=await import('../lib/analysis.mjs');const now=new Date('2026-09-09T12:00:00Z');
 const points=[{at:'2026-09-09T11:00:00Z',value:10},{at:'2026-09-09T11:30:00Z',value:20}];
 assert.equal(hourlyHeat([],points,now).starGrowthPerHour,20);
 assert.equal(hourlyHeat([],points.slice(0,1),now).starGrowthPerHour,null);
 assert.equal(hourlyHeat([],[points[0],{at:'2026-09-09T11:01:00Z',value:20}],now).starGrowthPerHour,null);
});
