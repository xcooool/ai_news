import { readFile } from "node:fs/promises";
import { saveConnectors, domesticSourceIds, connectorReadiness } from "../lib/connectors.mjs";

if (!process.argv[2]) throw new Error("用法：npm run connectors:configure -- config/connectors.example.json");
const config = await saveConnectors(JSON.parse(await readFile(process.argv[2], "utf8")));
console.log("连接配置已保存到 data/connectors.json。配置成功不代表上游已登录或采集成功。");
for (const id of domesticSourceIds) console.log(`${id}: ${connectorReadiness(id, config)}`);
