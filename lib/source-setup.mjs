export const SETUP_FIELDS = {
  wechat: [
    { key: "wechatFeedIds", label: "公众号订阅 ID", type: "lines", placeholder: "all 或每行一个订阅 ID", hint: "默认 all=已订阅全部。在本页扫码授权即可。" },
  ],
  xiaohongshu: [
    { key: "xhsBaseUrl", label: "小红书 MCP 服务地址", type: "url", placeholder: "http://127.0.0.1:18060", hint: "本机 xiaohongshu-mcp 默认地址，不要加路径后缀。" },
    { key: "xhsKeywords", label: "搜索关键词", type: "lines", placeholder: "ai startup\nai github", hint: "每行一个词，至少 1 个。采集与定时任务共用此配置。" },
  ],
  zhihu: [
    { key: "rsshubBaseUrl", label: "作者订阅服务地址（热榜无需填写）", type: "url", placeholder: "http://127.0.0.1:1200" },
    { key: "routes.zhihu", label: "作者订阅路由（留空使用热榜）", type: "lines", placeholder: "https://www.zhihu.com/people/作者ID 或 /zhihu/..." },
    { key: "zhihuKeywords", label: "知乎标题与摘要关键词", type: "lines", placeholder: "每行一个词；留空采集全站热榜", hint: "筛选当前热榜，不是知乎全站搜索。" },
  ],
  jike: [
    { key: "rsshubBaseUrl", label: "RSSHub 服务地址（可选）", type: "url", placeholder: "留空则直接采公开主页" },
    { key: "routes.jike", label: "即刻订阅路由（可选）", type: "lines", placeholder: "https://web.okjike.com/u/用户ID" },
  ],
  douyin: [
    { key: "rsshubBaseUrl", label: "RSSHub 服务地址", type: "url", placeholder: "http://127.0.0.1:1200" },
    { key: "routes.douyin", label: "抖音博主路由", type: "lines", placeholder: "https://www.douyin.com/user/用户ID" },
    { key: "keywords", label: "关键词筛选（可选）", type: "lines" },
  ],
  bilibili: [
    { key: "rsshubBaseUrl", label: "RSSHub 服务地址", type: "url", placeholder: "http://127.0.0.1:1200" },
    { key: "routes.bilibili", label: "B站订阅路由", type: "lines", placeholder: "/bilibili/user/video/UID" },
    { key: "keywords", label: "关键词筛选（可选）", type: "lines" },
  ],
  "36kr": [
    { key: "rsshubBaseUrl", label: "RSSHub 服务地址", type: "url", placeholder: "http://127.0.0.1:1200" },
    { key: "routes.36kr", label: "36氪 RSSHub 路由", type: "lines", placeholder: "/36kr/newsflashes", defaults: ["/36kr/newsflashes", "/36kr/information/web_recommend"] },
    { key: "keywords", label: "关键词筛选（可选）", type: "lines", placeholder: "AI、智能体、大模型…" },
  ],
};

export const DEFAULT_ROUTES = {
  "36kr": ["/36kr/newsflashes", "/36kr/information/web_recommend"],
};

export function configGet(config, key) {
  if (key.startsWith("routes.")) {
    const routeId = key.split(".")[1];
    return (config.routes?.[routeId] ?? []).join("\n");
  }
  if (["keywords", "xhsKeywords", "wechatFeedIds", "zhihuKeywords"].includes(key)) return (config[key] ?? []).join("\n");
  return config[key] ?? "";
}

export function applySetupForm(config, formData, sourceId) {
  const next = {
    ...config,
    routes: { ...config.routes },
    keywords: [...(config.keywords ?? [])],
    xhsKeywords: [...(config.xhsKeywords ?? [])],
    wechatFeedIds: [...(config.wechatFeedIds ?? [])],
    zhihuKeywords: [...(config.zhihuKeywords ?? [])],
    sourceSettings: { ...config.sourceSettings },
  };
  const lines = (value) => String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const field of SETUP_FIELDS[sourceId] ?? []) {
    const raw = formData[field.key] ?? "";
    if (field.key.startsWith("routes.")) {
      const routeId = field.key.split(".")[1];
      next.routes[routeId] = lines(raw);
    } else if (["keywords", "xhsKeywords", "wechatFeedIds", "zhihuKeywords"].includes(field.key)) {
      next[field.key] = lines(raw);
    } else {
      next[field.key] = String(raw).trim();
    }
  }
  return next;
}
