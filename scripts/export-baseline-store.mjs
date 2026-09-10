import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const storePath = path.join(process.cwd(), "data/store.json");
const outPath = path.join(process.cwd(), "config/baseline-store.json.gz");

const store = JSON.parse(await readFile(storePath, "utf8"));
const items = store.items
  .filter((item) => !item.sampleMode)
  .map(({ content, history, ...rest }) => rest);

const baseline = {
  schemaVersion: 1,
  label: "原始数据库",
  exportedAt: new Date().toISOString(),
  source: "data/store.json",
  itemCount: items.length,
  items,
};

await mkdir(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(baseline);
const compressed = gzipSync(json);
await writeFile(outPath, compressed);
console.log(`已导出 ${items.length} 条到 ${outPath}（gzip ${(compressed.length / 1e6).toFixed(2)} MB）`);
