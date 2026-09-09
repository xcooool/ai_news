import { stableId } from "./store.mjs";
import { connectorReadiness } from "./connectors.mjs";

function failure(code, message) { return Object.assign(new Error(message), { code }); }
const cleanUrl = value => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};

export async function serviceJson(url, options = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) });
  } catch {
    throw failure("unreachable", "采集服务不可达或超时，请检查服务是否启动及地址是否正确。");
  }
  if ([401, 403].includes(response.status)) throw failure("needs_login", "服务拒绝访问，请检查服务令牌或上游登录状态。");
  if (response.status === 429) throw failure("rate_limited", "上游限流，请稍后再试。");
  if (!response.ok) throw failure("upstream_error", `采集服务 HTTP ${response.status}，请查看上游服务日志。`);
  let data;
  try { data = await response.json(); }
  catch { throw failure("invalid_response", "采集服务没有返回 JSON，请检查接口地址或上游登录状态。"); }
  if (!data || typeof data !== "object" || data.success === false || data.error) {
    throw failure("upstream_error", "采集服务返回失败，请查看上游服务状态。");
  }
  return data;
}

function candidate(sourceId, record, mode) {
  const url = cleanUrl(record.url);
  if (!url) return null;
  const now = new Date().toISOString();
  const id = stableId(`${sourceId}:${record.id || url}`);
  const title = String(record.title || "待研究线索").slice(0, 300);
  const text = String(record.text || "").slice(0, 50000);
  const type = /开源|github\.com|open.source/i.test(`${title} ${text}`) ? "open_source" : "startup";
  return {
    id, type, name: title, tagline: text.slice(0, 240) || "自动采集的内容线索，项目身份待核实。",
    country: "未知", stage: "内容线索 / 待核实", status: "new", sampleMode: false,
    discoveredAt: now, lastSeenAt: now, aliases: [], urls: [url],
    facts: [
      { kind: "source_title", value: title, credibility: "fact", url, collectedAt: now },
      ...(record.author ? [{ kind: "author", value: String(record.author), credibility: "fact", url, collectedAt: now }] : []),
      ...(record.publishedAt ? [{ kind: "published_at", value: record.publishedAt, credibility: "fact", url, collectedAt: now }] : []),
    ],
    evidence: [], history: [],
    content: { text, html: String(record.html || "").slice(0, 100000) },
    collection: { sourceId, mode, entityVerified: false, contentIsUntrusted: true },
  };
}

export function normalizeJsonFeed(feed, sourceId, keywords = []) {
  if (!Array.isArray(feed.items)) throw failure("invalid_response", "服务响应不符合 JSON Feed 格式：缺少 items 数组。");
  return feed.items.filter(record => {
    const haystack = `${record.title || ""} ${record.content_text || ""} ${record.content_html || ""} ${record.summary || ""}`.toLowerCase();
    return !keywords.length || keywords.some(word => haystack.includes(word.toLowerCase()));
  }).map(record => candidate(sourceId, {
    id: record.id, title: record.title, url: record.url || record.external_url,
    text: record.content_text, html: record.content_html || record.summary,
    author: record.authors?.map(author => author.name).filter(Boolean).join(", ") || record.author?.name,
    publishedAt: record.date_published,
  }, sourceId === "wechat" ? "wewe_rss" : "rsshub")).filter(Boolean);
}

export function parseInteraction(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.replaceAll(",", "").trim().match(/^(\d+(?:\.\d+)?)\s*(万|亿|[kKmMwW])?\+?$/);
  if (!match) return null;
  const factor = { "万": 10000, "亿": 1e8, k: 1000, m: 1e6, w: 10000 }[match[2]?.toLowerCase()] || 1;
  return Number(match[1]) * factor;
}

