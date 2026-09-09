# AI 潜力监测工作台

一个本地可运行的中文监测系统，用于发现和评估 AI 开源项目、AI 创业公司/产品，并单独计算 Kimi/Moonshot API 商业匹配度。

## 快速开始

```bash
npm run dev
```

默认地址：`http://localhost:3000`

无需凭证即可使用示例模式、Hacker News、GitHub 公共搜索和 Hugging Face 公共 API。GitHub 未配置 token 时会受到低限流约束。

## 环境变量

```bash
PORT=3000
GITHUB_TOKEN=github_pat_optional
HF_TOKEN=hf_optional
MOONSHOT_API_KEY=sk_optional
MOONSHOT_MODEL=kimi-k2-0711-preview
COLLECT_LIMIT=12
```

不要在聊天里发送密钥。将密钥放进本机 shell、`.env` 管理器或部署平台的 secret/env 设置中。

## 采集与定时

国内来源现已接入自动采集适配器：小红书 MCP 搜索/详情、WeWe RSS 公众号订阅、RSSHub 知乎/即刻/抖音/B站/36氪订阅。点击“自动采集连接”配置服务和目标，首次登录后无需逐篇手动导入。已配置不等于已登录；失败状态会记录并显示。

部署、skills 调研与具体配置见 [国内自动采集指南](docs/domestic-automation.md)。外部服务尚未在当前受限环境启动或实采验证。

手动刷新：

```bash
npm run collect
```

只采某些真实来源：

```bash
npm run collect github hackernews huggingface
```

macOS/Linux cron 示例：

```cron
15 */6 * * * cd /Users/chuou/Documents/side_projects/ai_news && /usr/bin/env npm run collect >> data/collect.log 2>&1
```

## 评分原则

创业公司四维：需求成立、价值兑现、采用持续性、规模化条件。

开源项目四维：真实采用/下游集成、维护与交付、增长持续性、生态扩展。

Kimi 匹配另算：模型调用需求、技术匹配、合作时机。它用于 Go-to-market 优先级，不混入创业潜力冒充公司好坏。

评分链路：原始指标 -> 归一化规则 -> 维度分 -> 证据覆盖率 -> 有效权重 -> 潜力指数。缺失证据保持未知，不按 0 分处理；来源全取消或权重归零时不会计算指数；只有单一高分维度时会因覆盖率低而折减排名。

## 数据隔离

种子数据都标记为“示例模式”，仅用于演示界面和评分链路。真实 API 采集、手动导入会写入 `data/store.json`，并带有来源 URL、采集时间、事实属性和置信度。

## 验证

```bash
npm test
npm run build
```

`npm test` 覆盖 0 来源、0 权重、0 证据和单一高分维度折减。`npm run build` 做轻量结构验证，不会打包外部依赖。

国内适配器另有模拟 HTTP 契约测试，覆盖登录失效、部分失败、原文链接、JSON Feed 和来源状态。`npm run preview` 生成 `outputs/preview.html` 离线只读预览。
