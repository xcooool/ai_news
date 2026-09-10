const UNKNOWN = "未披露";

export function companyWebsite(item = {}) {
  const raw = item.collection?.raw || {};
  const urls = [raw.website, ...(item.urls || [])];
  for (const value of urls) {
    try {
      const u = new URL(value);
      if (!["http:", "https:"].includes(u.protocol)) continue;
      if (/(^|\.)(ycombinator|producthunt|news\.ycombinator|github)\.com$/i.test(u.hostname)) continue;
      return u.href;
    } catch { /* skip */ }
  }
  return item.urls?.[0] || null;
}

export function extractCompanyFacts(records = [], research = null) {
  const raws = records.map((item) => item.collection?.raw || {});
  const corpus = records.map((item) => [
    item.name, item.tagline, item.content?.text,
    item.collection?.originalTitle, JSON.stringify(item.collection?.raw || {}),
  ].filter(Boolean).join("\n")).join("\n");

  const batch = raws.map((raw) => raw.batch).find(Boolean) || null;
  const year = raws.map((raw) => Number(raw.year_founded || raw.founded_year)).find((value) => value >= 1990 && value <= 2100)
    || Number((corpus.match(/\b(?:founded|成立于|创立于)\s*(?:in\s*)?(20\d{2})\b/i) || [])[1])
    || null;
  const launched = raws.map((raw) => {
    const ts = Number(raw.launched_at);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }).find(Boolean) || null;
  const firstSeen = records.map((item) => item.collection?.publishedAt || item.discoveredAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()[0]?.slice(0, 10) || null;

  const foundedParts = [];
  if (Number.isFinite(year)) foundedParts.push(String(year));
  
  
  const founded = foundedParts.length ? foundedParts.join(" · ") : UNKNOWN;

  // Only structured, cited research facts enter filters. A summary is not an extraction source.
  const cited = row => row && /^https?:\/\//.test(row.source || '') && typeof row.quote === 'string' && row.quote.trim().length >= 8;
  const fundingRows = (research?.funding || []).filter(cited).filter(r=>r.round || r.amount);
  fundingRows.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
  const researchRound = fundingRows[0];
  const funding = researchRound ? [researchRound.round,researchRound.amount,researchRound.date].filter(Boolean).join(' · ') : UNKNOWN;
  const roundText = String(researchRound?.round || '').toLowerCase();
  const fundingStage = !researchRound ? 'undisclosed' : /pre.?seed|种子前/.test(roundText) ? 'pre_seed' : /seed|种子/.test(roundText) ? 'seed' : /angel|天使/.test(roundText) ? 'angel' : /series\s*a|a轮/.test(roundText) ? 'a' : /series\s*b|b轮/.test(roundText) ? 'b' : /series\s*[c-z]|[c-z]轮|growth/.test(roundText) ? 'c_plus' : 'disclosed';
  const cf = research?.companyFacts || {};
  const teamRecord=records.find(r=>Number.isFinite(r.collection?.raw?.team_size));
  const rawSize=teamRecord?.collection.raw.team_size;
  const sizeFact=cited(cf.teamSize)&&Number.isFinite(cf.teamSize.value)&&cf.teamSize.value>=0 ? cf.teamSize : null;
  const teamSize=sizeFact?.value ?? (rawSize>=0?rawSize:null);
  const baseRecord=records.find(r=>r.collection?.raw?.all_locations || r.collection?.raw?.location);
  const rawBase=baseRecord?.collection.raw.all_locations || baseRecord?.collection.raw.location;
  const baseFact=cited(cf.base)&&typeof cf.base.value==='string' ? cf.base : null;
  const base=baseFact?.value || (typeof rawBase==='string'?rawBase:null);
  const launchFact=cited(cf.productStatus)&&['announced','beta','launched','closed'].includes(cf.productStatus.value)?cf.productStatus:null;
  const launchRecord=records.find(r=>r.collection?.sourceId==='producthunt'&&r.collection?.publishedAt);
  const productStatus=launchFact?.value || (launchRecord?'launched':'undisclosed');
  const profitFact=cited(cf.profitability)&&['profitable','unprofitable','break_even'].includes(cf.profitability.value)?cf.profitability:null;
  const profitStatus=profitFact?.value || 'undisclosed';
  const profit=({profitable:'已披露盈利',unprofitable:'已披露未盈利',break_even:'已披露盈亏平衡'})[profitStatus] || UNKNOWN;
  const evidence = [
    ...fundingRows.map(r=>({field:'融资',value:[r.round,r.amount,r.date].filter(Boolean).join(' · '),...r})),
    ...Object.entries({teamSize:sizeFact,base:baseFact,productStatus:launchFact,profitability:profitFact}).filter(([,r])=>r).map(([field,r])=>({field,...r})),
    ...(teamRecord&&!sizeFact?[{field:'团队人数',value:teamSize,source:teamRecord.urls?.[0],quote:'目录记录的团队人数',collectedAt:teamRecord.lastSeenAt||teamRecord.discoveredAt}]:[]),
    ...(baseRecord&&!baseFact?[{field:'团队所在地',value:base,source:baseRecord.urls?.[0],quote:'目录记录的团队所在地',collectedAt:baseRecord.lastSeenAt||baseRecord.discoveredAt}]:[]),
    ...(launchRecord&&!launchFact?[{field:'产品发布',value:'Product Hunt 发布记录',source:launchRecord.urls?.[0],quote:'产品发布记录',collectedAt:launchRecord.collection.publishedAt}]:[]),
  ];

  return {
    fundingStage, productStatus, profitStatus, teamSize, base, evidence,
    founded,
    funding,
    profit,
    foundedKnown: foundedParts.length > 0,
    fundingKnown: funding !== UNKNOWN,
    profitKnown: profit !== UNKNOWN,
    batch,
    firstSeen,
  };
}
