import "../lib/env.mjs";
import { readStore } from "../lib/store.mjs";
import { readWatchlist } from "../lib/acquisition.mjs";
import { sourceCatalog } from "../lib/sources.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const store = await readStore(), watchlist = await readWatchlist();
const sources = sourceCatalog.filter(s => s.automatic || s.status === "implemented").map(s => {
  const items = store.items.filter(i => !i.sampleMode && i.collection?.sourceId === s.id);
  const run = store.runs.find(r => r.sourceResults?.some(x => x.sourceId === s.id));
  const last = run?.sourceResults.find(x => x.sourceId === s.id);
  return { sourceId: s.id, name: s.name, storedItems: items.length, targets: watchlist[s.id]?.length || null,
    lastStatus: last?.status || "not_tested", lastRunAt: run?.finishedAt || null, targetResults: last?.targetResults || [] };
});
const report = { generatedAt: new Date().toISOString(), realItems: store.items.filter(i => !i.sampleMode).length, sources };
await mkdir('data', { recursive: true });
await writeFile('data/source-status.json', JSON.stringify(report, null, 2));
console.table(sources.map(({ sourceId, storedItems, lastStatus, targets }) => ({ sourceId, storedItems, lastStatus, targets })));
console.log(`真实内容合计 ${report.realItems} 条；详细报告 data/source-status.json；原始版本 data/raw/。`);
