# 数据源与 API 申请指南

| 来源 | 状态 | Env | 申请/文档 | 当前可得范围 | 限制 |
| --- | --- | --- | --- | --- | --- |
| GitHub | 已实现可采集 | `GITHUB_TOKEN` 可选 | https://docs.github.com/en/rest/search/search | repository 搜索、star、fork、created/pushed 时间 | star/fork 不是用户、收入或下游集成 |
| Hacker News / Show HN | 已实现可采集 | 无 | https://github.com/HackerNews/API 与 HN Algolia | story 搜索、points、comments、URL | points/comments 只是早期兴趣 |
| Hugging Face | 已实现可采集 | `HF_TOKEN` 可选 | https://huggingface.co/docs/hub/api | 模型搜索、downloads、likes | downloads 需排除批量实验下载 |
| Product Hunt | 缺 API key | `PRODUCTHUNT_TOKEN` | https://api.producthunt.com/v2/docs | launch、upvotes、comments | 需要 token；launch 热度不等于留存 |
| Reddit | 缺 API key | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | https://www.reddit.com/dev/api/ | subreddit/post/comment | OAuth、速率限制、营销噪声 |
| X / Twitter | 需商业授权 | `X_BEARER_TOKEN` | https://developer.x.com/en/docs | tweet/search/engagement，取决于套餐 | 成本和反爬限制高，bot/转发噪声高 |
| 微信公众号文章 | 可手动导入 | 无 | https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html | URL+正文粘贴 | 无公开全网采集 API；转载需去重 |
| 小红书 | 可手动导入 | 无 | https://www.xiaohongshu.com/ | URL+正文粘贴 | 无稳定公开 API |
| 抖音 | 可手动导入 | 无 | https://developer.open-douyin.com/ | 授权账号/手动材料 | 开放平台不提供全站搜索 |
| B站 | 可手动导入 | 无 | https://openhome.bilibili.com/ | 手动材料 | 开放能力偏账号合作 |
| 即刻 | 可手动导入 | 无 | https://web.okjike.com/ | 手动材料 | 无公开采集 API |
| 知乎 | 可手动导入 | 无 | https://www.zhihu.com/ | 手动材料 | 无稳定公开搜索 API |
| 36氪 / 创投媒体 | 可手动导入 | 无 | https://36kr.com/ | 手动材料 | 区分媒体事实、采访自述、转载 |
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
4. 无稳定公开 API：微信、小红书、抖音、B站、即刻、知乎等国内内容平台。第一版按人工导入或授权数据商处理。

## 数据标注要求

每条证据至少保留 `sourceId`、`url`、`collectedAt`、`credibility`、`metric`、`normalization`。外部数字必须区分事实、公司自述、第三方估算、模型推断。没有历史数据时不生成趋势线。
