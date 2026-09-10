import { researchCompositeScore, researchOverviewDimensions } from "./research-dimensions.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const citation = (d) => {
  try {
    const u = new URL(d.source);
    if (!["https:", "http:"].includes(u.protocol)) return "";
    return `<a target="_blank" rel="noopener noreferrer" href="${esc(u.href)}">原文依据</a>${d.quote ? `<blockquote>${esc(d.quote)}</blockquote>` : ""}`;
  } catch {
    return "";
  }
};

const personKey = (p) => {
  const url = String(p.profileUrl || p.url || "");
  const handle = p.handle || (url.match(/github\.com\/([^/?#]+)/i) || [])[1];
  return String(handle || url || p.name || "").toLowerCase();
};

function unique(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function teamView(r = {}) {
  const map = new Map();
  for (const p of [...(r.people || []), ...(r.extractedPeople || []), ...(r.members || [])]) {
    const key = personKey(p);
    if (!key) continue;
    const prev = map.get(key) || {};
    map.set(key, {
      name: p.name || prev.name,
      handle: p.handle || prev.handle,
      role: p.role || prev.role,
      bio: p.bio || prev.bio,
      company: p.company || prev.company,
      contributions: p.contributions ?? prev.contributions,
      publicRepos: p.publicRepos ?? prev.publicRepos,
      url: p.url || p.profileUrl || prev.url,
      source: p.source || prev.source,
      credibility: p.credibility || prev.credibility,
      education: [...(prev.education || []), ...(p.education || [])],
      experience: [...(prev.experience || []), ...(p.experience || [])],
      base: p.base || prev.base,
    });
  }
  const members = [...map.values()].sort((a, b) => (b.contributions || 0) - (a.contributions || 0));
  const locations = unique(
    members.filter((m) => m.base?.city).map((m) => ({ city: m.base.city, source: m.base.source, quote: m.base.quote, name: m.name })),
    (x) => x.city.toLowerCase(),
  );
  const companies = unique(
    members.filter((m) => m.company).map((m) => ({ name: String(m.company).trim(), person: m.name })),
    (x) => x.name.toLowerCase(),
  );
  const education = members.flatMap((m) => (m.education || []).map((e) => ({ ...e, person: m.name })));
  const experience = members.flatMap((m) => (m.experience || []).map((e) => ({ ...e, person: m.name })));
  return { members, locations, companies, education, experience, funding: r.funding || [] };
}

function scoreRow(d) {
  const value = d.score == null ? null : Math.min(100, Math.max(0, d.score));
  const label = d.score == null ? "未知" : Math.round(d.score);
  return `<article class="score-row"><div class="score-row-head"><b>${esc(d.name)}</b><strong>${esc(label)}</strong></div>${value != null ? `<div class="score-bar"><span style="width:${value}%"></span></div>` : ""}<p>${esc(d.reason || "")}</p>${d.source ? citation(d) : ""}</article>`;
}

function dimensionMeter(d) {
  const value = d.score == null ? 0 : Math.min(100, Math.max(0, d.score));
  const label = d.score == null ? "未知" : Math.round(d.score);
  return `<div class="research-dimension"><span>${esc(d.name)}</span><meter min="0" max="100" value="${value}"></meter><b>${esc(label)}</b></div>`;
}

export function researchDimensionOverview(r) {
  const dimensions = researchOverviewDimensions(r).filter((d) => d.score != null);
  if (!dimensions.length || ["queued", "running", "not_started"].includes(r.status)) return "";
  const composite = researchCompositeScore(dimensions);
  return `<section class="research-dimension-overview">
    <div class="research-dimension-head">
      <div><h3>调研五维</h3></div>
      <div class="research-dimension-score"><strong>${composite}</strong><span>综合分 · ${dimensions.length} 维有证据</span></div>
    </div>
    <div class="research-dimension-grid">${dimensions.map(dimensionMeter).join("")}</div>
  </section>`;
}

function memberCard(p) {
  const href = p.url || p.source;
  const name = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>` : esc(p.name);
  const meta = [p.role, p.company, p.base?.city, p.contributions != null ? `贡献 ${Number(p.contributions).toLocaleString("zh-CN")}` : null]
    .filter(Boolean)
    .join(" · ");
  return `<article class="member-card"><b>${name}</b><span>${esc(meta)}</span>${p.bio ? `<p>${esc(p.bio)}</p>` : ""}<small>${esc(p.credibility || "公开资料，需复核")}</small></article>`;
}

const PHASE_LABEL = {
  listing_members: "正在拉取贡献者名单",
  member_profiles: "正在读取公开资料",
  model_analysis: "正在分析团队与 Base",
};

function progressStats(progress = {}) {
  if (progress.phase === "listing_members") return { done: Number(progress.listed || 0), total: null, unit: "人" };
  if (progress.phase === "member_profiles") {
    const done = Number(progress.completed || 0);
    const pending = Number(progress.pending);
    const listed = Number(progress.listed);
    const total = Number.isFinite(pending) ? done + pending : Number.isFinite(listed) ? listed : null;
    return { done, total, unit: "人" };
  }
  if (progress.phase === "model_analysis") return { done: Number(progress.documents || progress.people || 0), total: null, unit: "份材料" };
  return { done: Number(progress.completed ?? progress.listed ?? 0), total: null, unit: "人" };
}

export function researchProgress(r) {
  if (!["queued", "running"].includes(r.status)) return "";
  const stats = progressStats(r.progress || {});
  const pct = stats.total > 0 ? Math.min(100, Math.round((stats.done / stats.total) * 100)) : null;
  const phase = PHASE_LABEL[r.progress?.phase] || (r.status === "queued" ? "排队等待开始" : "正在检索公开资料");
  return `<div class="research-progress" role="status" aria-live="polite">
    <div class="research-progress-head">
      <span class="research-spinner" aria-hidden="true"></span>
      <div>
        <b data-progress-title>${r.status === "queued" ? "排队中" : "调研进行中"}</b>
        <p data-progress-phase>${esc(phase)}</p>
      </div>
    </div>
    <div class="research-bar${pct == null ? " is-indeterminate" : ""}"><i data-progress-fill style="${pct == null ? "" : `width:${pct}%`}"></i></div>
    <div class="research-progress-meta" data-progress-meta>${stats.total != null ? `<span>已取得 ${stats.done} / ${stats.total} ${stats.unit}</span><span>${pct}%</span>` : `<span>已取得 ${stats.done} ${stats.unit}</span><span>进行中</span>`}</div>
  </div>
  <div class="research-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>`;
}

function baseSection(team) {
  const chunks = [];
  if (team.locations.length) chunks.push(`<h4>工作所在地</h4><div class="base-chips">${team.locations.map((x) => `<span class="base-chip">${esc(x.city)}${x.name ? `<small>${esc(x.name)}</small>` : ""}</span>`).join("")}</div>`);
  if (team.companies.length) chunks.push(`<h4>公开组织 / 公司</h4><div class="base-chips">${team.companies.map((x) => `<span class="base-chip">${esc(x.name)}<small>${esc(x.person)}</small></span>`).join("")}</div>`);
  if (team.education.length) chunks.push(`<h4>教育</h4>${team.education.map((e) => `<article class="base-card"><b>${esc(e.institution)}</b><p>${esc(e.person)}${e.role ? ` · ${esc(e.role)}` : ""}</p>${citation(e)}</article>`).join("")}`);
  if (team.experience.length) chunks.push(`<h4>任职经历</h4>${team.experience.map((e) => `<article class="base-card"><b>${esc(e.institution)}</b><p>${esc(e.person)} · ${esc(e.role || "角色未知")}</p>${citation(e)}</article>`).join("")}`);
  if (team.funding.length) chunks.push(`<h4>融资</h4>${team.funding.map((f) => `<article class="base-card"><b>${esc(f.round || "轮次未知")} · ${esc(f.amount || "金额未知")}</b><p>${esc(f.date || "日期未知")} · ${esc((f.investors || []).join("、") || "投资方未知")}</p>${citation(f)}</article>`).join("")}`);
  if (!chunks.length) return "";
  return `<h3>Base 调研</h3>${chunks.join("")}`;
}

export function researchPanels(r) {
  const busy = ["queued", "running"].includes(r.status);
  if (busy) return `<section class="research-panels">${researchProgress(r)}</section>`;
  if (!r.status || r.status === "not_started") return "";

  const team = teamView(r);
  const scored = (list = []) => list.filter((d) => d.score != null);
  const engineering = scored(r.dimensions);
  const teamDims = scored(r.teamDimensions);
  const productDims = scored(r.productDimensions);
  const checks = [...(r.unknowns || []), ...(r.nextChecks || [])];

  const parts = [
    researchDimensionOverview(r),
    r.summary ? `<p class="research-summary">${esc(r.summary)}</p>` : "",
    team.members.length ? `<h3>团队组成</h3><div class="member-grid">${team.members.map(memberCard).join("")}</div>` : "",
    r.roster?.length ? `<details class="roster-details"><summary>完整贡献者名单（${r.roster.length}）</summary>${r.roster.map((p) => `<p>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>` : esc(p.name)} · ${p.contributions} 次贡献</p>`).join("")}</details>` : "",
    engineering.length || teamDims.length ? `<h3>团队分析</h3><div class="score-list">${[...engineering, ...teamDims].map(scoreRow).join("")}</div>` : "",
    baseSection(team),
    productDims.length ? `<h3>产品判断</h3><div class="score-list">${productDims.map(scoreRow).join("")}</div>` : "",
    r.researchCoverage ? `<details class="coverage-details"><summary>研究覆盖：已知 ${r.researchCoverage.knownPeople} 人，已读 ${r.researchCoverage.documentsAvailable} 份材料，待补 ${r.researchCoverage.pendingProfiles} 人</summary><p>融资：${r.researchCoverage.fundingStatus === "unknown" ? "未知" : "有待核验引用"}。模型使用 ${r.researchCoverage.documentsUsed} / ${r.researchCoverage.documentsAvailable} 份材料${r.researchCoverage.contextTruncated ? "，输入有截断" : ""}。公开成员资料 ${r.researchCoverage.profilesFetched} 份。</p><p>${esc(r.researchCoverage.nextAction || "")}</p>${(r.researchCoverage.people || []).map((p) => `<p>${esc(p.name)} · ${esc({ profile_fetched: "公开资料已取得", pending: "待补资料", extracted_unverified: "模型提取，未核验" }[p.status] || p.status)}</p>`).join("")}</details>` : "",
    checks.length ? `<h3>待核查</h3><ul>${checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "",
  ].filter(Boolean);

  if (!parts.length) return "";
  return `<section class="research-panels">${parts.join("")}</section>`;
}
