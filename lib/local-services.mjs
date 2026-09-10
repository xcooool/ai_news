import { spawn } from "node:child_process";
import { access, mkdir, open } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

export const LOCAL_SERVICES = [
  {
    id: "xiaohongshu",
    name: "小红书 MCP",
    port: 18060,
    healthPath: "/health",
    log: "data/services/xiaohongshu/server.log",
    async runnable() {
      return fileExists(path.join(root, "data/services/xiaohongshu/xiaohongshu-mcp"));
    },
    command() {
      return {
        cmd: path.join(root, "data/services/xiaohongshu/xiaohongshu-mcp"),
        args: ["-port", "127.0.0.1:18060"],
        env: { COOKIES_PATH: path.join(root, "data/services/xiaohongshu/cookies.json") },
        cwd: root,
      };
    },
    configUrl: "http://127.0.0.1:18060",
  },
  {
    id: "wechat",
    name: "微信公众号 WeRSS",
    port: 8001,
    healthPath: "/",
    log: "data/services/werss-server.log",
    async runnable() {
      return fileExists(path.join(root, "data/services/we-mp-rss/.venv/bin/python"));
    },
    command() {
      return {
        cmd: path.join(root, "data/services/we-mp-rss/.venv/bin/python"),
        args: [path.join(root, "scripts/werss-local.py")],
        env: {},
        cwd: root,
      };
    },
    configUrl: "http://127.0.0.1:8001",
    envKey: "WERSS_BASE_URL",
  },
  {
    id: "douyin",
    name: "抖音 API",
    port: 8002,
    healthPath: "/openapi.json",
    log: "data/services/douyin-server.log",
    async runnable() {
      return fileExists(path.join(root, "data/services/douyin-api/.venv/bin/uvicorn"));
    },
    command() {
      return {
        cmd: path.join(root, "data/services/douyin-api/.venv/bin/uvicorn"),
        args: ["app.main:app", "--host", "127.0.0.1", "--port", "8002"],
        env: {},
        cwd: path.join(root, "data/services/douyin-api"),
      };
    },
    configUrl: "http://127.0.0.1:8002",
    envKey: "DOUYIN_API_BASE_URL",
  },
];

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function probeService(service, baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}${service.healthPath}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return { ok: response.ok, status: response.status, url };
  } catch (error) {
    return { ok: false, error: error.message, url };
  }
}

export async function ensureServiceRunning(service, { start = true } = {}) {
  const baseUrl = service.configUrl;
  const probe = await probeService(service, baseUrl);
  if (probe.ok) return { ...probe, state: "running", started: false };

  if (!start) return { ...probe, state: "stopped", started: false };

  const canRun = await service.runnable();
  if (!canRun) {
    return { ...probe, state: "missing", started: false, message: `${service.name} 未安装，跳过自动启动` };
  }

  const { cmd, args, env, cwd } = service.command();
  await mkdir(path.dirname(path.join(root, service.log)), { recursive: true });
  const logHandle = await open(path.join(root, service.log), "a");
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", logHandle, logHandle],
  });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  child.unref();
  await logHandle.close();

  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(500);
    if (spawnError) return { state: "error", started: false, url: baseUrl, message: `${service.name} 启动失败：${spawnError.code || spawnError.message}` };
    const retry = await probeService(service, baseUrl);
    if (retry.ok) return { ...retry, state: "running", started: true };
  }
  return { state: "starting", started: true, url: baseUrl, message: "已启动进程，健康检查尚未通过，请稍后再试" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
