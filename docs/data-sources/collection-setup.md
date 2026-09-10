# 真实采集与登录接续

本轮只做数据采集。新增原始内容不生成潜力评分；示例数据不计入实采数量。用户后续已确认先拿数据，KOL 分类暂不完善。

## 运行

```bash
cd /Users/xuchuou/Documents/ai_news
npm run sources:status
COLLECT_LIMIT=20 npm run collect -- jike feeds github github_kol hackernews huggingface hf_spaces
npm run collect -- x
```

`COLLECT_LIMIT` 对新的账号/订阅采集器是**每个目标**的上限。每个目标都会尝试，前一个目标不会用光后续账号的配额。公开页面和 Feed 只覆盖它们提供的窗口，不能代表全历史。X 官方 API 可用 `X_MAX_PAGES` 控制翻页，默认 1 页；达到上限会标记还有后续内容。

`data/store.json` 是工作台数据；`data/raw/<source>/` 保存内容版本；`data/runs/` 保存每次运行详情；`data/source-status.json` 是最近一次生成的汇总。运行 `npm run sources:status` 更新汇总。历史 run 的获取条数不等于当前去重存储条数。

`config/watchlist.json` 提供公开种子；`data/watchlist.local.json` 按分类、目标 ID 合并覆盖。失败订阅仍保留在报告中，避免把失效地址误标为已接入。没有关键词预过滤，非 AI 内容也会保留供以后分析。

`.env` 自动加载，支持现有 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`；本地服务始终直连。查看 `.env.example`。不要在聊天里发 token/Cookie。

## 微信公众号

采用 [rachelos/we-mp-rss](https://github.com/rachelos/we-mp-rss)，MIT。源码在 `data/services/we-mp-rss/`。

1. `npm run dev` 会自动后台启动 WeRSS（`http://127.0.0.1:8001`）。
2. 首页「微信公众号文章」点「扫码登录」，用微信扫码授权。
3. 数据源配置里改 `wechatFeedIds`（默认 `all`）。新公众号可在管理页添加。
4. 勾选来源后点「采集新数据」。

故障排查时可手动启动：`data/services/we-mp-rss/.venv/bin/python scripts/werss-local.py`。管理账户密码在 `data/services/we-mp-rss/.env` 的 `PASSWORD`。

## 小红书

采用 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)，Apache-2.0；本机已下载 v2.5.0 的 Apple Silicon 可执行文件及其浏览器。

```bash
COOKIES_PATH="$PWD/data/services/xiaohongshu/cookies.json" data/services/xiaohongshu/xiaohongshu-mcp -port 127.0.0.1:18060
npm run xhs:qrcode
```

二维码输出 `data/services/xiaohongshu/login.png`，用小红书 App 扫描。扫码成功后运行 `npm run collect -- xiaohongshu`。服务地址通过现有“自动采集连接”设置为 `http://127.0.0.1:18060`。

本轮服务 `/health` 已返回正常，但 `/api/v1/login/qrcode` 多次超时，所以尚未取得二维码或笔记，不能把健康检查当作登录成功。日志在 `data/services/xiaohongshu/server.log`。接口目前沿用关键词搜索和详情获取，账号定向采集暂未扩展。

## 抖音

采用 [Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)，Apache-2.0；源码及独立 Python 环境在 `data/services/douyin-api/`。

```bash
cd data/services/douyin-api
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8002
```

本地接口文档 `http://127.0.0.1:8002/docs`。需要时在 `crawlers/douyin/web/config.yaml` 的 Cookie 字段设置**自己的**抖音登录态，然后重启服务；已清除上游仓库携带的示例 Cookie。不要把 Cookie 提交到 Git 或发到聊天。

在项目根 `.env` 设置 `DOUYIN_API_BASE_URL=http://127.0.0.1:8002`，在 `data/watchlist.local.json` 添加真实主页 ID：

```json
{
  "douyin": [{"id":"my-author","name":"作者名","secUserId":"从抖音 /user/ 后复制完整 ID"}]
}
```

然后 `npm run collect -- douyin`。适配 `/api/douyin/web/fetch_user_post_videos`，保存正文、原视频页、作者、时间和互动；未下载视频文件或生成转录。尚未登录和配置作者时不会虚构采集结果。

## X

默认读 X 官方 `syndication.twitter.com` 公开嵌入窗口，无需 Key。本轮已经取得真实帖子，但存在历史热门内容和 429；它**不是完整的最新时间线或全站热榜**。每条标记 `x_public_embed` 和 `public_embed_curated_not_latest_timeline`，逐目标报告最近帖子日期。

需要完整近期作者时间线时，在 [X Developer Console](https://console.x.com/) 申请读取权限/额度，并设置 `X_MODE=api`、`X_BEARER_TOKEN`。已实现作者 ID 查询与 timeline 分页。具体收费以 [X 官方价格页](https://docs.x.com/x-api/getting-started/pricing) 为准。

也调研了 [twscrape](https://github.com/vladkens/twscrape)（MIT）和 [Twikit](https://github.com/d60/twikit)（MIT）：均需要可用登录态、会受平台变化和验证影响。本轮未读取你的现有浏览器 Cookie、未创建账号池；可将自己已有的导出数据通过下方命令入库。

## 其他来源与导入

直接 Feed 覆盖量子位、爱范儿、少数派、Solidot、阮一峰、宝玉、Simon Willison、Latent Space、Interconnects、TechCrunch、Sequoia 等。机器之心/36氪的候选 Feed 地址本轮未提供有效 Feed，保留失败记录。Hugging Face 已补 Spaces；Reddit 公开 RSS 部分有效、部分限流。Product Hunt 公开 RSS 已取得数据，独立 GraphQL 接口仍需 `PRODUCTHUNT_TOKEN`。

B站、知乎等沿用 [RSSHub](https://github.com/DIYgod/RSSHub) 路由适配，需 RSSHub 服务和真实订阅路由；本机没有 Docker，尚未部署 RSSHub。即刻直接解析公开页面，不依赖 RSSHub 服务。参考了 RSSHub 的公开页面数据结构，未复制其实现代码。

[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 支持小红书、抖音、B站、微博、知乎等，但其仓库采用非商业学习许可证，不作为本项目默认内嵌依赖。只提供外部 JSON/JSONL 数据格式兼容导入：

```bash
npm run import:social -- douyin /absolute/path/videos.jsonl
npm run import:social -- x /absolute/path/twscrape.jsonl
```

支持 `x/xiaohongshu/douyin/bilibili/weibo/zhihu/wechat/jike` 来源标记。没有有效原文 URL 的行会报告错误；模拟数据不要导入真实库。外部工具登录、抓取、导出仍须先独立完成，导入适配不代表已自动抓取该平台。

## 验证边界

`npm test` 验证 Feed、公开页面解析、逐目标失败隔离、X API 分页、原有国内适配及存储合并。`npm run build` 仅是项目原有结构/评分检查，不是所有平台端到端通过。真实平台状态以 `data/source-status.json` 和 `data/runs/` 为准。
