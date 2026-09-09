import { runCollectors } from "../lib/collectors.mjs";
import { implementedSourceIds } from "../lib/sources.mjs";
import { upsertItems } from "../lib/store.mjs";

const sources = process.argv.slice(2).length ? process.argv.slice(2) : implementedSourceIds();
const result = await runCollectors({ sources, limit: Number(process.env.COLLECT_LIMIT || 12) });
await upsertItems(result.items, result.run);
console.log(JSON.stringify(result.run, null, 2));
if (result.run.errors.length) process.exitCode = 1;
