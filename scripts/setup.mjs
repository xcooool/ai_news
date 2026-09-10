import "../lib/env.mjs";
import { bootstrap } from "../lib/bootstrap.mjs";

const force = process.argv.includes("--force");
const noStart = process.argv.includes("--no-start");

const report = await bootstrap({ startServices: !noStart, force });

if (report.skipped) {
  console.log(report.message);
  process.exit(0);
}

console.log("AI News 本地环境已就绪（无需 Docker）\n");
if (report.env.added.length) console.log(`· .env 新增: ${report.env.added.join(", ")}`);
else console.log("· .env 已有所需变量");
console.log(`· connectors.json ${report.connectors.changed ? "已写入/补全" : "已是最新"}`);
console.log(`· 默认来源 ${report.sources.changed ? "已扩展" : "已就绪"} (${report.sources.selectedSourceIds.length} 个)`);

console.log("\n本地服务:");
for (const [id, status] of Object.entries(report.services)) {
  const label = status.state === "running" ? "运行中" : status.state === "missing" ? "未安装" : status.state;
  console.log(`  - ${id}: ${label}${status.started ? "（刚启动）" : ""}${status.message ? ` — ${status.message}` : ""}`);
}

console.log("\n下一步:");
for (const step of report.next) console.log(`  ${step}`);
