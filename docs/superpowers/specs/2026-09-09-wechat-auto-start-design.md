# 微信公众号：dev 自动启动 + 类小红书扫码采集

日期：2026-09-09  
状态：待用户确认  
范围：让 `npm run dev` 后，用户可像小红书一样扫码登录公众号适配器，在数据源配置里改订阅范围，勾选来源后一键采集。

## 目标体验

1. 运行 `npm run dev` → 本机 WeRSS（`we-mp-rss`）在后台自动启动。
2. 首页来源列表对「微信公众号文章」显示登录状态；未登录时有「扫码登录」。
3. 扫码交互对齐小红书：弹窗展示二维码、轮询状态、成功后可关闭。
4. 采集哪些公众号：在现有「数据源配置」里改 `wechatFeedIds`（默认 `all`）。
5. 勾选微信公众号 → 点采集 → 自动读本地 Feed 入库；未登录则提示扫码。

非目标：不做全微信搜索；不引入 Docker；不要求用户每次手动开 `:8001` 管理页。

## 背景与现状缺口

- `server.mjs` 已调用 `bootstrapIfNeeded({ startServices: true })`，但仅在缺少 `.env` / connectors 时才会真正 `startLocalServices`；配置齐全后 **dev 不再拉起 WeRSS**。
- 公众号采集已支持 `WERSS_BASE_URL` + `/feed/{id}.xml`；缺的是稳定的自动启动与首页扫码体验。
- WeRSS 微信扫码 API（`/api/v1/auth/qr/*`）需要先用本地管理账户拿到 Bearer token。

## 架构

```
npm run dev
  └─ server.mjs
       ├─ ensureLocalServices()     # 每次启动：探测并后台拉起 WeRSS 等
       ├─ /api/wechat/login-status  # 代理 WeRSS：管理登录 + 微信授权状态
       ├─ /api/wechat/qrcode        # 代理 WeRSS：获取二维码
       └─ /api/refresh              # 既有采集；wechat 走 WERSS Feed
```

本项目不把 WeRSS 管理密码暴露给浏览器；由 Node 服务端读取 `data/services/we-mp-rss/.env` 完成管理登录，再代理二维码接口。

## 详细设计

### 1. 每次 `npm run dev` 自动启动本地服务

- 从 `bootstrapIfNeeded` 中拆出「服务启动」：配置是否齐全都执行 `startLocalServices()`。
- 保留现有 `ensureServiceRunning`：健康检查通过则跳过；未安装则标记 `missing` 并在控制台提示，不阻断主站。
- WeRSS 启动命令继续用 `scripts/werss-local.py`（绑定 `127.0.0.1:8001`）。
- 若 `.venv` 的 shebang 指向旧路径导致无法启动：在启动失败信息中给出 `npm run setup` / 重建 venv 提示（实现阶段按需修路径探测）。

### 2. 登录状态与扫码（对齐小红书）

服务端新增：

| 接口 | 行为 |
|------|------|
| `GET /api/wechat/login-status` | 确保 WeRSS 运行 → 用本地 admin 凭证换 token → 查询微信授权/扫码状态；返回 `{ loggedIn, reason, ... }` |
| `GET`/`POST` `/api/wechat/qrcode` | 同上鉴权后请求 WeRSS `/api/v1/auth/qr/code` 或 `/qr/image`，把可展示的二维码数据返回前端 |

前端：

- 来源卡片增加与小红书同级的登录徽章 /「扫码登录」按钮。
- 复用或平行实现弹窗：展示二维码、失败重试、轮询直到 `loggedIn`。
- 采集若返回 `needs_login`（`sourceId === wechat`），自动打开扫码弹窗。

凭证来源：仅服务端读 `data/services/we-mp-rss/.env` 的 `USERNAME`/`PASSWORD`；不写入前端、不进 git。

### 3. 数据源配置（采什么）

- 继续使用现有 `wechatFeedIds`（多行文本，`all` 或订阅 ID）。
- 文案改为：登录并在 WeRSS 添加公众号后，这里填 `all` 采全部，或填具体订阅 ID；不必再强调「另开 Docker / 手动起服务」。
- 连接就绪判断：`WERSS_BASE_URL` 存在 + 服务可达 +（可选）已微信授权；未授权时状态为 `needs_login`，与小红书一致。

### 4. 采集路径

- 保持 `collectDomestic("wechat")` 在 `WERSS_BASE_URL` 下读 `/feed/{id}.xml`。
- 采集前：若未登录，直接 `needs_login`，不要空转超时。
- 可选增强（实现时若成本低则做）：请求 Feed 时带 `is_update=true` 或先调 WeRSS 更新接口，避免「服务在跑但缓存为空」。若上游更新过慢，保留超时与明确错误，不阻塞其他来源。

### 5. 错误与边界

- WeRSS 未安装：来源显示需要安装/运行 setup，采集报 `needs_setup`。
- 服务起不来：`unreachable`。
- 管理密码错误：`needs_setup`，提示检查 `data/services/we-mp-rss/.env`。
- 微信未扫码或过期：`needs_login` + 弹窗。
- 已登录但 `wechatFeedIds` 为空：`needs_setup`。

## 测试计划

- 单元：WeRSS 管理登录 + QR 代理在 mock fetcher 下的成功/未登录/不可达。
- 单元：`startLocalServices` / server 启动路径在「配置已存在」时仍会尝试启动服务（可用 stub）。
- 现有 wechat Feed 采集测试保持通过。
- 手动：`npm run dev` → 来源显示公众号登录入口 → 扫码 → 配置 `all` → 采集有文章。

## 明确不做

- 不在本项目内嵌完整公众号搜索/订阅管理 UI（添加具体公众号仍可在首次扫码后用 WeRSS 管理页完成；日常采集与登录留在本站）。
- 不默认开启 WeRSS 全量定时爬取任务（避免账号风控）；以采集时拉取 / 显式更新为主。
- 不提交任何 Cookie、密码或 `data/services/we-mp-rss/.env`。

## 成功标准

用户只需：

1. `npm run dev`
2. （首次）点公众号「扫码登录」并用微信扫码；如需新公众号，在数据源说明指引下于 WeRSS 添加一次
3. 在数据源配置确认 `wechatFeedIds`
4. 勾选来源 → 采集

无需每次手动启动 Python 服务或记忆 Docker 命令。
