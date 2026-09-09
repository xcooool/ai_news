import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultWeights } from "./scoring.mjs";

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
    const key = `${entry.kind}:${entry.value}:${entry.url}`;
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
      selectedSourceIds: ["github", "hackernews", "huggingface", "wechat", "36kr", "company_site"],
      sampleModeVisible: true,
    },
    runs: [],
    imports: [],
    items: [
      {
        id: "sample_openclaw_like",
        type: "open_source",
        name: "示例 OpenClaw-like Agent Runtime",
        tagline: "示例模式：多工具 Agent 运行时，展示评分链路，不代表真实实时数据。",
        country: "示例",
        stage: "开源早期",
        status: "watching",
        sampleMode: true,
        discoveredAt: now,
        lastSeenAt: now,
        aliases: ["openclaw sample"],
        urls: ["https://example.com/sample-openclaw"],
        facts: [
          {
            kind: "warning",
            value: "此记录为示例模式，所有数字只用于演示 UI 与评分解释。",
            credibility: "model_inference",
            collectedAt: now,
          },
        ],
        evidence: [
          {
            id: "sample_github_stars",
            sourceId: "github",
            dimensionId: "real_adoption",
            kimiDimensionId: "model_api_need",
            metric: { name: "stars", value: 4200, method: "log", excellent: 50000, start: 1 },
            credibility: "fact",
            confidence: 0.36,
            url: "https://example.com/sample-openclaw",
            note: "star 只作为关注度线索，低置信进入采用维度。",
            collectedAt: now,
          },
          {
            id: "sample_recent_push",
            sourceId: "github",
            dimensionId: "maintenance_delivery",
            metric: { name: "pushed_at", value: now, method: "recency" },
            credibility: "fact",
            confidence: 0.7,
            url: "https://example.com/sample-openclaw",
            note: "近期维护活跃。",
            collectedAt: now,
          },
          {
            id: "sample_integrations",
            sourceId: "company_site",
            dimensionId: "ecosystem_expansion",
            kimiDimensionId: "technical_fit",
            metric: { name: "integration_claim", value: "good", method: "anchored_level" },
            credibility: "self_reported",
            confidence: 0.5,
            url: "https://example.com/sample-openclaw/docs",
            note: "官网自述支持多模型/多工具集成，需第三方验证。",
            collectedAt: now,
          },
        ],
        history: [],
        collection: { mode: "sample" },
      },
      {
        id: "sample_manus_like",
        type: "startup",
        name: "示例 Manus-like Workflow AI",
        tagline: "示例模式：面向销售/运营团队的浏览器 Agent，不代表真实公司。",
        country: "示例",
        stage: "产品验证",
        status: "watching",
        sampleMode: true,
        discoveredAt: now,
        lastSeenAt: now,
        aliases: ["manus sample"],
        urls: ["https://example.com/sample-manus"],
        facts: [
          {
            kind: "warning",
            value: "此记录为示例模式，与真实采集数据完全区分。",
            credibility: "model_inference",
            collectedAt: now,
          },
        ],
        evidence: [
          {
            id: "sample_hn_interest",
            sourceId: "hackernews",
            dimensionId: "demand_validated",
            kimiDimensionId: "model_api_need",
            metric: { name: "hn_points", value: 380, method: "log", excellent: 2000, start: 1 },
            credibility: "third_party_estimate",
            confidence: 0.56,
            url: "https://news.ycombinator.com/",
            note: "HN 讨论表示早期兴趣，不代表付费需求。",
            collectedAt: now,
          },
          {
            id: "sample_case_claim",
            sourceId: "company_site",
            dimensionId: "value_realized",
            kimiDimensionId: "technical_fit",
            metric: { name: "case_study_claim", value: "plausible", method: "anchored_level" },
            credibility: "self_reported",
            confidence: 0.48,
            url: "https://example.com/sample-manus/customers",
            note: "客户案例来自官网自述，未按第三方事实处理。",
            collectedAt: now,
          },
          {
            id: "sample_jobs_gtm",
            sourceId: "jobs",
            dimensionId: "scale_conditions",
            kimiDimensionId: "partnership_timing",
            metric: { name: "gtm_hiring", value: "good", method: "anchored_level" },
            credibility: "fact",
            confidence: 0.54,
            url: "https://example.com/sample-manus/jobs",
            note: "GTM 招聘说明规模化准备度线索。",
            collectedAt: now,
          },
        ],
        history: [],
        collection: { mode: "sample" },
      },
    ],
  };
}
