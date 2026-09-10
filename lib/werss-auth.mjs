import { readFile } from "node:fs/promises";
import path from "node:path";
import { LOCAL_SERVICES, ensureServiceRunning } from "./local-services.mjs";

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function baseUrlOf(baseUrl) {
  return String(baseUrl || process.env.WERSS_BASE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
}

function envDirOf(adminEnvDir) {
  return adminEnvDir || process.env.WERSS_ENV_DIR || path.join(process.cwd(), "data/services/we-mp-rss");
}

async function ensureWerssRunning() {
  const service = LOCAL_SERVICES.find((entry) => entry.id === "wechat");
  if (!service) throw failure("needs_setup", "未找到 WeRSS 本地服务定义");
  const result = await ensureServiceRunning(service, { start: true });
  if (result.state === "missing") throw failure("needs_setup", result.message || "WeRSS 未安装");
  if (result.state === "error") throw failure("unreachable", result.message || "WeRSS 启动失败");
  if (result.state === "starting") {
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const retry = await ensureServiceRunning(service, { start: false });
      if (retry.state === "running") return retry;
    }
    throw failure("unreachable", "WeRSS 已启动但仍未就绪，请稍后重试扫码");
  }
  if (result.state !== "running") {
    throw failure("unreachable", "WeRSS 服务不可达，请确认 npm run dev 已自动启动公众号服务");
  }
  return result;
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.data !== undefined) return payload.data;
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeQrPath(code, baseUrl) {
  if (!code || typeof code !== "string") return null;
  if (code.startsWith("data:")) return code;
  if (code.startsWith("http://") || code.startsWith("https://")) return code;
  // WeRSS sometimes returns an absolute filesystem path; always map to static URL.
  const fileName = code.includes("wx_qrcode.png") ? "wx_qrcode.png" : path.basename(code.split("?")[0]);
  const query = code.includes("?") ? code.slice(code.indexOf("?")) : `?t=${Date.now()}`;
  if (fileName === "wx_qrcode.png" || code.includes("/static/")) {
    return `${baseUrlOf(baseUrl)}/static/wx_qrcode.png${query.startsWith("?") ? query : `?${query}`}`;
  }
  return `${baseUrlOf(baseUrl)}${code.startsWith("/") ? "" : "/"}${code}`;
}

export async function readWerssAdminCredentials(adminEnvDir = envDirOf()) {
  if (process.env.WERSS_USERNAME || process.env.WERSS_PASSWORD) {
    return {
      username: process.env.WERSS_USERNAME || "admin",
      password: process.env.WERSS_PASSWORD || "",
    };
  }
  let raw = "";
  try {
    raw = await readFile(path.join(adminEnvDir, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw failure("needs_setup", "未找到 WeRSS 配置，请确认 data/services/we-mp-rss/.env 存在");
    throw error;
  }
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  const username = values.USERNAME || "admin";
  const password = values.PASSWORD || "";
  if (!password) throw failure("needs_setup", "WeRSS 管理密码为空，请检查 data/services/we-mp-rss/.env 的 PASSWORD");
  return { username, password };
}

export async function werssAdminToken({
  baseUrl,
  fetcher = fetch,
  credentials,
  adminEnvDir,
} = {}) {
  await ensureWerssRunning();
  const creds = credentials || (await readWerssAdminCredentials(adminEnvDir));
  const url = `${baseUrlOf(baseUrl)}/api/v1/wx/auth/login`;
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: creds.username, password: creds.password }).toString(),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw failure("unreachable", "WeRSS 服务不可达，请确认 npm run dev 已自动启动公众号服务");
  }
  if (response.status === 401 || response.status === 403) {
    throw failure("needs_setup", "WeRSS 管理账户登录失败，请检查 data/services/we-mp-rss/.env 的账号密码");
  }
  if (!response.ok) throw failure("unreachable", `WeRSS 管理登录 HTTP ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw failure("unreachable", "WeRSS 管理登录未返回 JSON");
  }
  const data = unwrap(payload);
  const token = data?.access_token;
  if (!token) throw failure("needs_setup", "WeRSS 管理登录未返回 access_token");
  return token;
}

async function authorizedGet(route, options = {}) {
  const { baseUrl, fetcher = fetch, credentials, adminEnvDir } = options;
  const token = await werssAdminToken({ baseUrl, fetcher, credentials, adminEnvDir });
  let response;
  try {
    response = await fetcher(`${baseUrlOf(baseUrl)}${route}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw failure("unreachable", "WeRSS 接口不可达或超时");
  }
  if (!response.ok) throw failure("unreachable", `WeRSS HTTP ${response.status}`);
  return unwrap(await response.json());
}

export async function werssLoginState(options = {}) {
  try {
    if (options.ensureRunning !== false) await ensureWerssRunning();
    const data = await authorizedGet("/api/v1/wx/auth/qr/status", options);
    if (data?.login_status) return { loggedIn: true };
    return { loggedIn: false, reason: "微信公众号尚未扫码授权，请先扫码登录" };
  } catch (error) {
    return {
      loggedIn: false,
      reason: error.message || "无法检查公众号登录状态",
      code: error.code,
    };
  }
}

async function waitForQrImage(imageUrl, { fetcher = fetch, pollMs = 1000, timeoutMs = 90000 } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetcher(imageUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const type = response.headers.get("content-type") || "image/png";
        if (type.includes("image") || type.includes("octet-stream")) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 32) {
            return `data:${type.includes("image") ? type : "image/png"};base64,${bytes.toString("base64")}`;
          }
        }
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(pollMs);
  }
  throw failure(
    "needs_login",
    `微信二维码生成超时（${Math.round(timeoutMs / 1000)} 秒）。上游可能打不开公众平台登录页，请点「重新获取」再试；若多次失败，查看 data/services/werss-server.log。${lastError ? `（${lastError}）` : ""}`,
  );
}

export async function resolveWerssQrcode(options = {}) {
  const login = await werssLoginState(options);
  if (login.loggedIn) return { isLoggedIn: true, message: "微信公众号已授权，可以直接采集" };
  const data = await authorizedGet("/api/v1/wx/auth/qr/code", options);
  const imageUrl = normalizeQrPath(data?.code, options.baseUrl);
  if (!imageUrl) {
    throw failure("needs_login", "WeRSS 未返回二维码，请稍后在本站重试扫码登录");
  }
  if (imageUrl.startsWith("data:")) {
    return { isLoggedIn: false, image: imageUrl, message: "请用微信扫码授权公众号采集" };
  }
  // GetCode returns immediately while a background thread writes the PNG.
  const image = await waitForQrImage(imageUrl, {
    fetcher: options.fetcher,
    pollMs: options.pollMs,
    timeoutMs: options.timeoutMs,
  });
  return { isLoggedIn: false, image, message: "请用微信扫码授权公众号采集" };
}
