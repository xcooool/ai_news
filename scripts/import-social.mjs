import "../lib/env.mjs";
import { readFile } from "node:fs/promises";
import { parseSocialExport } from "../lib/social-import.mjs";
import { upsertItems, stableId } from "../lib/store.mjs";
const [sourceId, file] = process.argv.slice(2);
if (!sourceId || !file) throw new Error("用法：npm run import:social -- douyin /absolute/path/export.jsonl");
const startedAt = new Date().toISOString();
const { items, errors } = parseSocialExport(await readFile(file, "utf8"), sourceId);
const run = { id: stableId(`import:${startedAt}`), startedAt, finishedAt: new Date().toISOString(), sources: [sourceId], itemCount: items.length,
  errors, sourceResults: [{ sourceId, status: errors.length ? "partial" : items.length ? "ok" : "empty", itemCount: items.length, mode: "external_json_export" }] };
await upsertItems(items, run);
console.log(JSON.stringify(run, null, 2));
if (errors.length) process.exitCode = 1;
