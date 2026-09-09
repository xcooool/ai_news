import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const rssSourceIds = ["zhihu", "jike", "douyin", "bilibili", "36kr"];
export const domesticSourceIds = ["wechat", "xiaohongshu", ...rssSourceIds];
const file = () => path.join(process.cwd(), "data", "connectors.json");

export function defaultConnectors() {
  return {
    xhsBaseUrl: "", weweBaseUrl: "", rsshubBaseUrl: "",
    keywords: ["AI", "智能体", "大模型", "开源"],
    wechatFeedIds: ["all"],
    routes: Object.fromEntries(rssSourceIds.map(id => [id, []])),
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

export function validateConnectors(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("连接配置格式不正确。");
  const result = defaultConnectors();
  for (const key of ["xhsBaseUrl", "weweBaseUrl", "rsshubBaseUrl"]) {
    if (typeof input[key] !== "string" || input[key].length > 500) throw new Error(`${key} 格式不正确。`);
    result[key] = serviceUrl(input[key].trim());
  }
  for (const key of ["keywords", "wechatFeedIds"]) {
    const values = input[key];
    if (!Array.isArray(values) || values.length > 10 || values.some(v => typeof v !== "string" || !v.trim() || v.length > 100)) {
      throw new Error(`${key} 须为最多 10 个非空文本。`);
    }
    result[key] = [...new Set(values.map(v => v.trim()))];
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

export function connectorReadiness(id, config) {
  if (id === "xiaohongshu") return config.xhsBaseUrl && config.keywords.length ? "configured" : "needs_setup";
  if (id === "wechat") return config.weweBaseUrl && config.wechatFeedIds.length ? "configured" : "needs_setup";
  return config.rsshubBaseUrl && config.routes[id]?.length ? "configured" : "needs_setup";
}

export function catalogWithConnections(catalog, config, runs = []) {
  return catalog.map(source => {
    if (!domesticSourceIds.includes(source.id)) return source;
    const configured = connectorReadiness(source.id, config);
    const latest = runs.find(run => run.sourceResults?.some(result => result.sourceId === source.id));
    const result = latest?.sourceResults.find(result => result.sourceId === source.id);
    return { ...source, status: configured, connection: result ? {
      state: result.status, itemCount: result.itemCount, at: latest.finishedAt,
    } : { state: "not_tested" } };
  });
}
