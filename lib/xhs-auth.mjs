import { readFile } from "node:fs/promises";
import path from "node:path";

function cookiesPath() {
  return process.env.XHS_COOKIES_PATH || path.join(process.cwd(), "data/services/xiaohongshu/cookies.json");
}

export async function readXhsCookies() {
  try {
    const raw = await readFile(cookiesPath(), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function xhsLoginState() {
  const data = await readXhsCookies();
  if (!data) return { loggedIn: false, reason: "未找到 cookies 文件，请先在页面扫码登录小红书" };
  if (!Array.isArray(data.cookies) || data.cookies.length === 0) {
    return { loggedIn: false, reason: "小红书尚未登录（cookies 为空），请先扫码" };
  }
  return { loggedIn: true, savedAt: data.saved_at };
}
