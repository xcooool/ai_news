import "../lib/env.mjs";
import { readConnectors } from "../lib/connectors.mjs";
import { xhsLoginState } from "../lib/xhs-auth.mjs";
import { probeService, LOCAL_SERVICES } from "../lib/local-services.mjs";

const config = await readConnectors();
const service = LOCAL_SERVICES.find((entry) => entry.id === "xiaohongshu");
const baseUrl = config.xhsBaseUrl || service.configUrl;
const health = await probeService(service, baseUrl);
const cookies = await xhsLoginState();

console.log(`服务地址: ${baseUrl}`);
console.log(`健康检查: ${health.ok ? "正常" : `失败 (${health.error || health.status})`}`);
console.log(`登录状态: ${cookies.loggedIn ? `已登录${cookies.savedAt ? `（${cookies.savedAt}）` : ""}` : cookies.reason}`);

if (!cookies.loggedIn) {
  console.log("\n下一步: npm run xhs:qrcode");
  process.exitCode = 1;
}
