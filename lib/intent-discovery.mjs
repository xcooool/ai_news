/** Search-intent collection: OSS / startup candidates vs hotnews noise. */

import { hasEmergingProjectAnchor, isIncumbentGithubOrg } from "./discovery.mjs";

export const DEFAULT_INTENT_KEYWORDS = [
  "ai github",
  "ai hot github",
  "ai startup",
  "ai startup hiring",
  "github.com",
  "开源项目",
  "开源仓库",
  "创业团队",
  "startup hiring",
  "hiring",
  "融资",
  "团队",
];

/** 知乎热榜 / 小红书搜索：无项目锚点的纯 hotnews 不进库（即刻 curated 作者保留命中关键词的分享） */
const STRICT_HOTNEWS_SOURCES = new Set(["zhihu", "xiaohongshu"]);

const JIKE_KEYWORD_EXTRAS = ["agent", "llm", "rag", "copilot", "智能体", "大模型", "开源", "发布", "产品", "融资"];
const X_KEYWORD_EXTRAS = ["agent", "launch", "open source", "startup", "hiring", "github"];

export const HN_INTENT_QUERIES = [
  "AI startup",
  "AI github",
  "AI startup hiring",
  "Show HN AI",
];

const SOCIAL_SOURCES = new Set(["jike", "x", "xiaohongshu", "zhihu", "feeds", "wechat", "reddit", "36kr"]);
/** Paid / curated author timelines: keep every fetched tweet; filter only at analysis stage. */
const FULL_RETENTION_SOURCES = new Set(["x"]);
const OSS_SOURCES = new Set(["github", "github_kol", "huggingface", "hf_spaces"]);
const PRODUCT_HOSTS = new Set([
  "news.ycombinator.com",
  "github.com",
  "x.com",
  "twitter.com",
  "m.okjike.com",
  "web.okjike.com",
  "www.xiaohongshu.com",
  "xiaohongshu.com",
]);

export function normalizeIntentKeywords(keywords) {
  const list = keywords?.length ? keywords : DEFAULT_INTENT_KEYWORDS;
  return [...new Set(list.map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

export function intentKeywordsForSource(sourceId, keywords = DEFAULT_INTENT_KEYWORDS) {
  const base = normalizeIntentKeywords(keywords);
  if (sourceId === "jike") return [...new Set([...base, ...JIKE_KEYWORD_EXTRAS.map((k) => k.toLowerCase())])];
  if (sourceId === "x") return [...new Set([...base, ...X_KEYWORD_EXTRAS.map((k) => k.toLowerCase())])];
  return base;
}

export function matchesIntentKeywords(text, keywords = DEFAULT_INTENT_KEYWORDS) {
  const haystack = String(text ?? "").toLowerCase();
  if (!haystack.trim()) return false;
  return normalizeIntentKeywords(keywords).some((keyword) => {
    if (keyword.includes(" ")) return haystack.includes(keyword);
    if (/^[a-z0-9./-]+$/i.test(keyword)) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(keyword.includes(".") ? escaped : `\\b${escaped}\\b`, "i").test(haystack);
    }
    return haystack.includes(keyword);
  });
}

export function githubIntentQueries({ days = 90, minStars = 3, maxStars = 3000 } = {}) {
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * days).toISOString().slice(0, 10);
  const excludes = ["openai", "microsoft", "google", "meta-llama", "huggingface", "anthropics", "deepseek-ai", "langchain-ai", "qwenlm", "bytedance", "tencent", "alibaba"]
    .map((org) => `-org:${org}`)
    .join(" ");
  const band = `created:>${since} stars:${minStars}..${maxStars} fork:false ${excludes}`;
  return [
    `(agent OR llm OR ai OR rag OR multimodal OR copilot) ${band}`,
    `"open source" ${band}`,
    `(ai startup OR "ai github" OR "startup hiring") ${band}`,
  ];
}

function githubRepoInText(text) {
  return [...String(text ?? "").matchAll(/https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)/gi)]
    .some((match) => !isIncumbentGithubOrg(match[1]));
}

function githubRepoInLinks(links = []) {
  return links.some((url) => /github\.com\/[\w.-]+\/[\w.-]+/i.test(url) && !isIncumbentGithubOrg(url));
}

function isShowHnItem(item = {}) {
  const title = item.collection?.originalTitle || item.name || "";
  return item.collection?.sourceId === "hackernews" && /^show hn:/i.test(title);
}

function isHiringSignal(text) {
  return /\b(hiring|recruiting|we're hiring|join us|careers?|jobs?)\b/i.test(text)
    || /招聘|招人|joining|hiring/i.test(text);
}

function hasProductSite(links = []) {
  return links.some((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      return !PRODUCT_HOSTS.has(host) && !host.endsWith(".github.io");
    } catch {
      return false;
    }
  });
}

export function classifyItemType(item = {}) {
  const sourceId = item.collection?.sourceId;
  const text = `${item.name ?? ""} ${item.tagline ?? ""} ${item.content?.text ?? ""}`;
  const links = [...(item.urls ?? []), ...(item.collection?.outboundLinks ?? [])];

  if (OSS_SOURCES.has(sourceId)) return "open_source";
  if (sourceId === "producthunt") return "startup";

  const githubAnchor = githubRepoInLinks(links) || githubRepoInText(text);
  if (githubAnchor || (sourceId === "hackernews" && /github|open source|oss/i.test(text))) {
    return "open_source";
  }

  if (isShowHnItem(item) && (hasProductSite(links) || githubAnchor)) {
    return hasProductSite(links) && !githubAnchor ? "startup" : githubAnchor ? "open_source" : "startup";
  }
  if (["yc"].includes(sourceId) || item.collection?.entityVerified || item.collection?.mode === "manual_import") {
    return item.type === "open_source" ? "open_source" : "startup";
  }
  if (hasEmergingProjectAnchor(item)) {
    return githubAnchor ? "open_source" : "startup";
  }
  if (isHiringSignal(text) && matchesIntentKeywords(text) && hasProductSite(links)) return "startup";

  return "hotnews";
}

export function applyIntentClassification(item, keywords = DEFAULT_INTENT_KEYWORDS) {
  const text = `${item.name ?? ""} ${item.tagline ?? ""} ${item.content?.text ?? ""}`;
  const sourceId = item.collection?.sourceId;
  const anchored = hasEmergingProjectAnchor(item) || OSS_SOURCES.has(sourceId) || sourceId === "producthunt";
  const scopedKeywords = intentKeywordsForSource(sourceId, keywords);

  if (
    SOCIAL_SOURCES.has(sourceId)
    && !FULL_RETENTION_SOURCES.has(sourceId)
    && !anchored
    && !matchesIntentKeywords(text, scopedKeywords)
  ) {
    return null;
  }

  const type = classifyItemType(item);
  if (STRICT_HOTNEWS_SOURCES.has(sourceId) && type === "hotnews" && !anchored) {
    return null;
  }
  const stage = type === "hotnews"
    ? "热点资讯 / 待关联项目"
    : type === "open_source"
      ? "开源候选"
      : "创业候选";
  return { ...item, type, stage };
}

export function applyIntentBatch(items = [], keywords = DEFAULT_INTENT_KEYWORDS) {
  return items.map((item) => applyIntentClassification(item, keywords)).filter(Boolean);
}
