import { eachTarget, request, rawItem, parseFeed, collectAcquisition, fail } from "./acquisition.mjs";
import { isStaleStartup } from "./discovery.mjs";
import { collectXiaohongshu } from "./domestic-collectors.mjs";
import { defaultConnectors, readConnectors } from "./connectors.mjs";
import { parseSocialExport } from "./social-import.mjs";
import { collectZhihuHot } from "./zhihu.mjs";

export const providerCatalog = [
  { id: "newsnow", name: "NewsNow / TrendRadar 热榜", project: "https://github.com/newsnext/newsnow", baseUrl: "https://newsnow.busiyi.world", sample: "zhihu\ndouyin\nbilibili-hot-search\nweibo", targetLabel: "平台 ID，每行一个", description: "国内多平台热榜服务。知乎直接读取官方热榜，使用来源配置中的知乎关键词，不依赖本服务的连接状态。", setup: "可用公开服务或自部署 NewsNow。公开实例可能限流/403，可在此替换服务地址。", healthPath: "/api/s?id=weibo" },
  { id: "rsshub", name: "RSSHub 多平台订阅", project: "https://github.com/DIYgod/RSSHub", baseUrl: "http://127.0.0.1:1200", sample: "/jike/user/0ae2afa7-9b10-4b3a-ab7e-15fbf847038d", targetLabel: "RSSHub 路由，每行一个", description: "复用 RSSHub 的即刻、B站、知乎、X 等订阅路由。", setup: "启动 RSSHub；需要登录的路由，在 RSSHub 服务端配置对应 Cookie/Token。", healthPath: "/healthz" },
  { id: "werss", name: "WeRSS 微信公众号", project: "https://github.com/rachelos/we-mp-rss", baseUrl: "http://127.0.0.1:8001", sample: "all", targetLabel: "公众号订阅 ID（all 代表已订阅全部）", description: "本机 WeRSS 随 npm run dev 自动启动。请在主站扫码授权微信，再按订阅 ID 读 Feed。", setup: "无需打开 WeRSS 登录页。在主站或本页点「扫码登录」用微信授权；订阅范围填 all 或具体 ID。", healthPath: "/" },
  { id: "xiaohongshu", name: "小红书 MCP", project: "https://github.com/xpzouying/xiaohongshu-mcp", baseUrl: "http://127.0.0.1:18060", sample: "ai startup\nai github", targetLabel: "搜索词，每行一个", description: "复用小红书 MCP 的只读 REST 搜索/详情 API。", setup: "启动服务后获取二维码，用小红书 App 扫码。健康检查成功不代表账号已登录。", healthPath: "/health", loginPath: "/api/v1/login/qrcode" },
  { id: "douyin", name: "抖音数据 API", project: "https://github.com/Evil0ctal/Douyin_TikTok_Download_API", baseUrl: "http://127.0.0.1:8002", sample: "", targetLabel: "作者主页链接或 sec_user_id，每行一个", description: "复用 Douyin_TikTok_Download_API，按作者读取视频元数据。", setup: "在上游服务配置自己的 Cookie；任务目标填作者主页。接口文档可在服务页打开。", healthPath: "/openapi.json", loginPath: "/docs" },
  { id: "codenexus", name: "AI-CodeNexus API", project: "https://github.com/yunlongwen/AI-CodeNexus", baseUrl: "http://127.0.0.1:8000", sample: "news\ntools", targetLabel: "资源名称：news、ai-news 或 tools", description: "兼容现有 AI-CodeNexus 部署，分页同步资讯和工具元数据。", setup: "该项目已归档。连接你已有的部署；其爬虫及定时更新仍由上游管理。", healthPath: "/api/news?page=1&page_size=1" },
  { id: "yc", name: "YC 开源公司 API", project: "https://github.com/yc-oss/api", baseUrl: "https://yc-oss.github.io/api", sample: "tags/artificial-intelligence.json", targetLabel: "数据集路径，每行一个", description: "复用 yc-oss 每日更新的公开公司目录，作为 startup 来源。只保留 Active 且近四年批次，排除 Inactive / Acquired / Public。", setup: "无需登录；这是社区整理的 YC 公开目录，不包含未公开公司。历史已退出公司不会当作潜力候选。", healthPath: "/meta.json" },
  { id: "feeds", name: "RSS / Atom / JSON Feed", project: "https://github.com/NaturalIntelligence/fast-xml-parser", baseUrl: "", sample: "https://www.qbitai.com/feed\nhttps://techcrunch.com/category/artificial-intelligence/feed/", targetLabel: "订阅 URL，每行一个", description: "用标准 Feed 解析器接入媒体、博客、Newsletter 和其他采集器的输出。", setup: "填写完整订阅 URL。这里不做关键词过滤。" },
  { id: "builtin", name: "已有 GitHub / HN / HF / X", project: "", baseUrl: "", sample: "github\nhackernews\nhuggingface\nhf_spaces", targetLabel: "已有数据源 ID，每行一个", description: "将项目已有 API 适配器纳入统一任务调度。", setup: "支持 github、hackernews、huggingface、hf_spaces、github_kol、jike、x、reddit、producthunt。X 实时时间线需要官方 API 凭证；公开窗口可能陈旧。" },
];

