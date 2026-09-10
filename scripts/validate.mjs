import { access } from "node:fs/promises";
import { sourceCatalog } from "../lib/sources.mjs";
import { defaultWeights, scoreItem } from "../lib/scoring.mjs";
import { readStore } from "../lib/store.mjs";

for (const file of ["server.mjs", "public/index.html", "public/app.js", "public/styles.css"]) {
  await access(file);
}

const store = await readStore();
const selectedSourceIds = store.settings.selectedSourceIds;
for (const item of store.items) {
  const scored = scoreItem(item, { selectedSourceIds, weights: defaultWeights });
  if (!scored || !Array.isArray(scored.dimensions)) throw new Error(`评分结构异常：${item.name}`);
}

const requiredSources = ["github", "hackernews", "huggingface", "wechat", "xiaohongshu", "douyin", "bilibili", "jike", "zhihu", "36kr"];
const missing = requiredSources.filter((id) => !sourceCatalog.some((source) => source.id === id));
if (missing.length) throw new Error(`数据源目录缺失：${missing.join(", ")}`);

console.log("Validation passed: static assets, source catalog, store, and scoring traces are usable.");
