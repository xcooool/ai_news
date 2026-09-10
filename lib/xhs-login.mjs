import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { request as providerRequest } from "./acquisition.mjs";
import { xhsLoginState } from "./xhs-auth.mjs";
import { LOCAL_SERVICES, ensureServiceRunning } from "./local-services.mjs";

const root = process.cwd();
const serviceDir = path.join(root, "data/services/xiaohongshu");
const loginBinary = path.join(serviceDir, "xiaohongshu-login");
const cookiesPath = process.env.XHS_COOKIES_PATH || path.join(serviceDir, "cookies.json");

let browserLoginProcess = null;

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function stopXhsMcp() {
  await new Promise((resolve) => {
    const killer = spawn("pkill", ["-f", path.join(serviceDir, "xiaohongshu-mcp")]);
    killer.on("exit", () => resolve());
    killer.on("error", () => resolve());
  });
  await sleep(1500);
}

async function restartXhsMcp() {
  const service = LOCAL_SERVICES.find((entry) => entry.id === "xiaohongshu");
  if (!service) return;
  await ensureServiceRunning(service, { start: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveXhsQrcode({ baseUrl, timeoutMs = 90000 }) {
  const local = await xhsLoginState();
  if (local.loggedIn) return { isLoggedIn: true };

  const headers = process.env.XHS_MCP_TOKEN ? { Authorization: `Bearer ${process.env.XHS_MCP_TOKEN}` } : {};
  try {
    const upstream = await providerRequest(`${baseUrl.replace(/\/$/, "")}/api/v1/login/qrcode`, { headers, timeoutMs });
    const data = (await upstream.json()).data;
    if (data?.is_logged_in) return { isLoggedIn: true };
    if (/^data:image\/(png|jpeg);base64,/.test(data?.img || "")) {
      return { isLoggedIn: false, mode: "qrcode", image: data.img };
    }
  } catch (error) {
    if (error.code === "not_found") {
      throw new Error("xiaohongshu-mcp 未提供二维码接口，请确认服务版本为 v2.5+");
    }
    if (error.code !== "unreachable") throw error;
  }

  return startBrowserLogin();
}

export async function startBrowserLogin() {
  if (!(await fileExists(loginBinary))) {
    throw new Error(
      "MCP 二维码接口超时。请运行 npm run setup 下载登录工具，或手动下载 xiaohongshu-login 到 data/services/xiaohongshu/ 后重试。",
    );
  }

  if (browserLoginProcess?.pid) {
    return {
      isLoggedIn: false,
      mode: "browser",
      message: "登录窗口已在打开中，请用小红书 App 扫码。完成后本页会自动检测。",
    };
  }

  await stopXhsMcp();

  return new Promise((resolve, reject) => {
    browserLoginProcess = spawn(loginBinary, [], {
      cwd: root,
      env: { ...process.env, COOKIES_PATH: cookiesPath },
      detached: true,
      stdio: "ignore",
    });
    browserLoginProcess.once("error", async (error) => {
      browserLoginProcess = null;
      await restartXhsMcp();
      reject(new Error(`无法启动登录工具：${error.message}。请运行 npm run setup 重新下载 xiaohongshu-login`));
    });
    browserLoginProcess.once("spawn", () => {
      browserLoginProcess.unref();
      browserLoginProcess.on("exit", async () => {
        browserLoginProcess = null;
        await restartXhsMcp();
      });
      resolve({
        isLoggedIn: false,
        mode: "browser",
        message: "已在系统打开小红书登录窗口，请用 App 扫码。扫码完成后可关闭该窗口，本页会自动检测登录状态。",
      });
    });
  });
}
