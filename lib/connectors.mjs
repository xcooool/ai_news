import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { xhsLoginState } from "./xhs-auth.mjs";
import { werssLoginState } from "./werss-auth.mjs";
import { defaultSourceSettings, validateSourceSettings } from "./source-settings.mjs";

export const rssSourceIds = ["zhihu", "jike", "douyin", "bilibili", "36kr"];
export const domesticSourceIds = ["wechat", "xiaohongshu", ...rssSourceIds];
const file = () => path.join(process.cwd(), "data", "connectors.json");

export function defaultConnectors() {
  return {
    xhsBaseUrl: "", weweBaseUrl: "", rsshubBaseUrl: "",
    keywords: ["ai github", "ai hot github", "ai startup", "ai startup hiring", "github.com", "开源项目", "创业团队", "融资", "团队"],
    xhsKeywords: ["ai github", "ai hot github", "ai startup", "ai startup hiring", "github.com", "开源项目", "创业团队"],
    zhihuKeywords: ["ai github", "ai hot github", "ai startup", "ai startup hiring", "github.com", "开源项目", "创业团队", "融资"],
    wechatFeedIds: ["all"],
    routes: Object.fromEntries(rssSourceIds.map(id => [id, []])),
    sourceSettings: defaultSourceSettings(),
  };
}

export function serviceUrl(value) {
  if (value === "") return "";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("服务地址须为不含密码、查询参数的 HTTP(S) 地址。");
  }
  return url.href.replace(/\/$/, "");
}

function upgradeLegacyKeywordList(values, fallback) {
  if (!Array.isArray(values) || !values.length) return fallback;
  const trimmed = values.map((value) => String(value).trim()).filter(Boolean);
  const lowered = trimmed.map((value) => value.toLowerCase());
  const legacyTokens = new Set(["ai", "agent", "llm", "开源", "智能体", "大模型", "open source"]);
  const looksLegacy = lowered.length <= 8
    && lowered.every((token) => legacyTokens.has(token))
    && !lowered.some((token) => token.includes("github") || token.includes("startup"));
  if (looksLegacy) return [...new Set([...fallback, ...trimmed])];
  return trimmed;
}

export function validateConnectors(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("连接配置格式不正确。");
  const result = defaultConnectors();
  for (const key of ["xhsBaseUrl", "weweBaseUrl", "rsshubBaseUrl"]) {
    if (typeof input[key] !== "string" || input[key].length > 500) throw new Error(`${key} 格式不正确。`);
    result[key] = serviceUrl(input[key].trim());
  }
  for (const key of ["keywords", "xhsKeywords", "wechatFeedIds", "zhihuKeywords"]) {
    const values = input[key] ?? (key === "zhihuKeywords" || key === "xhsKeywords" ? result[key] : undefined);
    if (!Array.isArray(values) || values.length > 10 || values.some(v => typeof v !== "string" || !v.trim() || v.length > 100)) {
      throw new Error(`${key} 须为最多 10 个非空文本。`);
    }
    const fallback = result[key];
    result[key] = [...new Set(upgradeLegacyKeywordList(values, fallback))];
  }
  if (result.wechatFeedIds.some(id => !/^[\w-]+$/.test(id))) throw new Error("公众号订阅 ID 格式不正确。");
  for (const id of rssSourceIds) {
    const values = input.routes?.[id] ?? [];
    if (!Array.isArray(values)) throw new Error(`${id} 订阅目标须为列表。`);
    const routes = values.map(value => subscriptionRoute(id, value));
    if (!Array.isArray(routes) || routes.length > 10 || routes.some(route => {
      if (typeof route !== "string" || route.length > 400 || !route.startsWith(`/${id}/`)) return true;
      const url = new URL(route, "http://routes.local");
      return url.origin !== "http://routes.local" || !url.pathname.startsWith(`/${id}/`) || url.hash || /[\\\s]/.test(route);
    })) throw new Error(`${id} 路由应以 /${id}/ 开头，最多 10 条。`);
    result.routes[id] = [...new Set(routes)];
  }
  result.sourceSettings = validateSourceSettings(input.sourceSettings);
  return result;
}

export function subscriptionRoute(id, value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return value;
  const url = new URL(value);
  if (url.username || url.password) throw new Error("订阅主页不能包含密码。");
  const parts = url.pathname.split("/").filter(Boolean);
  if (id === "zhihu" && ["www.zhihu.com", "zhihu.com"].includes(url.hostname) && parts[0] === "people" && parts[1]) {
    return `/zhihu/people/answers/${encodeURIComponent(decodeURIComponent(parts[1]))}`;
  }
  if (id === "jike" && ["web.okjike.com", "m.okjike.com"].includes(url.hostname) && parts[1]) {
    const kind = { u: "user", users: "user", topic: "topic", topics: "topic" }[parts[0]];
    if (kind) return `/jike/${kind}/${encodeURIComponent(decodeURIComponent(parts[1]))}`;
  }
  if (id === "douyin" && ["www.douyin.com", "douyin.com"].includes(url.hostname) && parts[0] === "user" && parts[1]) {
    return `/douyin/user/${encodeURIComponent(decodeURIComponent(parts[1]))}`;
  }
  throw new Error(`${id} 暂不识别这个主页链接，请使用作者/圈子主页或 RSSHub 路由。`);
}

