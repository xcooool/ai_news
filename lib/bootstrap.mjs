import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { defaultConnectors, defaultRssHubRoutes, saveConnectors, readConnectors } from "./connectors.mjs";
import { LOCAL_SERVICES, ensureServiceRunning } from "./local-services.mjs";
import { readStore, updateSettings } from "./store.mjs";

const ENV_DEFAULTS = {
  WERSS_BASE_URL: "http://127.0.0.1:8001",
  DOUYIN_API_BASE_URL: "http://127.0.0.1:8002",
};

export const DEFAULT_SELECTED_SOURCE_IDS = [
  "github",
  "hackernews",
  "huggingface",
  "hf_spaces",
  "github_kol",
  "feeds",
  "jike",
  "reddit",
  "x",
  "xiaohongshu",
  "wechat",
];

export function templateConnectors() {
  return validateLike({
    xhsBaseUrl: "http://127.0.0.1:18060",
    weweBaseUrl: "",
    rsshubBaseUrl: "",
    keywords: ["AI", "智能体", "大模型", "开源", "创业"],
    xhsKeywords: ["ai startup", "ai github"],
    wechatFeedIds: ["all"],
    routes: {
      zhihu: [],
      jike: [],
      douyin: [],
      bilibili: [],
      "36kr": [...defaultRssHubRoutes["36kr"]],
    },
  });
}

function validateLike(input) {
  return {
    ...defaultConnectors(),
    ...input,
    keywords: [...input.keywords],
    xhsKeywords: [...(input.xhsKeywords ?? defaultConnectors().xhsKeywords)],
    wechatFeedIds: [...input.wechatFeedIds],
    routes: { ...defaultConnectors().routes, ...input.routes },
    sourceSettings: { ...(defaultConnectors().sourceSettings ?? {}), ...(input.sourceSettings ?? {}) },
  };
}

export function mergeConnectors(existing, template) {
  const merged = validateLike({
    xhsBaseUrl: existing.xhsBaseUrl || template.xhsBaseUrl,
    weweBaseUrl: existing.weweBaseUrl || template.weweBaseUrl,
    rsshubBaseUrl: existing.rsshubBaseUrl || template.rsshubBaseUrl,
    keywords: existing.keywords?.length ? existing.keywords : template.keywords,
    xhsKeywords: existing.xhsKeywords?.length ? existing.xhsKeywords : template.xhsKeywords,
    wechatFeedIds: existing.wechatFeedIds?.length ? existing.wechatFeedIds : template.wechatFeedIds,
    routes: Object.fromEntries(
      Object.keys(template.routes).map((id) => [
        id,
        existing.routes?.[id]?.length ? existing.routes[id] : template.routes[id],
      ]),
    ),
  });
  return merged;
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureEnvDefaults(defaults = ENV_DEFAULTS) {
  const envPath = path.join(process.cwd(), ".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const present = new Set();
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) present.add(match[1]);
  }
  const additions = Object.entries(defaults)
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => `${key}=${value}`);
  if (!additions.length) return { path: envPath, added: [] };
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  const block = `${content}${prefix}${additions.join("\n")}\n`;
  await writeFile(envPath, block, { mode: 0o600 });
  for (const line of additions) {
    const [key, ...rest] = line.split("=");
    process.env[key] = rest.join("=");
  }
  return { path: envPath, added: additions.map((line) => line.split("=")[0]) };
}

export async function ensureConnectorDefaults() {
  const template = templateConnectors();
  let existing = defaultConnectors();
  if (await fileExists(path.join(process.cwd(), "data/connectors.json"))) {
    existing = await readConnectors();
  }
  const merged = mergeConnectors(existing, template);
  const saved = await saveConnectors(merged);
  return { saved, changed: JSON.stringify(existing) !== JSON.stringify(saved) };
}

export async function ensureSelectedSources() {
  const store = await readStore();
  const current = new Set(store.settings.selectedSourceIds ?? []);
  const merged = [...new Set([...DEFAULT_SELECTED_SOURCE_IDS, ...current])];
  if (merged.length === current.size && DEFAULT_SELECTED_SOURCE_IDS.every((id) => current.has(id))) {
    return { selectedSourceIds: [...current], changed: false };
  }
  const settings = await updateSettings({ selectedSourceIds: merged });
  return { selectedSourceIds: settings.selectedSourceIds, changed: true };
}

export async function startLocalServices({ start = true } = {}) {
  const results = {};
  for (const service of LOCAL_SERVICES) {
    results[service.id] = await ensureServiceRunning(service, { start });
  }
  return results;
}

export async function bootstrap(options = {}) {
  const { startServices = true, force = false } = options;
  if (!force && !(await needsBootstrap())) {
    return { skipped: true, message: "配置已存在，使用 npm run setup -- --force 强制重写默认值" };
  }

  const env = await ensureEnvDefaults();
  const connectors = await ensureConnectorDefaults();
  const sources = await ensureSelectedSources();
  const services = startServices ? await startLocalServices({ start: true }) : {};

  return {
    skipped: false,
    env,
    connectors,
    sources,
    services,
    next: [
      "小红书首次使用：npm run xhs:qrcode 扫码登录",
      "公众号：打开 http://127.0.0.1:8001 管理页扫码并添加订阅",
      "启动工作台：npm run dev",
      "采集全部：npm run collect -- feeds jike github hackernews huggingface xiaohongshu wechat",
    ],
  };
}

async function needsBootstrap() {
  if (!(await fileExists(path.join(process.cwd(), "data/connectors.json")))) return true;
  if (!(await fileExists(path.join(process.cwd(), ".env")))) return true;
  try {
    const env = await readFile(path.join(process.cwd(), ".env"), "utf8");
    if (!/^WERSS_BASE_URL=/m.test(env) || !/^DOUYIN_API_BASE_URL=/m.test(env)) return true;
  } catch {
    return true;
  }
  return false;
}

export async function bootstrapIfNeeded(options = {}) {
  if (!(await needsBootstrap())) return null;
  return bootstrap({ ...options, force: true });
}

export async function prepareRuntime({ startServices = true, start = startLocalServices } = {}) {
  const boot = await bootstrapIfNeeded({ startServices: false });
  const services = startServices ? await start({ start: true }) : {};
  return { boot, services };
}
