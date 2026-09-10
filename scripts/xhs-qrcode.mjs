import "../lib/env.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { readConnectors } from "../lib/connectors.mjs";
const config = await readConnectors();
const base = config.xhsBaseUrl || 'http://127.0.0.1:18060';
const headers = process.env.XHS_MCP_TOKEN ? { Authorization: `Bearer ${process.env.XHS_MCP_TOKEN}` } : {};
try {
  const response = await fetch(`${base}/api/v1/login/qrcode`, { headers, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()).data;
  if (data?.is_logged_in) console.log('小红书已登录，可以运行 npm run collect -- xiaohongshu');
  else if (/^data:image\/(png|jpeg);base64,/.test(data?.img || '')) {
    await mkdir('data/services/xiaohongshu', { recursive: true });
    await writeFile('data/services/xiaohongshu/login.png', Buffer.from(data.img.split(',')[1], 'base64'), { mode: 0o600 });
    console.log('请用小红书 App 扫描 data/services/xiaohongshu/login.png。二维码有时效，过期重跑本命令。');
  } else throw new Error('没有返回二维码，请检查服务日志');
} catch (error) {
  console.error(`二维码未就绪：${error.message}。检查 data/services/xiaohongshu/server.log，不能将服务健康等同于平台已登录。`);
  process.exitCode = 1;
}