export async function readConnectors() {
  let input = defaultConnectors();
  try { input = JSON.parse(await readFile(file(), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return validateConnectors(input);
}

export async function saveConnectors(input) {
  const config = validateConnectors(input);
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

export const defaultRssHubRoutes = {
  "36kr": ["/36kr/newsflashes", "/36kr/information/web_recommend"],
  zhihu: [],
  jike: [],
  douyin: [],
  bilibili: [],
};

export function describeSetup(id, config) {
  if (id === "zhihu" && !config.routes.zhihu?.length) return { missing: [], hint: "默认直接采集知乎公开热榜的标题、摘要和链接；作者回答可配置 RSSHub 订阅路由。" };
  if (id === "xiaohongshu") {
    const missing = [];
    if (!config.xhsBaseUrl) missing.push("小红书 MCP 服务地址");
    if (!config.xhsKeywords.length) missing.push("搜索关键词");
    return { missing, hint: missing.length ? "部署 xiaohongshu-mcp 并扫码登录后填写地址。" : "已就绪，勾选来源后点「采集新数据」。" };
  }
  if (id === "wechat") {
    const missing = [];
    if (!config.weweBaseUrl && !process.env.WERSS_BASE_URL) missing.push("公众号服务地址");
    if (!config.wechatFeedIds.length) missing.push("公众号订阅 ID");
    return {
      missing,
      hint: missing.length
        ? "npm run dev 会自动启动本机 WeRSS；在本站扫码授权后填写订阅 ID（all 或单个 ID）。"
        : "已就绪。请在本站扫码授权；订阅范围用 wechatFeedIds（默认 all）。",
    };
  }
  if (id === "jike") {
    return { missing: [], hint: "即刻公开主页可直接采集，无需 RSSHub。可选填 RSSHub 路由扩展订阅。" };
  }
  if (id === "feeds") {
    return { missing: [], hint: "勾选即用。内置 36氪、a16z、Sequoia、YC 等 RSS，点「采集新数据」拉取。" };
  }
  if (id === "yc") {
    return { missing: [], hint: "勾选即用。yc-oss AI 公司目录，无需 key；一键采集会拉取全部近四年 Active 公司。" };
  }
  if (rssSourceIds.includes(id)) {
    const missing = [];
    if (!config.rsshubBaseUrl) missing.push("RSSHub 服务地址");
    if (!config.routes[id]?.length) missing.push(`${id} 订阅路由`);
    if (id === "36kr" && missing.length) {
      return {
        missing,
        hint: "需 RSSHub。若只要 36氪/a16z 等官方 RSS，请勾选「媒体 RSS」——无需此项。",
      };
    }
    return {
      missing,
      hint: missing.length
        ? "部署 RSSHub 后填写服务地址与订阅路由。"
        : "已就绪，勾选来源后点「采集新数据」。",
    };
  }
  return { missing: [], hint: "勾选后点「采集新数据」即可。" };
}

export function connectorReadiness(id, config) {
  if (id === "zhihu" && !config.routes.zhihu?.length) return "configured";
  if (id === "wechat" && process.env.WERSS_BASE_URL) return "configured";
  if (id === "douyin" && process.env.DOUYIN_API_BASE_URL) return "configured";
  if (id === "xiaohongshu") return config.xhsBaseUrl && config.xhsKeywords.length ? "configured" : "needs_setup";
  if (id === "wechat") return config.weweBaseUrl && config.wechatFeedIds.length ? "configured" : "needs_setup";
  return config.rsshubBaseUrl && config.routes[id]?.length ? "configured" : "needs_setup";
}

export function catalogWithConnections(catalog, config, runs = []) {
  return catalog.map(source => {
    let configured = source.id === "jike" ? "implemented" : domesticSourceIds.includes(source.id) ? connectorReadiness(source.id, config) : source.status;
    // Product Hunt truly needs a token; expose as ready only when present so「全选」会采它。
    if (source.id === "producthunt") {
      configured = process.env.PRODUCTHUNT_TOKEN ? "implemented" : "needs_key";
    }
    const latest = runs.find(run => run.sourceResults?.some(result => result.sourceId === source.id));
    const result = latest?.sourceResults.find(result => result.sourceId === source.id);
    const setup = domesticSourceIds.includes(source.id) || source.id === "feeds" || source.id === "yc"
      ? describeSetup(source.id, config)
      : null;
    return { ...source, status: configured, setup, connection: result ? {
      state: result.status, itemCount: result.itemCount, at: latest.finishedAt,
    } : { state: "not_tested" } };
  });
}

export async function withXhsLogin(sources, loginState) {
  const login = loginState ?? (await xhsLoginState());
  const payload = {
    loggedIn: Boolean(login.loggedIn),
    savedAt: login.savedAt || null,
    reason: login.reason || null,
  };
  return sources.map((source) => (source.id === "xiaohongshu" ? { ...source, login: payload } : source));
}

export async function withWechatLogin(sources, loginState) {
  const login = loginState ?? (await werssLoginState());
  const payload = {
    loggedIn: Boolean(login.loggedIn),
    reason: login.reason || null,
  };
  return sources.map((source) => (source.id === "wechat" ? { ...source, login: payload } : source));
}
