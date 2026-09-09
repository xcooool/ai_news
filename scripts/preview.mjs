import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readStore } from "../lib/store.mjs";
import { readConnectors, catalogWithConnections } from "../lib/connectors.mjs";
import { sourceCatalog } from "../lib/sources.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const sources = moduleUrl(await readFile(new URL("../lib/sources.mjs", import.meta.url), "utf8"));
const scoring = moduleUrl((await readFile(new URL("../lib/scoring.mjs", import.meta.url), "utf8"))
  .replace('"./sources.mjs"', JSON.stringify(sources)));
const store = await readStore();
const connectors = await readConnectors();
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const adapter = `
import { sourceCatalog } from ${JSON.stringify(sources)};
import { scoreItems, openSourceDimensions, startupDimensions, kimiDimensions } from ${JSON.stringify(scoring)};
const snapshot = ${JSON.stringify(store).replaceAll("<", "\\u003c")};
const connectors = ${JSON.stringify(connectors).replaceAll("<", "\\u003c")};
const connectedSources = ${JSON.stringify(catalogWithConnections(sourceCatalog, connectors, store.runs)).replaceAll("<", "\\u003c")};
const originalFetch = window.fetch;
window.fetch = async (input, options = {}) => {
  const url = new URL(input, "http://preview.local");
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, options);
  if (options.method && options.method !== "GET") {
    return new Response(JSON.stringify({error:"离线只读预览：请启动 npm run dev 后刷新、导入或保存。"}), {status:409});
  }
  if (url.pathname === "/api/connectors") return new Response(JSON.stringify(connectors));
  const q = url.searchParams;
  const selectedSourceIds = q.has("sources") ? q.get("sources").split(",").filter(Boolean) : snapshot.settings.selectedSourceIds;
  const weights = q.has("weights") ? JSON.parse(q.get("weights")) : snapshot.settings.weights;
  const items = snapshot.items.filter(item =>
    (!q.get("type") || q.get("type") === "all" || item.type === q.get("type")) &&
    (!q.get("status") || q.get("status") === "all" || item.status === q.get("status")) &&
    (q.get("samples") !== "false" || !item.sampleMode));
  return new Response(JSON.stringify({
    items:scoreItems(items,{selectedSourceIds,weights}), sources:connectedSources,
    dimensions:{open_source:openSourceDimensions,startup:startupDimensions,kimi_fit:kimiDimensions},
    selectedSourceIds,weights,settings:snapshot.settings,runs:snapshot.runs,model:{kimiConnected:false}
  }),{headers:{"Content-Type":"application/json"}});
};
const disableWrites = () => document.querySelectorAll("#refreshBtn,#saveWeightsBtn,#importForm button,#connectionsForm button,[data-status-action]").forEach(button => {
  button.disabled = true;
  button.title = "离线只读预览，请运行 npm run dev 使用此操作";
});
new MutationObserver(disableWrites).observe(document.getElementById("app"), {childList:true,subtree:true});
document.getElementById("exportBtn").addEventListener("click", event => {
  event.stopImmediatePropagation();
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:"application/json"}));
  const link = document.createElement("a"); link.href = url; link.download = "ai-news-snapshot.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
${app}
disableWrites();
`;
await mkdir("outputs", { recursive: true });
await writeFile("outputs/preview.html", html
  .replace('<link rel="icon" href="/favicon.svg" />', "")
  .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${css}</style>`)
  .replace('<div id="app">', '<div style="padding:10px 24px;background:#fff0cc;color:#624300">离线只读预览 · 已采集数据快照 · 刷新、导入与保存需运行 npm run dev</div><div id="app">')
  .replace('<script type="module" src="/app.js"></script>', `<script type="module" src="${moduleUrl(adapter)}"></script>`));
console.log(`Offline preview: ${process.cwd()}/outputs/preview.html (${store.items.length} records)`);
