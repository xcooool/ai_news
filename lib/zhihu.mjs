import { request, rawItem, fail } from "./acquisition.mjs";

export function matchesZhihuKeywords(item, keywords) {
  const text = `${item.name} ${item.content?.text || ""}`;
  return !keywords.length || keywords.some(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(/^[a-z0-9]+$/i.test(word) ? `\\b${escaped}\\b` : escaped, "i").test(text);
  });
}

export async function collectZhihuHot(limit = 20, fetcher = fetch, keywords = []) {
  const response = await request("https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true", {}, fetcher);
  let data;
  try { data = await response.json(); }
  catch { throw fail("invalid_response", "知乎热榜未返回 JSON"); }
  if (!Array.isArray(data.data)) throw fail("invalid_response", "知乎热榜响应缺少 data 数组");
  const items = data.data.map((entry, index) => {
    const target = entry.target;
    if (!target?.title_area?.text || !target?.link?.url) return null;
    return rawItem("zhihu", {
      id: target.link.url, url: target.link.url, title: target.title_area.text,
      text: target.excerpt_area?.text || "", metrics: { rank: index + 1 },
      coverage: "hotlist_metadata", raw: entry,
    }, { id: "zhihu", name: "知乎热榜" }, "zhihu_hot_api");
  }).filter(Boolean);
  if (data.data.length && !items.length) throw fail("invalid_response", "知乎热榜未返回可用的问题标题和链接");
  return { items: items.filter(item => matchesZhihuKeywords(item, keywords)).slice(0, limit), warnings: [] };
}
