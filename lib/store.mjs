import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultWeights } from "./scoring.mjs";
import { archiveCollection } from "./acquisition.mjs";
import { getSource } from "./sources.mjs";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

export async function readStore() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const seeded = createSeedStore();
    await writeStore(seeded);
    return seeded;
  }
}

export async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function upsertItems(items, run) {
  await archiveCollection(items, run);
  const store = await readStore();
  const byId = new Map(store.items.map((item) => [item.id, item]));
  for (const item of items) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? mergeItem(existing, item) : item);
  }
  store.items = [...byId.values()];
  store.runs = [run, ...(store.runs ?? [])].slice(0, 50);
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return store;
}

export async function updateItemStatus(id, status) {
  const store = await readStore();
  store.items = store.items.map((item) => (item.id === id ? { ...item, status } : item));
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return store.items.find((item) => item.id === id);
}

export async function updateSettings(patch) {
  const store = await readStore();
  store.settings = { ...store.settings, ...patch };
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return store.settings;
}

export async function purgeSampleItems() {
  const store = await readStore();
  const samples = store.items.filter((item) => item.sampleMode);
  if (!samples.length) return { removed: 0 };
  store.items = store.items.filter((item) => !item.sampleMode);
  store.settings = { ...store.settings, sampleModeVisible: false };
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return { removed: samples.length };
}

export async function mergeBaselineIntoStore(baselineItems) {
  const store = await readStore();
  const before = store.items.filter((item) => !item.sampleMode).length;
  const byId = new Map(store.items.map((item) => [item.id, item]));
  let added = 0;
  let merged = 0;
  const addedBySource = new Map();
  for (const item of baselineItems) {
    if (item.sampleMode) continue;
    const incoming = { ...item, sampleMode: false };
    const existing = byId.get(incoming.id);
    if (existing) {
      byId.set(incoming.id, mergeItem(existing, incoming));
      merged += 1;
    } else {
      byId.set(incoming.id, incoming);
      added += 1;
      const sourceId = incoming.collection?.sourceId || "unknown";
      addedBySource.set(sourceId, (addedBySource.get(sourceId) || 0) + 1);
    }
  }
  store.items = [...byId.values()];
  store.updatedAt = new Date().toISOString();
  store.settings = {
    ...store.settings,
    baselineMergedAt: store.updatedAt,
  };
  await writeStore(store);
  const after = store.items.filter((item) => !item.sampleMode).length;
  const bySource = [...addedBySource.entries()]
    .map(([id, count]) => ({ id, name: getSource(id)?.name || id, added: count }))
    .sort((a, b) => b.added - a.added);
  return { before, after, added, merged, skippedSamples: baselineItems.length - added - merged, total: store.items.length, bySource };
}

export async function importMaterial(material, extracted) {
  const store = await readStore();
  const now = new Date().toISOString();
  const item = {
    id: stableId(`${material.type}:${material.name}:${material.url || now}`),
    type: material.type,
    name: material.name,
    tagline: extracted.tagline || "手动导入材料",
    country: extracted.country || "未知",
    stage: extracted.stage || "待研究",
    status: "watching",
    sampleMode: false,
    discoveredAt: now,
    lastSeenAt: now,
    aliases: extracted.aliases ?? [],
    urls: material.url ? [material.url] : [],
    facts: extracted.facts ?? [],
    evidence: extracted.evidence,
    history: [],
    collection: {
      sourceId: material.sourceId,
      mode: "manual_import",
      modelConnected: extracted.modelConnected,
      warning: extracted.warning,
    },
  };
  const existingIndex = store.items.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) store.items[existingIndex] = mergeItem(store.items[existingIndex], item);
  else store.items.unshift(item);
  store.imports = [
    {
      id: stableId(`import:${now}:${material.name}`),
      ...material,
      extractedSummary: extracted.summary,
      createdAt: now,
    },
    ...(store.imports ?? []),
  ].slice(0, 100);
  store.updatedAt = now;
  await writeStore(store);
  return item;
}

export function stableId(input) {
  let hash = 5381;
  for (const char of input) hash = (hash * 33) ^ char.charCodeAt(0);
  return `i_${(hash >>> 0).toString(16)}`;
}

function mergeItem(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    status: existing.status ?? incoming.status ?? "new",
    discoveredAt: existing.discoveredAt ?? incoming.discoveredAt,
    evidence: dedupeById([...(existing.evidence ?? []), ...(incoming.evidence ?? [])]),
    urls: [...new Set([...(existing.urls ?? []), ...(incoming.urls ?? [])])],
    facts: dedupeFacts([...(incoming.facts ?? []), ...(existing.facts ?? [])]),
    sampleMode: existing.sampleMode && incoming.sampleMode,
  };
}

function dedupeById(entries) {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function dedupeFacts(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.value}:${entry.url}:${entry.collectedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createSeedStore() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    updatedAt: now,
    settings: {
      weights: defaultWeights,
      selectedSourceIds: ["github", "hackernews", "huggingface", "feeds", "wechat", "company_site"],
      sampleModeVisible: false,
    },
    runs: [],
    imports: [],
    items: [],
  };
}

export async function confirmAnalysisEntity({recordId,name,url,type}) {
  if(!['startup','open_source'].includes(type) || typeof name!=='string' || !name.trim() || name.length>200) throw new Error('请填写项目名称和类型');
  const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('请填写有效的项目公开地址');
  u.hash='';
  const store=await readStore();const item=store.items.find(i=>i.id===recordId);if(!item || item.sampleMode)throw new Error('原始记录不存在');
  item.analysisEntity={name:name.trim(),url:u.href,type,confirmedAt:new Date().toISOString()};
  await writeStore(store);return item.analysisEntity;
}
