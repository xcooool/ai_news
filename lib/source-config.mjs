import { sourceCatalog, implementedSourceIds } from "./sources.mjs";
import { readConnectors, saveConnectors, describeSetup } from "./connectors.mjs";
import { withXhsLogin, withWechatLogin } from "./connectors.mjs";
import { SETUP_FIELDS, configGet, applySetupForm } from "./source-setup.mjs";
import { scheduleLabel, scheduleOptions, summarizeSourceTargets } from "./source-settings.mjs";

export async function buildSourceConfigView(storeRuns = []) {
  const config = await readConnectors();
  let sources = sourceCatalog.filter((source) => implementedSourceIds().includes(source.id));
  sources = await withWechatLogin(await withXhsLogin(sources));
  return {
    timezone: "Asia/Shanghai",
    scheduleOptions,
    dailyHours: Array.from({ length: 24 }, (_, hour) => ({
      value: `daily:${hour}`,
      label: `每天 ${String(hour).padStart(2, "0")}:00`,
    })),
    sources: sources.map((source) => {
      const settings = config.sourceSettings?.[source.id] ?? {};
      const setup = describeSetup(source.id, config);
      return {
        id: source.id,
        name: source.name,
        notes: source.notes,
        region: source.region,
        status: source.status,
        login: source.login ?? null,
        setup,
        targetSummary: summarizeSourceTargets(source.id, config),
        schedule: settings.schedule ?? "manual",
        scheduleEnabled: Boolean(settings.scheduleEnabled),
        scheduleLabel: scheduleLabel(settings.schedule ?? "manual", settings.scheduleEnabled),
        limit: settings.limit ?? (source.id === "xiaohongshu" ? 20 : 12),
        fields: SETUP_FIELDS[source.id] ?? [],
        values: Object.fromEntries(
          (SETUP_FIELDS[source.id] ?? []).map((field) => [field.key, configGet(config, field.key)]),
        ),
      };
    }),
  };
}

export async function saveSourceConfig(sourceId, body) {
  if (!implementedSourceIds().includes(sourceId)) throw new Error("不支持的来源。");
  const existing = await readConnectors();
  const settings = existing.sourceSettings?.[sourceId] ?? {};
  const schedule = body.schedule ?? settings.schedule ?? "manual";
  const scheduleEnabled = Boolean(body.scheduleEnabled);
  const limit = Number(body.limit ?? settings.limit ?? 12);
  let next = SETUP_FIELDS[sourceId] ? applySetupForm(existing, body, sourceId) : { ...existing };
  next.sourceSettings = {
    ...existing.sourceSettings,
    [sourceId]: {
      schedule,
      scheduleEnabled: scheduleEnabled && schedule !== "manual",
      limit,
    },
  };
  return saveConnectors(next);
}
