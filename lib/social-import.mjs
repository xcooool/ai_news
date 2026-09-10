import { rawItem, fail } from "./acquisition.mjs";

export function parseSocialExport(body, sourceId) {
  if (!["x", "xiaohongshu", "douyin", "bilibili", "weibo", "zhihu", "wechat", "jike"].includes(sourceId)) throw fail("invalid_source", "不支持的社交导入来源");
  let data;
  try { data = JSON.parse(body); } catch {
    data = body.split(/\r?\n/).filter(l => l.trim()).map((line, i) => {
      try { return JSON.parse(line); } catch { throw fail("invalid_json", `JSONL 第 ${i + 1} 行格式错误`); }
    });
  }
  const records = Array.isArray(data) ? data : data.data?.aweme_list ?? data.aweme_list ?? data.items ?? data.data;
  if (!Array.isArray(records)) throw fail("invalid_response", "需要 JSON 数组、JSONL 或包含 aweme_list/items 的对象");
  const items = [], errors = [];
  for (const [index, r] of records.entries()) {
    const id = r.id_str || r.note_id || r.aweme_id || r.video_id || r.bvid || r.id;
    const author = typeof r.author === "string" ? r.author : r.author?.nickname || r.nickname || r.user?.username || r.user?.screen_name || r.user?.nickname;
    let url = r.url || r.note_url || r.aweme_url || r.video_url || r.article_url || r.link;
    if (!url && sourceId === "x" && id && author) url = `https://x.com/${author}/status/${id}`;
    if (!url && sourceId === "douyin" && id) url = `https://www.douyin.com/video/${id}`;
    if (!url && sourceId === "bilibili" && r.bvid) url = `https://www.bilibili.com/video/${r.bvid}`;
    if (!url && sourceId === "xiaohongshu" && id) url = `https://www.xiaohongshu.com/explore/${id}`;
    let date = r.date || r.created_at || r.create_time || r.time || r.publish_time || r.updated;
    if (typeof date === "number" || /^\d{10,13}$/.test(String(date))) date = new Date(Number(date) * (Number(date) < 1e12 ? 1000 : 1)).toISOString();
    const item = rawItem(sourceId, { id, url, title: r.title || r.name, text: r.rawContent || r.full_text || r.text || r.desc || r.content,
      author, publishedAt: date, metrics: r.statistics || { likes: r.likeCount ?? r.liked_count, comments: r.replyCount ?? r.comment_count, reposts: r.retweetCount ?? r.share_count },
      links: r.links?.map(l => typeof l === "string" ? l : l.url), raw: r }, { id: "external-export", name: author || "外部采集导入" }, "external_json_export");
    if (item) items.push(item); else errors.push({ index, code: "missing_url", message: "无法确定原文地址，未导入" });
  }
  return { items, errors };
}