const cleanTargets = task => task.targets.map((value, i) => ({ id: value, name: value, value, index: i }));
export async function collectProvider(task, settings, { fetcher = fetch, runCollectors } = {}) {
  const provider = providerCatalog.find(p => p.id === task.provider);
  const base = settings.baseUrl?.replace(/\/$/, "") || provider.baseUrl;
  const limit = task.limit;
  if (task.provider === "builtin") {
    const result = await runCollectors({ sources: task.targets, limit, fetcher });
    return { items: result.items, warnings: result.run.errors, targetResults: result.run.sourceResults.map(s => ({ ...s, targetId: s.sourceId, name: s.sourceId })) };
  }
  if (task.provider === "xiaohongshu") {
    return collectXiaohongshu({ ...defaultConnectors(), xhsBaseUrl: base, xhsKeywords: task.targets }, limit, fetcher);
  }
  return eachTarget(cleanTargets(task), async target => {
    if (["rsshub", "werss", "feeds"].includes(task.provider)) {
      const sourceId = task.provider === "werss" ? "wechat" : task.provider === "rsshub" ? ({ twitter: "x" }[target.value.split('/')[1]] || target.value.split('/')[1]) : "feeds";
      const url = task.provider === "feeds" ? target.value : task.provider === "werss" ? `${base}/feed/${encodeURIComponent(target.value)}.xml?limit=${limit}&is_update=false` : `${base}${target.value}${target.value.includes('?') ? '&' : '?'}format=json`;
      const response = await request(url, {}, fetcher);
      const all = parseFeed(await response.text(), sourceId, target);
      return { items: all.slice(0, limit), hasMore: all.length > limit, coverage: "upstream_feed_window" };
    }
    if (task.provider === "newsnow") {
      if (target.value === "zhihu") return collectZhihuHot(limit, fetcher, (await readConnectors()).zhihuKeywords);
      const response = await request(`${base}/api/s?id=${encodeURIComponent(target.value)}`, {}, fetcher);
      const data = await response.json();
      if (!["success", "cache"].includes(data.status) || !Array.isArray(data.items)) throw fail("invalid_response", "NewsNow 未返回有效榜单");
      const sourceId = { "bilibili-hot-search": "bilibili", "wallstreetcn-hot": "newsnow", "cls-hot": "newsnow" }[target.value] || target.value;
      return data.items.slice(0, limit).map((r, i) => rawItem(sourceId, { id: r.id || r.url, title: r.title, url: r.url || r.mobileUrl,
        text: r.extra?.info || r.extra?.hover || "", metrics: { rank: i + 1 }, coverage: "hotlist_metadata", raw: { ...r, upstreamStatus: data.status, upstreamUpdatedTime: data.updatedTime } }, target, "newsnow_api")).filter(Boolean);
    }
    if (task.provider === "yc") {
      const response = await request(`${base}/${target.value}`, {}, fetcher);
      const data = await response.json();
      if (!Array.isArray(data)) throw fail("invalid_response", "YC 目录响应不是数组");
      // Keep the full recent-active slice, not the first N rows of a historical dump.
      const kept = data.filter(r => !isStaleStartup({ collection: { raw: r } }));
      return { items: kept.map(r => rawItem("yc", { id: r.id || r.slug, title: r.name, text: r.long_description || r.one_liner,
        url: r.url || r.website, links: [r.website], raw: r, coverage: "active_recent_batches" }, target, "yc_oss_api")).filter(Boolean), coverage: "active_recent_batches" };
    }
    if (task.provider === "codenexus") {
      const items = [];
      let hasMore = false;
      for (let page = 1; page <= task.maxPages; page++) {
        const response = await request(`${base}/api/${target.value}?page=${page}&page_size=${limit}`, {}, fetcher);
        const data = await response.json();
        if (!Array.isArray(data.items)) throw fail("invalid_response", "AI-CodeNexus 响应缺少 items");
        items.push(...data.items.map(r => rawItem("codenexus", { id: `${target.value}:${r.id || r.url}`, title: r.title || r.name, url: r.url,
          text: r.summary || r.description, publishedAt: r.published_time, author: r.source,
          raw: r, coverage: "metadata_only" }, target, "codenexus_api")).filter(Boolean));
        hasMore = page < data.total_pages;
        if (!hasMore) break;
      }
      return { items, hasMore, coverage: "bounded_api_pages_metadata_only" };
    }
    if (task.provider === "douyin") {
      const userId = target.value.startsWith("https://") ? new URL(target.value).pathname.split('/').filter(Boolean).at(-1) : target.value;
      const response = await request(`${base}/api/douyin/web/fetch_user_post_videos?sec_user_id=${encodeURIComponent(userId)}&max_cursor=0&count=${Math.min(limit, 35)}`, {}, fetcher);
      const data = await response.json();
      if (data.code !== 200 || !Array.isArray(data.data?.aweme_list)) throw fail("needs_login", "抖音上游未返回视频列表，请检查服务 Cookie / 平台验证");
      const parsed = parseSocialExport(JSON.stringify(data.data), "douyin");
      return { items: parsed.items, hasMore: Boolean(data.data.has_more), coverage: "creator_latest_page" };
    }
    throw fail("not_implemented", "未知适配器");
  });
}