export async function collectXiaohongshu(config, limit, fetcher = fetch) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.XHS_MCP_TOKEN) headers.Authorization = `Bearer ${process.env.XHS_MCP_TOKEN}`;
  const request = (route, options = {}) => serviceJson(`${config.xhsBaseUrl}${route}`, { ...options, headers }, fetcher);
  const login = await request("/api/v1/login/status");
  if (login.data?.is_logged_in !== true) throw failure("needs_login", "小红书尚未登录，请先在 xiaohongshu-mcp 完成扫码登录。");
  const items = [], warnings = [], seen = new Set();
  for (const keyword of config.keywords) {
    let search;
    try {
      search = await request("/api/v1/feeds/search", {
        method: "POST", body: JSON.stringify({ keyword, filters: { sort_by: "最新", publish_time: "一周内" } }),
      });
      if (!Array.isArray(search.data?.feeds)) throw failure("invalid_response", "小红书搜索响应缺少 feeds。");
    } catch (error) {
      warnings.push({ code: error.code || "upstream_error", message: error.message });
      continue;
    }
    for (const feed of search.data.feeds) {
      if (!feed.noteCard || typeof feed.id !== "string" || seen.has(feed.id)) continue;
      seen.add(feed.id);
      let note = null;
      if (feed.xsecToken) {
        try {
          const detail = await request("/api/v1/feeds/detail", {
            method: "POST", body: JSON.stringify({ feed_id: feed.id, xsec_token: feed.xsecToken, load_all_comments: false }),
          });
          note = detail.data?.data?.note;
          if (!note || typeof note.desc !== "string") throw failure("invalid_response", "笔记详情缺少正文。");
        } catch (error) { note = null; warnings.push({ code: error.code || "upstream_error", message: `一条笔记仅保留搜索摘要：${error.message}` }); }
      } else warnings.push({ code: "missing_detail_token", message: "一条笔记缺少详情令牌，仅保留搜索摘要。" });
      // Keep the platform's signed share link so the original note can be opened.
      const url = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(feed.id)}`);
      if (feed.xsecToken) { url.searchParams.set("xsec_token", feed.xsecToken); url.searchParams.set("xsec_source", "pc_search"); }
      const item = candidate("xiaohongshu", {
        id: feed.id, title: note?.title || feed.noteCard.displayTitle,
        text: note?.desc, url: url.href,
        author: note?.user?.nickname || feed.noteCard.user?.nickname,
        publishedAt: note?.time && Number.isFinite(new Date(note.time).getTime()) ? new Date(note.time).toISOString() : undefined,
      }, "xiaohongshu_mcp_rest");
      if (!item) continue;
      item.collection.detailFetched = Boolean(note);
      const metrics = note?.interactInfo || feed.noteCard.interactInfo || {};
      for (const [metric, label] of [["likedCount", "点赞"], ["collectedCount", "收藏"], ["commentCount", "评论"]]) {
        const value = parseInteraction(metrics[metric]);
        if (value === null) continue;
        item.facts.push({ kind: metric, value: metrics[metric], credibility: "third_party_estimate", url: url.href, collectedAt: item.lastSeenAt });
        item.evidence.push({
          id: `${item.id}:${metric}`, sourceId: "xiaohongshu",
          dimensionId: item.type === "open_source" ? "real_adoption" : "demand_validated",
          metric: { name: metric, value, method: "log", excellent: 10000, start: 1 },
          credibility: "third_party_estimate", confidence: 0.12,
          url: url.href, collectedAt: item.lastSeenAt,
          note: `${label}仅表示这条内容的互动，不能证明项目采用、客户或营收；Kimi 匹配保持未知。`,
        });
      }
      items.push(item);
      if (items.length >= limit) return { items, warnings };
    }
  }
  return { items, warnings };
}

export async function collectDomestic(sourceId, config, limit = 12, fetcher = fetch) {
  if (connectorReadiness(sourceId, config) !== "configured") {
    throw failure("needs_setup", "自动采集适配器已实现，请先在“自动采集连接”配置服务地址和订阅目标。");
  }
  limit = Math.min(30, Math.max(1, Math.trunc(Number(limit)) || 12));
  if (sourceId === "xiaohongshu") return collectXiaohongshu(config, limit, fetcher);
  const routes = sourceId === "wechat"
    ? config.wechatFeedIds.map(id => `/feeds/${encodeURIComponent(id)}.json`)
    : config.routes[sourceId];
  const base = sourceId === "wechat" ? config.weweBaseUrl : config.rsshubBaseUrl;
  const items = [], warnings = [], seen = new Set();
  for (const route of routes) {
    const url = new URL(`${base}${route}`);
    url.searchParams.set("limit", "100");
    if (sourceId !== "wechat") url.searchParams.set("format", "json");
    try {
      const feed = await serviceJson(url.href, {}, fetcher);
      const normalized = normalizeJsonFeed(feed, sourceId, config.keywords);
      for (const item of normalized) {
        if (seen.has(item.id)) continue;
        seen.add(item.id); items.push(item);
        if (items.length >= limit) break;
      }
    } catch (error) { warnings.push({ code: error.code || "upstream_error", message: error.message }); }
    if (items.length >= limit) break;
  }
  return { items, warnings };
}
