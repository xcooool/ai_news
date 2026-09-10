import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

const BASELINE_FILES = [
  path.join(process.cwd(), "config/baseline-store.json.gz"),
  path.join(process.cwd(), "config/baseline-store.json"),
];

async function readBaselineFile(filePath) {
  const raw = await readFile(filePath);
  const json = filePath.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed.items)) throw new Error("原始数据库格式无效：缺少 items 数组");
  return parsed;
}

export async function loadBaselineStore() {
  for (const filePath of BASELINE_FILES) {
    try {
      return await readBaselineFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  return null;
}

export async function baselineStoreInfo() {
  for (const filePath of BASELINE_FILES) {
    try {
      const parsed = await readBaselineFile(filePath);
      const fileStat = await stat(filePath);
      return {
        available: true,
        path: path.basename(filePath),
        items: parsed.items.filter((item) => !item.sampleMode).length,
        exportedAt: parsed.exportedAt || parsed.updatedAt || null,
        label: parsed.label || "原始数据库",
        bytes: fileStat.size,
      };
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  return { available: false };
}
