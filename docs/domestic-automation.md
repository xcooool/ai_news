# 国内内容自动采集

调研日期：2026-09-09。适配代码已纳入本项目，外部采集服务独立运行，通过 HTTP / JSON Feed 接入。

## 选择与范围

| 平台 | 接入项目 | 自动化范围 | 初次设置与限制 |
| --- | --- | --- | --- |
| 小红书 | [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) | 关键词搜索、笔记正文、作者、互动指标、可打开的签名原文链接 | 启动 MCP 服务、扫码；登录过期需重新登录；不调用发布、点赞或评论接口 |
| 微信公众号 | [cooderl/wewe-rss](https://github.com/cooderl/wewe-rss) | 从已订阅公众号自动同步 JSON Feed，保留正文与原文 | 扫码微信读书并添加公众号；不是全微信搜索；上游部分请求经过其第三方中转服务 |
| 知乎 | 知乎公开热榜 API；可选 RSSHub 作者订阅 | 默认读取热榜问题标题、摘要、排名和链接，不包含回答全文 | 无订阅路由时直接读热榜；填写作者路由后使用 RSSHub，可能需要 `ZHIHU_COOKIES` |
| 即刻 | [RSSHub 即刻路由](https://github.com/DIYgod/RSSHub/tree/master/lib/routes/jike) | 圈子或用户动态自动同步 | 配置圈子/用户 ID；读取移动网页，页面变化可能使路由失效 |
| 抖音 | [RSSHub 抖音路由](https://github.com/DIYgod/RSSHub/tree/master/lib/routes/douyin) | 已配置博主订阅 | 需要带浏览器的 RSSHub，UID 来自用户主页；不能保证平台验证总是通过 |
| B站 | [RSSHub B站路由](https://github.com/DIYgod/RSSHub/tree/master/lib/routes/bilibili) | 已配置订阅路由 | 根据目标在上游路由目录选取，具体路由尚未在本环境实采验证 |
| 36氪 | [RSSHub 36氪路由](https://github.com/DIYgod/RSSHub/tree/master/lib/routes/36kr) | 新闻订阅与本地关键词筛选 | 根据上游路由目录配置，具体路由尚未在本环境实采验证 |

RSSHub 输出使用其 [JSON Feed 实现](https://github.com/DIYgod/RSSHub/blob/master/lib/views/json.ts)，请求带 `format=json`。微信公众号使用 WeWe 文档定义的 `/feeds/all.json` 或 `/feeds/订阅ID.json`。本项目无需额外安装 RSS/XML 解析包。

## Skills 与其他候选

已检索 skills.sh，并尝试 `npx skills find xiaohongshu`；本机 CLI 网络请求无结果，已停止。网页搜索找到的 `write-xiaohongshu` 偏内容创作，封面生成 skill 偏图片；它们不解决无人值守采集，因此未安装。

[DeliciousBuding/xiaohongshu-skill](https://github.com/DeliciousBuding/xiaohongshu-skill) 提供 Playwright 搜索能力，可作为交互式替代方案。本轮选用具有明确 [HTTP API 契约](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/docs/API.md) 的 MCP 服务，便于由 Node 采集任务直接调用。仅完成文档评估，未在本机安装第三方 skill。

[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 覆盖小红书、知乎、抖音等平台，但当前 [LICENSE](https://github.com/NanmiCoder/MediaCrawler/blob/main/LICENSE) 标明非商业学习使用。本项目面向 GTM 工作流，本轮不直接合并它的代码。

[RSSHub-MCP](https://github.com/panxiande/RSSHub-MCP) 是可选的 AI 对话层封装。定时任务直接读取 RSSHub，减少额外依赖。RSSHub、WeWe RSS、小红书 MCP 的许可证仍由各上游管理；此仓库新增的是独立适配器，没有复制其爬虫源码或合并上游 Git 历史。

## 启动服务

需要本机安装并运行 Docker。小红书和 RSSHub 可分别启动：

```bash
docker compose -f deploy/compose.domestic.yml --profile xiaohongshu up -d
docker compose -f deploy/compose.domestic.yml --profile rsshub up -d
```

小红书扫码入口为 `http://127.0.0.1:18060/api/v1/login/qrcode`，返回二维码图片数据；按上游 README 的登录工具或 MCP 客户端扫码。登录检查为 `/api/v1/login/status`。若服务设置了鉴权，应用进程也要配置相同的 `XHS_MCP_TOKEN`。该令牌不会写入工作台连接 JSON 或返回给浏览器。

WeWe RSS 按其 [Docker Compose 文档](https://github.com/cooderl/wewe-rss#-部署) 单独部署，访问本地 `4000` 端口。首次扫码前注意该项目 README 说明部分接口经第三方服务中转；本项目没有代你登录或向中转服务提交凭证。登录后添加需要跟踪的公众号。其 `FEED_MODE=fulltext` 决定是否输出全文，否则可能只有摘要。

镜像默认使用上游当前标签，可通过 `XHS_IMAGE` / `RSSHUB_IMAGE` 固定版本或 digest。当前执行环境没有 Docker，Compose 尚未实际启动验证。

## 配置工作台

知乎不配置路由时默认直接读取公开热榜，无需启动 RSSHub。现有 NewsNow 热榜任务中的 `zhihu` 目标也直接读取知乎接口，其他平台仍使用 NewsNow。两个入口共用 `zhihuKeywords`，默认筛选 AI 相关标题和摘要，留空才采全站热榜。可从数据源页的「采集来源 → 知乎 → 配置来源」修改，首页知乎来源配置读取同一字段。过滤先于条数限制；零匹配显示暂无内容。热榜不等于全站搜索，也不代表所选时间范围内的全部问题；原始发布时间保持未知。历史已入库条目不自动删除。

运行 `npm run dev`，点击“自动采集连接”，填写服务地址、关键词和订阅路由；保存后勾选对应来源，再点击“刷新真实来源”。这是一次性连接设置，不需要逐篇粘贴正文。

知乎作者、即刻圈子/用户、抖音博主支持直接填写平台主页链接，保存时自动转成对应路由。

也可以通过配置文件设置：

```bash
npm run connectors:configure -- config/connectors.example.json
```

示例文件中的服务地址是本机约定地址，RSSHub 目标数组特意留空。需要填写实际关注对象，不能用示例账号冒充用户的跟踪目标。

已核对上游代码的路由形式：

- 知乎作者回答：`/zhihu/people/answers/作者ID`
- 即刻圈子：`/jike/topic/圈子ID`
- 即刻用户：`/jike/user/用户ID`
- 抖音博主：`/douyin/user/用户ID`

关键词为不区分大小写的 OR 匹配。小红书每个关键词执行一次搜索；订阅来源在标题、正文/摘要中筛选。清空关键词意味着不过滤订阅内容，小红书则至少需要一个搜索词。每个来源单次最多 30 条，每条请求超时 30 秒。小红书只读取默认详情，不翻页抓取全部评论。

## 自动运行与状态

```bash
npm run collect wechat xiaohongshu zhihu jike douyin bilibili 36kr
```

可用现有定时调度执行上述命令；本轮没有修改系统定时任务。错误会写入 `runs.errors`，各来源结果写入 `runs.sourceResults`，成功来源的数据仍然保存。全部失败不会写入伪造记录。有错误时 CLI 退出码为 1，便于调度器告警。

- 待配置：尚未填写服务或订阅目标。
- 已配置：有完整设置，但不表示上游登录有效。
- 最近采集成功：该订阅/接口最近一次成功返回；0 条也可能是没有新内容或没有关键词匹配。
- 部分成功：部分详情或订阅失败，已保存可用结果。
- 需要登录 / 服务不可达 / 上游限流：明确失败原因，保留原有数据。

`data/connectors.json`、采集正文、签名分享链接及 Cookie 数据属于本机运行数据，`data/` 和 `outputs/` 已在 `.gitignore` 中排除。Docker 小红书 Cookie 保存在独立 named volume。

## 证据与验证

文章/笔记按“待核实线索”显示，不自动宣称已识别出真实创业公司。HTML 正文作为原始内容存储，不直接插入页面执行；原始页面 URL 可点击。RSS 文章没有可靠采用/收入指标时，潜力和 Kimi 匹配保持未知。小红书互动仅以低置信度作为内容兴趣线索，不推导 Kimi 匹配。

`npm test` 包含使用模拟 HTTP 响应的接口契约测试：登录、详情、URL、分页上限、部分失败、JSON Feed、来源状态和输入校验。模拟测试不等于真实平台登录采集成功。真实登录和服务连通性需要在可启动服务的本机环境完成。
