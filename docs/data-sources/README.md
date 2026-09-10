# 数据源与 API 申请指南

| 来源 | 状态 | Env | 申请/文档 | 当前可得范围 | 限制 |
| --- | --- | --- | --- | --- | --- |
| GitHub | 已实现可采集 | `GITHUB_TOKEN` 可选 | https://docs.github.com/en/rest/search/search | repository 搜索、star、fork、created/pushed 时间 | star/fork 不是用户、收入或下游集成 |
| Hacker News / Show HN | 已实现可采集 | 无 | https://github.com/HackerNews/API 与 HN Algolia | story 搜索、points、comments、URL | points/comments 只是早期兴趣 |
| Hugging Face | 已实现可采集 | `HF_TOKEN` 可选 | https://huggingface.co/docs/hub/api | 模型搜索、downloads、likes | downloads 需排除批量实验下载 |
| Product Hunt | 缺 API key | `PRODUCTHUNT_TOKEN` | https://www.producthunt.com/v2/oauth/applications | launch、upvotes、comments | 登录 Product Hunt → API dashboard 创建应用 → 复制 Developer token 到 `.env`；launch 热度不等于留存 |
| Reddit | 缺 API key | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | https://www.reddit.com/dev/api/ | subreddit/post/comment | OAuth、速率限制、营销噪声 |
| X / Twitter | 需商业授权 | `X_BEARER_TOKEN` | https://developer.x.com/en/docs | tweet/search/engagement，取决于套餐 | 成本和反爬限制高，bot/转发噪声高 |
| 微信公众号文章 | 自动适配已实现，待服务配置 | 无 | https://github.com/cooderl/wewe-rss | 订阅公众号 JSON Feed、正文与 URL | 首次登录与订阅；部分请求经上游第三方中转 |
| 小红书 | 自动适配已实现，待扫码 | `XHS_MCP_TOKEN` 可选 | https://github.com/xpzouying/xiaohongshu-mcp | 搜索、笔记详情、互动、签名原文链接 | 需启动服务和扫码；登录过期/限流会报错 |
| 抖音 | RSSHub 自动适配已实现 | 在服务端配置 | https://github.com/DIYgod/RSSHub/tree/master/lib/routes/douyin | 博主订阅 | 需要浏览器；未在本机实采验证 |
| B站 | RSSHub 自动适配已实现 | 在服务端配置 | https://github.com/DIYgod/RSSHub/tree/master/lib/routes/bilibili | 已配置的订阅路由 | 具体路由未在本机实采验证 |
| 即刻 | RSSHub 自动适配已实现 | 无 | https://github.com/DIYgod/RSSHub/tree/master/lib/routes/jike | 圈子、用户动态 | 需目标 ID；网页变化可能影响路由 |
| 知乎 | RSSHub 自动适配已实现 | RSSHub 的 `ZHIHU_COOKIES` 按需 | https://github.com/DIYgod/RSSHub/tree/master/lib/routes/zhihu | 作者回答等订阅 | 平台访问限制；已配置不代表已登录 |
| 36氪 / 创投媒体 | RSSHub 自动适配已实现 | 无 | https://github.com/DIYgod/RSSHub/tree/master/lib/routes/36kr | 新闻订阅、关键词筛选 | 具体路由未在本机实采验证 |
| 投资机构 / 孵化器项目名单 | 可手动导入 | 无 | https://www.ycombinator.com/companies | 批次、公司名单、简介 | 入选不能单独证明产品成立 |
| 公司 / 产品官网 | 可手动导入 | 无 | 各官网 | 定位、客户、价格、API 文档 | 公司自述，默认可信度低于事实 |
| 更新日志 / API 文档 | 可手动导入 | 无 | 各产品文档 | 更新频率、接口、能力 | 证明交付，不证明需求 |
| 招聘页 | 可手动导入 | 无 | 各招聘页 | 岗位方向、团队扩张 | 不能直接推导营收 |
| App Store / Chrome 扩展商店 | 可手动导入 | 无 | https://chromewebstore.google.com/ | 评分、评论、安装区间 | 第一版不自动采集 |
| 流量 / 融资数据供应商 | 需商业授权 | `SIMILARWEB_API_KEY`, `CRUNCHBASE_API_KEY` | https://developer.similarweb.com/ | 流量估算、融资、公司图谱 | 第三方估算须标注，不当事实 |

## 接入优先级

1. 立即可用：GitHub、Hacker News、Hugging Face、手动导入。
2. 需要 key：Product Hunt、Reddit。
3. 需要商业授权或合规评估：X、Similarweb、Crunchbase、PitchBook 等。
4. 国内自动采集：先部署对应服务并登录，再配置订阅或搜索词。详见 [调研与接入指南](../domestic-automation.md)。

## 数据标注要求

每条证据至少保留 `sourceId`、`url`、`collectedAt`、`credibility`、`metric`、`normalization`。外部数字必须区分事实、公司自述、第三方估算、模型推断。没有历史数据时不生成趋势线。
