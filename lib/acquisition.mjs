import { createHash } from "node:crypto";
import { plainText } from "./plain-text.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { filterByTimeRange, parseCollectOptions } from "./collect-options.mjs";
import { filterEmergingTargets, isIncumbentGithubOrg } from "./discovery.mjs";
import { applyIntentBatch, DEFAULT_INTENT_KEYWORDS } from "./intent-discovery.mjs";

export const acquisitionSourceIds = ["jike", "x", "feeds", "github_kol", "hf_spaces", "producthunt", "reddit"];
export const fail = (code, message) => Object.assign(new Error(message), { code });
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const str = value => typeof value === "object" ? String(value?.["#text"] ?? "") : String(value ?? "");
const hash = value => createHash("sha256").update(value).digest("hex");
export const httpUrl = value => {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
};
export const plain = value => String(value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const iso = value => { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toISOString() : null; };

export async function readWatchlist() {
  // Public checked-in seeds; local signed profile links and private feed URLs live only in data/.
  const base = JSON.parse(await readFile(new URL("../config/watchlist.json", import.meta.url), "utf8"));
  try {
    const local = JSON.parse(await readFile(path.join(process.cwd(), "data/watchlist.local.json"), "utf8"));
    for (const [key, values] of Object.entries(local)) {
      if (!Array.isArray(values)) throw fail("invalid_config", `${key} 必须是数组`);
      const merged = new Map((base[key] ?? []).map(t => [t.id, t]));
      for (const target of values) merged.set(target.id, { ...merged.get(target.id), ...target });
      base[key] = [...merged.values()];
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return base;
}

export async function request(url, options = {}, fetcher = fetch) {
  const { timeoutMs = 25000, ...rest } = options;
  let response;
  try { response = await fetcher(url, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs) }); }
  catch { throw fail("unreachable", "网络不可达或请求超时（检查 DNS、代理和服务地址）"); }
  if (!response.ok) {
    const code = ({ 401: "needs_login", 402: "needs_credits", 403: "access_denied", 404: "not_found", 429: "rate_limited" })[response.status] || "upstream_error";
    throw fail(code, `上游 HTTP ${response.status}${response.headers.get("retry-after") ? `，Retry-After: ${response.headers.get("retry-after")}` : ""}`);
  }
  return response;
}
async function json(url, options, fetcher) {
  const response = await request(url, options, fetcher);
  try { return await response.json(); } catch { throw fail("invalid_response", "上游未返回有效 JSON"); }
}

export function rawItem(sourceId, record, target, mode) {
  const url = httpUrl(record.url);
  if (!url) return null;
  const now = new Date().toISOString();
  const text = plainText(record.text ?? record.html ?? "");
  const author = record.author || target.name;
  const publishedAt = iso(record.publishedAt);
  const links = [...new Set([...(record.links ?? []), ...text.matchAll(/https?:\/\/[^\s<>"）)]+/g)].map(v => httpUrl(Array.isArray(v) ? v[0] : v)).filter(Boolean))];
  return {
    id: `raw_${hash(`${sourceId}:${record.id || url}`).slice(0, 24)}`,
    type: "startup", name: plainText(record.title || text, 100) || "无标题内容",
    tagline: plainText(text, 240), country: "未知", stage: "原始内容 / 未分析", status: "new", sampleMode: false,
    discoveredAt: now, lastSeenAt: now, aliases: [], urls: [url], evidence: [], history: [],
    facts: [
      { kind: "author", value: author, credibility: "fact", url, collectedAt: now },
      ...(publishedAt ? [{ kind: "published_at", value: publishedAt, credibility: "fact", url, collectedAt: now }] : []),
      ...Object.entries(record.metrics ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([kind, value]) => ({ kind, value, credibility: "fact", url, collectedAt: now })),
    ],
    content: { text, html: String(record.html ?? "") },
    collection: { sourceId, mode, targetId: target.id, targetName: target.name, author,
      publishedAt, entityVerified: false, contentIsUntrusted: true, outboundLinks: links,
      coverage: record.coverage || "latest_page", raw: record.raw ?? record },
  };
}

export function parseFeed(body, sourceId, target) {
  let records;
  if (body.trimStart().startsWith("{")) {
    const data = JSON.parse(body);
    if (!Array.isArray(data.items)) throw fail("invalid_response", "JSON Feed 缺少 items");
    records = data.items.map(r => ({ id: r.id, title: r.title, url: r.url || r.external_url, text: r.content_text,
      html: r.content_html || r.summary, publishedAt: r.date_published || r.date_modified,
      author: r.authors?.map(a => a.name).join(", ") || r.author?.name, raw: r }));
  } else {
    if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw fail("invalid_response", "拒绝 DTD/HTML 响应，预期 RSS 或 Atom");
    if (XMLValidator.validate(body) !== true) throw fail("invalid_response", "RSS/Atom XML 格式错误");
    const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false }).parse(body);
    if (doc.rss?.channel) {
      records = list(doc.rss.channel.item).map(r => ({ id: str(r.guid) || str(r.link), title: str(r.title), url: str(r.link),
        html: str(r["content:encoded"] || r.description), author: str(r["dc:creator"] || r.author),
        publishedAt: str(r.pubDate || r["dc:date"]), raw: r }));
    } else if (doc.feed) {
      records = list(doc.feed.entry).map(r => ({ id: str(r.id), title: str(r.title),
        url: list(r.link).find(l => !l["@_rel"] || l["@_rel"] === "alternate")?.["@_href"],
        html: str(r.content || r.summary), author: str(r.author?.name || doc.feed.author?.name), publishedAt: str(r.published || r.updated), raw: r }));
    } else throw fail("invalid_response", "没有 RSS/Atom 根节点，可能是登录或拦截页面");
  }
  return records.map(r => rawItem(sourceId, r, target, "rss_atom")).filter(Boolean);
}

export function parseJikePage(html, target) {
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw fail("invalid_response", "即刻页面缺少公开数据，可能需登录或页面结构已变化");
  let data;
  try { data = JSON.parse(match[1]).props.pageProps; } catch { throw fail("invalid_response", "即刻页面数据格式变化"); }
  if (!Array.isArray(data.posts)) throw fail("invalid_response", "即刻主页缺少帖子数组");
  const author = data.user?.screenName;
  if (target.expectedName && author !== target.expectedName) throw fail("identity_mismatch", `账号名变更或不匹配：${author || "未知"}`);
  return data.posts.map(post => rawItem("jike", {
    id: post.id, title: (post.content || post.linkInfo?.title || post.title || "即刻动态").slice(0, 150),
    text: `${post.content || ""}${post.target?.content ? `\n\n转发 @${post.target.user?.screenName || ""}: ${post.target.content}` : ""}`,
    url: `https://m.okjike.com/${post.type === "REPOST" ? "reposts" : "originalPosts"}/${post.id}`,
    author: post.user?.screenName || author, publishedAt: post.createdAt || post.actionTime,
    metrics: { likes: post.likeCount, comments: post.commentCount, reposts: post.repostCount, authorFollowers: data.user?.statsCount?.followedCount },
    links: [...(post.urlsInText ?? []).map(l => l.originalUrl || l.url), post.linkInfo?.originalLinkUrl || post.linkInfo?.linkUrl,
      ...(post.target?.urlsInText ?? []).map(l => l.originalUrl || l.url)], raw: post,
  }, target, "jike_public_page")).filter(Boolean);
}

export async function eachTarget(targets, fetchTarget) {
  const items = [], warnings = [], targetResults = [];
  const enabled = targets.filter(t => t.enabled !== false);
  for (let i = 0; i < enabled.length; i++) {
    const target = enabled[i];
    try {
      if (target.resolution === "needs_profile") throw fail("needs_target", "待核实作者主页 ID，不能用同名搜索结果替代");
      const result = await fetchTarget(target);
      const batch = Array.isArray(result) ? result : result.items;
      items.push(...batch);
      const dates = batch.map(i => i.collection.publishedAt).filter(Boolean).sort();
      const latestPublishedAt = dates.at(-1) || null;
      const stale = latestPublishedAt && Date.now() - Date.parse(latestPublishedAt) > 30 * 86400000;
      const partial = result.hasMore === true;
      targetResults.push({ targetId: target.id, name: target.name, status: batch.length ? (stale ? "stale" : "ok") : "empty",
        itemCount: batch.length, latestPublishedAt, hasMore: partial, coverage: result.coverage || "latest_page" });
      if (partial) warnings.push({ targetId: target.id, code: "pagination_remaining", message: "已达到本次页数上限，仍有更多内容；本次不是全历史采集" });
    } catch (error) {
      const code = error.code || "error";
      warnings.push({ targetId: target.id, code, message: error.message });
      targetResults.push({ targetId: target.id, name: target.name, status: code, itemCount: 0 });
      if (code === "rate_limited") {
        const skipped = enabled.slice(i + 1);
        for (const rest of skipped) {
          targetResults.push({ targetId: rest.id, name: rest.name, status: "skipped_rate_limit", itemCount: 0 });
        }
        if (skipped.length) {
          warnings.push({ code: "rate_limited", message: `上游限流，已跳过剩余 ${skipped.length} 个目标，避免继续打满配额` });
        }
        break;
      }
    }
  }
  return { items: [...new Map(items.map(i => [i.id, i])).values()], warnings, targetResults };
}

async function xTimeline(target, limit, fetcher) {
  if (!process.env.X_BEARER_TOKEN && process.env.X_MODE !== "api") {
    const response = await request(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(target.handle)}`, {}, fetcher);
    const items = parseXEmbed(await response.text(), target).sort((a, b) => (b.collection.publishedAt || "").localeCompare(a.collection.publishedAt || ""));
    return { items: items.slice(0, limit), coverage: "public_embed_curated_not_latest_timeline" };
  }
  if (!process.env.X_BEARER_TOKEN) throw fail("needs_key", "在本机 .env 配置 X_BEARER_TOKEN 并开通读取额度，或使用默认公开嵌入窗口");
  const headers = { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` };
  const lookup = await json(`https://api.x.com/2/users/by/username/${encodeURIComponent(target.handle)}?user.fields=public_metrics,description`, { headers }, fetcher);
  if (!lookup.data?.id) throw fail("invalid_response", "X 无法解析作者 ID");
  const items = [];
  let nextToken;
  const pages = Math.min(10, Math.max(1, Number(process.env.X_MAX_PAGES) || 1));
  for (let page = 0; page < pages; page++) {
    const url = new URL(`https://api.x.com/2/users/${lookup.data.id}/tweets`);
    url.searchParams.set("max_results", String(Math.max(5, Math.min(limit, 100))));
    url.searchParams.set("tweet.fields", "created_at,public_metrics,entities,referenced_tweets,author_id");
    if (nextToken) url.searchParams.set("pagination_token", nextToken);
    const data = await json(url.href, { headers }, fetcher);
    if (data.errors?.length) throw fail("upstream_error", "X 返回部分错误，请检查账号权限");
    if (!Array.isArray(data.data) && data.meta?.result_count !== 0) throw fail("invalid_response", "X timeline 格式不正确");
    for (const tweet of data.data ?? []) {
      items.push(rawItem("x", { id: tweet.id, url: `https://x.com/${target.handle}/status/${tweet.id}`, text: tweet.text,
        author: lookup.data.name, publishedAt: tweet.created_at, metrics: tweet.public_metrics,
        links: tweet.entities?.urls?.map(l => l.expanded_url), raw: tweet }, target, "x_api_v2"));
    }
    nextToken = data.meta?.next_token;
    if (!nextToken) break;
  }
  return { items: items.filter(Boolean), hasMore: Boolean(nextToken), coverage: "bounded_timeline_pages" };
}

export function parseXEmbed(html, target) {
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw fail("invalid_response", "X 嵌入页没有公开数据，需官方 API 或登录导入");
  const data = JSON.parse(match[1]).props?.pageProps;
  const entries = data?.timeline?.entries;
  if (!Array.isArray(entries) || !entries.length) throw fail("needs_login", "X 公开嵌入窗口不可用，需官方 API 或登录导入");
  return entries.filter(e => e.type === "tweet").map(e => {
    const r = e.content?.tweet;
    if (!r?.id_str || !r.user?.screen_name) return null;
    return rawItem("x", { id: r.id_str, url: `https://x.com/${r.user.screen_name}/status/${r.id_str}`, text: r.full_text || r.text,
      author: r.user.name, publishedAt: r.created_at,
      metrics: { likes: r.favorite_count, replies: r.reply_count, reposts: r.retweet_count, authorFollowers: r.user.followers_count },
      links: r.entities?.urls?.map(l => l.expanded_url), coverage: "public_embed_curated_not_latest_timeline", raw: r }, target, "x_public_embed");
  }).filter(Boolean);
}

export async function collectAcquisition(sourceId, limit = 12, fetcher = fetch, watchlist, collectOptions = parseCollectOptions({ limit }), intentKeywords = DEFAULT_INTENT_KEYWORDS) {
  const config = watchlist ?? await readWatchlist();
  limit = Math.min(100, Math.max(1, Number(collectOptions.limit ?? limit) || 12));
  const options = { ...parseCollectOptions({ limit }), ...collectOptions, limit };
  // Skip big-lab / incumbent handles so discovery stays on emerging OSS and startups.
  const targets = filterEmergingTargets(config[sourceId] ?? []);
  const fetchLimit = Math.min(100, limit * 3);
  const result = await eachTarget(targets, async target => {
    if (sourceId === "jike") {
      const response = await request(target.url, {}, fetcher);
      const items = parseJikePage(await response.text(), target);
      return { items: filterByTimeRange(items, options).slice(0, limit), hasMore: items.length > limit, coverage: "public_profile_page_only" };
    }
    if (sourceId === "feeds" || sourceId === "reddit") {
      const response = await request(target.url, { headers: { "User-Agent": "ai-news-research/0.2 (+local RSS reader)", Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml" } }, fetcher);
      const items = parseFeed(await response.text(), sourceId, target);
      const filtered = filterByTimeRange(items, options);
      return { items: filtered.slice(0, limit), hasMore: filtered.length > limit, coverage: "publisher_feed_window" };
    }
    if (sourceId === "x") {
      const timeline = await xTimeline(target, fetchLimit, fetcher);
      return { ...timeline, items: filterByTimeRange(timeline.items, options).slice(0, limit) };
    }
    if (sourceId === "github_kol") {
      if (isIncumbentGithubOrg(target.handle)) return { items: [], coverage: "skipped_incumbent" };
      const headers = { Accept: "application/vnd.github+json", "User-Agent": "ai-news-research" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const repos = await json(`https://api.github.com/users/${encodeURIComponent(target.handle)}/repos?sort=created&direction=desc&per_page=${fetchLimit}`, { headers }, fetcher);
      if (!Array.isArray(repos)) throw fail("invalid_response", "GitHub 仓库列表格式错误");
      const items = repos
        .filter(r => !r.fork && (r.stargazers_count ?? 0) <= 20000)
        .map(r => rawItem("github_kol", { id: r.id, title: r.full_name, text: r.description, url: r.html_url,
        author: target.handle, publishedAt: r.created_at, metrics: { stars: r.stargazers_count, forks: r.forks_count },
        links: [r.homepage], raw: r }, target, "github_author_repos")).filter(Boolean);
      return filterByTimeRange(items, options).slice(0, limit);
    }
    if (sourceId === "hf_spaces") {
      const params = new URLSearchParams({ sort: "likes", direction: "-1", limit: String(Math.min(fetchLimit, 100)) });
      if (target.handle) params.set("author", target.handle);
      const data = await json(`https://huggingface.co/api/spaces?${params}`, {}, fetcher);
      if (!Array.isArray(data)) throw fail("invalid_response", "Hugging Face Spaces 格式错误");
      const items = data
        .filter(r => !isIncumbentGithubOrg(r.author || r.id?.split("/")[0]))
        .map(r => rawItem("hf_spaces", { id: r.id, title: r.id, url: `https://huggingface.co/spaces/${r.id}`, text: r.cardData?.short_description,
        author: r.author || r.id?.split("/")[0], publishedAt: r.createdAt, metrics: { likes: r.likes }, raw: r }, target, "hf_spaces_api")).filter(Boolean);
      return filterByTimeRange(items, options).slice(0, limit);
    }
    if (sourceId === "producthunt") {
      if (!process.env.PRODUCTHUNT_TOKEN) throw fail("needs_key", "在本机 .env 设置 PRODUCTHUNT_TOKEN（官方开发者 token）");
      const data = await json("https://api.producthunt.com/v2/api/graphql", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.PRODUCTHUNT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: `query { posts(first: ${Math.min(fetchLimit, 50)}, order: NEWEST) { edges { node { id name tagline description url website createdAt votesCount commentsCount } } pageInfo { hasNextPage } } }` }),
      }, fetcher);
      if (data.errors?.length || !data.data?.posts?.edges) throw fail("upstream_error", "Product Hunt GraphQL 返回错误");
      const items = data.data.posts.edges.map(({ node: r }) => rawItem("producthunt", { id: r.id, title: r.name, text: `${r.tagline}\n${r.description}`, url: r.url,
        publishedAt: r.createdAt, metrics: { votes: r.votesCount, comments: r.commentsCount }, links: [r.website], raw: r }, target, "producthunt_api")).filter(Boolean);
      return { items: filterByTimeRange(items, options).slice(0, limit), hasMore: data.data.posts.pageInfo.hasNextPage };
    }
    throw fail("not_implemented", `尚未实现 ${sourceId}`);
  });
  const keywords = collectOptions.intentKeywords?.length ? collectOptions.intentKeywords : intentKeywords;
  return { ...result, items: applyIntentBatch(filterByTimeRange(result.items, options), keywords) };
}

export async function archiveCollection(items, run) {
  const root = path.join(process.cwd(), "data", "raw");
  await mkdir(root, { recursive: true });
  const counts = {};
  for (const item of items) {
    const source = item.collection?.sourceId;
    if (!/^[a-z0-9_]+$/.test(source || "")) continue;
    const record = { schemaVersion: 1, sourceId: source, id: item.id, urls: item.urls,
      content: item.content, facts: item.facts, collection: item.collection };
    const directory = path.join(root, source);
    await mkdir(directory, { recursive: true });
    const identity = hash(item.id).slice(0, 24);
    const version = hash(JSON.stringify({ content: item.content, raw: item.collection?.raw, facts: item.facts?.map(({ collectedAt, ...f }) => f) })).slice(0, 16);
    try {
      await writeFile(path.join(directory, `${identity}-${version}.json`), JSON.stringify({ ...record, collectedAt: item.lastSeenAt }, null, 2), { flag: "wx", mode: 0o600 });
      counts[source] = (counts[source] || 0) + 1;
    } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const directory = path.join(process.cwd(), "data", "runs");
  await mkdir(directory, { recursive: true });
  const report = { ...run, newSnapshots: counts };
  await writeFile(path.join(directory, `${run.id}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}
