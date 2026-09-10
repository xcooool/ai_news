# 微信公众号自动启动 + 扫码采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev` 后台自动拉起 WeRSS；首页像小红书一样扫码登录公众号；在数据源配置改 `wechatFeedIds` 后勾选来源即可采集。

**Architecture:** Node 服务每次启动调用 `startLocalServices()`；新增 `lib/werss-auth.mjs` 用本地 `data/services/we-mp-rss/.env` 管理账户换 Bearer，再代理 WeRSS `/api/v1/wx/auth/qr/*`；前端平行复制小红书扫码弹窗；采集路径继续走 `WERSS_BASE_URL/feed/{id}.xml`。

**Tech Stack:** Node 22 ESM、现有 `server.mjs` / `public/app.js`、本地 WeRSS（FastAPI，`127.0.0.1:8001`）、`node --test`。

## Global Constraints

- 不引入 Docker；WeRSS 仅本机 Python venv。
- 不把 WeRSS 管理密码或微信 Cookie 发给浏览器 / 写入 git。
- 不做全微信搜索；订阅范围只用现有 `wechatFeedIds`。
- 不默认开启 WeRSS `ENABLE_JOB` 全量定时爬取。
- 对齐现有小红书登录模式（`/api/xiaohongshu/*` + 弹窗）。
- **未经用户明确要求不要 `git commit`。**

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/werss-auth.mjs` | 读凭证、管理登录、微信登录状态、二维码解析 |
| `test/werss-auth.test.mjs` | 上述逻辑的 mock 测试 |
| `lib/bootstrap.mjs` | 保持 `startLocalServices`；`bootstrapIfNeeded` 不再独自承担启动 |
| `server.mjs` | 每次启动起服务；挂 `/api/wechat/*` |
| `lib/connectors.mjs` | `withWechatLogin`、公众号 setup 文案 |
| `lib/domestic-collectors.mjs` | 采集前检查微信授权；可选 `is_update=true` |
| `public/index.html` / `public/app.js` | 扫码 UI |
| `docs/data-sources/collection-setup.md` | 同步体验说明 |

---

### Task 1: WeRSS 鉴权与扫码代理库

**Files:**
- Create: `lib/werss-auth.mjs`
- Create: `test/werss-auth.test.mjs`

**Interfaces:**
- Consumes: `process.env.WERSS_BASE_URL`（默认 `http://127.0.0.1:8001`）、`data/services/we-mp-rss/.env` 的 `USERNAME`/`PASSWORD`
- Produces:
  - `readWerssAdminCredentials(): Promise<{ username: string, password: string }>`
  - `werssAdminToken({ baseUrl, fetcher }): Promise<string>`
  - `werssLoginState({ baseUrl, fetcher }): Promise<{ loggedIn: boolean, reason?: string }>`
  - `resolveWerssQrcode({ baseUrl, fetcher }): Promise<{ isLoggedIn: boolean, image?: string, message?: string }>`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWerssAdminCredentials, werssLoginState, resolveWerssQrcode } from "../lib/werss-auth.mjs";

test("readWerssAdminCredentials reads USERNAME/PASSWORD from service .env", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "werss-env-"));
  await writeFile(path.join(dir, ".env"), "USERNAME=admin\nPASSWORD=secret\n", { mode: 0o600 });
  const creds = await readWerssAdminCredentials(dir);
  assert.deepEqual(creds, { username: "admin", password: "secret" });
});

test("werssLoginState reports loggedIn from qr/status login_status", async () => {
  const state = await werssLoginState({
    baseUrl: "http://werss.test",
    adminEnvDir: "/unused",
    fetcher: async (url, options = {}) => {
      if (String(url).endsWith("/api/v1/wx/auth/login")) {
        return new Response(JSON.stringify({ code: 0, data: { access_token: "tok" } }), { status: 200 });
      }
      if (String(url).includes("/api/v1/wx/auth/qr/status")) {
        assert.match(options.headers.Authorization, /Bearer tok/);
        return new Response(JSON.stringify({ code: 0, data: { login_status: true, qr_code: false } }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    },
    credentials: { username: "admin", password: "x" },
  });
  assert.equal(state.loggedIn, true);
});

test("resolveWerssQrcode maps WeRSS code path to absolute image URL", async () => {
  const result = await resolveWerssQrcode({
    baseUrl: "http://127.0.0.1:8001",
    fetcher: async (url) => {
      if (String(url).endsWith("/api/v1/wx/auth/login")) {
        return new Response(JSON.stringify({ code: 0, data: { access_token: "tok" } }), { status: 200 });
      }
      if (String(url).includes("/api/v1/wx/auth/qr/code")) {
        return new Response(JSON.stringify({ code: 0, data: { code: "/static/wx_qrcode.png?t=1", is_exists: true } }), { status: 200 });
      }
      if (String(url).includes("/api/v1/wx/auth/qr/status")) {
        return new Response(JSON.stringify({ code: 0, data: { login_status: false, qr_code: true } }), { status: 200 });
      }
      throw new Error(String(url));
    },
    credentials: { username: "admin", password: "x" },
  });
  assert.equal(result.isLoggedIn, false);
  assert.equal(result.image, "http://127.0.0.1:8001/static/wx_qrcode.png?t=1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/werss-auth.test.mjs`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

在 `lib/werss-auth.mjs`：

- 默认服务目录：`path.join(process.cwd(), "data/services/we-mp-rss")`
- 解析 `.env` 行（忽略注释/空行），取 `USERNAME`（默认 `admin`）与 `PASSWORD`
- `werssAdminToken`：`POST ${base}/api/v1/wx/auth/login`，`Content-Type: application/x-www-form-urlencoded`，body `username=&password=`；解析 `data.access_token`（兼容 `data` 外包一层 `success_response`）
- `werssLoginState`：带 Bearer 调 `GET .../qr/status`；`loggedIn = Boolean(data.login_status)`；失败时给出中文 `reason`（不可达 / 凭证错误 / 未授权）
- `resolveWerssQrcode`：若已登录返回 `{ isLoggedIn: true }`；否则 `GET .../qr/code`，把 `data.code`（相对路径）拼成绝对 URL 作为 `image`
- 所有上游请求 `AbortSignal.timeout(90000)`（二维码/浏览器可能慢）
- 错误用 `{ code, message }` Error（`needs_setup` / `needs_login` / `unreachable`）

注意：WeRSS `success_response` 常见形状为 `{ code: 0, data: ... }` 或 `{ success: true, data: ... }`——实现时两种都兼容。

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --test test/werss-auth.test.mjs`  
Expected: PASS

---

### Task 2: 每次 `npm run dev` 启动本地服务

**Files:**
- Modify: `server.mjs`
- Modify: `lib/bootstrap.mjs`（仅必要时导出/文档化）
- Test: `test/bootstrap.test.mjs`（扩展）

**Interfaces:**
- Consumes: `startLocalServices` from `lib/bootstrap.mjs`
- Produces: server 启动时无论配置是否已存在都会尝试启动 WeRSS

- [ ] **Step 1: Write the failing test**

在 `test/bootstrap.test.mjs` 增加：

```js
test("bootstrapIfNeeded skipping config still leaves startLocalServices callable independently", async () => {
  const { startLocalServices } = await import("../lib/bootstrap.mjs");
  assert.equal(typeof startLocalServices, "function");
});
```

（行为级验证放在实现后的手动/集成；此处保证 API 可独立调用。若现有导出已存在，改为测「server 入口会调用」：可抽 `export async function prepareServer({ startServices = true } = {})` 并单测其在 `needsBootstrap()===false` 时仍调用 `startLocalServices`。）

推荐更强测法——在 `lib/bootstrap.mjs` 增加：

```js
export async function prepareRuntime({ startServices = true, start = startLocalServices } = {}) {
  const boot = await bootstrapIfNeeded({ startServices: false });
  const services = startServices ? await start({ start: true }) : {};
  return { boot, services };
}
```

测试用 stub：

```js
test("prepareRuntime starts services even when bootstrap is skipped", async () => {
  let called = false;
  const { prepareRuntime } = await import("../lib/bootstrap.mjs");
  await prepareRuntime({
    startServices: true,
    start: async () => {
      called = true;
      return { wechat: { state: "running" } };
    },
  });
  assert.equal(called, true);
});
```

若 `bootstrapIfNeeded` 依赖真实磁盘，测试需在临时目录或接受「配置已存在」环境；用注入 `start` 即可不依赖真实 WeRSS。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/bootstrap.test.mjs`  
Expected: FAIL（无 `prepareRuntime`）

- [ ] **Step 3: Implement**

1. 在 `lib/bootstrap.mjs` 实现 `prepareRuntime` 如上。
2. `server.mjs` 将：

```js
await bootstrapIfNeeded({ startServices: true });
```

改为：

```js
const prepared = await prepareRuntime({ startServices: true });
if (prepared.services?.wechat?.state === "missing") {
  console.warn("微信公众号 WeRSS 未安装，跳过自动启动。可稍后配置 data/services/we-mp-rss");
} else if (prepared.services?.wechat?.state && prepared.services.wechat.state !== "running") {
  console.warn(`微信公众号 WeRSS: ${prepared.services.wechat.state}${prepared.services.wechat.message ? " — " + prepared.services.wechat.message : ""}`);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/bootstrap.test.mjs`  
Expected: PASS

---

### Task 3: HTTP API `/api/wechat/login-status` 与 `/api/wechat/qrcode`

**Files:**
- Modify: `server.mjs`
- Modify: `lib/connectors.mjs`（`withWechatLogin`）
- Test: `test/werss-auth.test.mjs` 或新建轻量 HTTP 测（优先复用库测 + 对照小红书路由结构）

**Interfaces:**
- Produces:
  - `GET /api/wechat/login-status` → `{ loggedIn, reason }`
  - `GET|POST /api/wechat/qrcode` → `{ isLoggedIn, image?, message? }`
  - `withWechatLogin(sources)` 给 `wechat` 源挂 `login` 字段

- [ ] **Step 1: Extend connectors test / add unit for withWechatLogin**

在 `test/werss-auth.test.mjs` 或 `test/domestic-collectors.test.mjs`：

```js
import { withWechatLogin } from "../lib/connectors.mjs";

test("withWechatLogin annotates wechat source only", async () => {
  const sources = await withWechatLogin(
    [{ id: "wechat" }, { id: "xiaohongshu" }],
    { loggedIn: true, reason: null },
  );
  assert.equal(sources[0].login.loggedIn, true);
  assert.equal(sources[1].login, undefined);
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

`lib/connectors.mjs`：

```js
export async function withWechatLogin(sources, loginState) {
  const login = loginState ?? (await werssLoginState({}));
  const payload = { loggedIn: Boolean(login.loggedIn), reason: login.reason || null };
  return sources.map((source) => (source.id === "wechat" ? { ...source, login: payload } : source));
}
```

更新 `describeSetup("wechat")` 文案：强调本机 WeRSS 会随 `npm run dev` 启动；扫码在本页；`wechatFeedIds` 填 `all` 或订阅 ID；添加新公众号可打开 `http://127.0.0.1:8001`。

`server.mjs` 在现有小红书路由旁增加对称路由；`/api/state`（或组装 sources 处）同时 `withXhsLogin` + `withWechatLogin`。

查找现有：

```js
await withXhsLogin(...)
```

改为链式：

```js
withWechatLogin(await withXhsLogin(sources))
```

- [ ] **Step 4: Run `node --test test/werss-auth.test.mjs test/bootstrap.test.mjs`**

---

### Task 4: 采集前登录检查 + Feed 刷新

**Files:**
- Modify: `lib/domestic-collectors.mjs`
- Modify: `test/domestic-collectors.test.mjs`

**Interfaces:**
- Consumes: `werssLoginState`
- Produces: 未登录时 `needs_login`；请求 Feed 使用 `is_update=true`（首次拉取更新）

- [ ] **Step 1: Failing test**

```js
test("wechat WERSS path requires login before fetching feed", async () => {
  process.env.WERSS_BASE_URL = "http://werss.test";
  await assert.rejects(
    collectDomestic("wechat", { ...configured(), wechatFeedIds: ["all"] }, 2, async () => {
      throw new Error("should not fetch feed");
    }),
    (error) => error.code === "needs_login",
  );
});
```

（实现时通过注入：`collectDomestic` 内先调 `werssLoginState({ fetcher })`；测试用 mock fetcher 对 login/status 返回未登录，对 feed 不应被调用。）

更精确：

```js
test("wechat WERSS path requires login before fetching feed", async () => {
  process.env.WERSS_BASE_URL = "http://werss.test";
  let hitFeed = false;
  await assert.rejects(
    collectDomestic("wechat", { ...configured(), wechatFeedIds: ["all"] }, 2, async (url) => {
      if (String(url).includes("/auth/login")) {
        return new Response(JSON.stringify({ code: 0, data: { access_token: "t" } }), { status: 200 });
      }
      if (String(url).includes("/auth/qr/status")) {
        return new Response(JSON.stringify({ code: 0, data: { login_status: false } }), { status: 200 });
      }
      hitFeed = true;
      return new Response("<rss/>", { status: 200 });
    }),
    (error) => error.code === "needs_login",
  );
  assert.equal(hitFeed, false);
});
```

需能读到 admin 凭证：测试前写临时 `.env` 并用环境变量 `WERSS_ENV_DIR` 指向它，或让 `werssLoginState` 接受 `credentials` 且 `collectDomestic` 在测环境走默认 mock——**实现约定**：`collectXiaohongshu` 式地在 wechat 分支调用 `werssLoginState({ fetcher, credentials })`；测试通过 `process.env.WERSS_USERNAME` / `WERSS_PASSWORD` 覆盖（`werss-auth` 优先 env，其次文件）。

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement wechat 分支**

```js
if (sourceId === "wechat" && process.env.WERSS_BASE_URL) {
  const login = await werssLoginState({ fetcher });
  if (!login.loggedIn) throw failure("needs_login", login.reason || "请先扫码登录微信公众号授权");
  return eachTarget(config.wechatFeedIds.map(id => ({ id, name: `公众号订阅 ${id}` })), async target => {
    const base = process.env.WERSS_BASE_URL.replace(/\/$/, "");
    const url = `${base}/feed/${encodeURIComponent(target.id)}.xml?limit=${Math.min(100, limit)}&is_update=true`;
    const response = await request(url, {}, fetcher);
    return parseFeed(await response.text(), "wechat", target);
  });
}
```

- [ ] **Step 4: Run `node --test test/domestic-collectors.test.mjs`**

---

### Task 5: 前端扫码 UI（对齐小红书）

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `/api/wechat/login-status`, `/api/wechat/qrcode`
- Produces: 来源列表登录按钮 + `#wechatQrDialog`

- [ ] **Step 1: 复制小红书 dialog 结构为公众号版**

在 `index.html` 的 `#xhsQrDialog` 旁增加：

```html
<dialog id="wechatQrDialog" class="xhs-qr-dialog">
  ...
  <p id="wechatQrMessage" class="hint">正在请求登录二维码…</p>
  <div id="wechatQrSpinner" class="xhs-qr-spinner"></div>
  <img id="wechatQrImage" class="xhs-qr-image" alt="微信公众号登录二维码" hidden />
  <button id="wechatQrRetry" class="ghost hidden" type="button">重新获取二维码</button>
</dialog>
```

数据源配置 wechat 区块增加「扫码登录」按钮与提示（可链到 `http://127.0.0.1:8001` 添加订阅）。

- [ ] **Step 2: 在 `app.js` 平行实现**

- 来源渲染：`source.id === "wechat"` 时与小红书一样显示 `login` 徽章 / `data-wechat-login`
- `openWechatQrDialog` / `fetchWechatQr` / poll `/api/wechat/login-status`
- `collectFromSources` 中除小红书外：

```js
const wechatLoginError = result.run.errors?.find(
  (error) => error.code === "needs_login" && error.sourceId === "wechat",
);
if (wechatLoginError) {
  toast("微信公众号需要先扫码登录");
  openWechatQrDialog({ reason: wechatLoginError.message });
}
```

- [ ] **Step 3: 手动检查要点（实现者自测）**

1. 打开首页，公众号来源有扫码入口  
2. 未起 WeRSS 时有明确错误文案  
3. 已登录时徽章显示「已登录」

（前端无单测框架则依赖手动 + API 单测。）

---

### Task 6: 文档与回归

**Files:**
- Modify: `docs/data-sources/collection-setup.md`「微信公众号」一节
- Run full test suite

- [ ] **Step 1: 更新文档**

改为：

1. `npm run dev` 自动后台启动 WeRSS  
2. 首页扫码登录  
3. 数据源配置 `wechatFeedIds`（默认 `all`）  
4. 添加新公众号：打开 `http://127.0.0.1:8001`  
5. 勾选来源采集  

删除「必须手动 python 启动」作为主路径（可保留故障排查附录一行）。

- [ ] **Step 2: 全量测试**

Run: `npm test`  
Expected: 全部 PASS

- [ ] **Step 3: 若用户要求再提交 commit**（默认跳过）

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 每次 dev 自动起 WeRSS | Task 2 |
| 扫码对齐小红书 | Task 1, 3, 5 |
| 服务端代登不暴露密码 | Task 1, 3 |
| `wechatFeedIds` 配置采什么 | 已有 + Task 5 文案 |
| 采集走 Feed / 未登录提示 | Task 4, 5 |
| 不启用 ENABLE_JOB 默认爬取 | Task 4 用 `is_update=true` 按次更新 |
| 文档 | Task 6 |

## Self-review notes

- WeRSS API 前缀为 `/api/v1/wx/auth/...`（`API_BASE=/api/v1/wx`），二维码图片为 `http://127.0.0.1:8001/static/wx_qrcode.png?...`。
- 无 TBD/占位步骤。
- 不自动 git commit（用户规则优先）。
