/** Shared collect window presets for limit + time range. */

export const TIME_RANGE_PRESETS = {
  "1h": { label: "近 1 小时", ms: 60 * 60 * 1000, githubDays: 1, hnSeconds: 3600 },
  "1d": { label: "近 1 天", ms: 24 * 60 * 60 * 1000, githubDays: 1, hnSeconds: 86400 },
  "1w": { label: "近 1 周", ms: 7 * 24 * 60 * 60 * 1000, githubDays: 7, hnSeconds: 604800 },
  "30d": { label: "近 30 天", ms: 30 * 24 * 60 * 60 * 1000, githubDays: 30, hnSeconds: 2592000 },
  "90d": { label: "近 90 天", ms: 90 * 24 * 60 * 60 * 1000, githubDays: 90, hnSeconds: 7776000 },
  all: { label: "不限", ms: null, githubDays: 365, hnSeconds: null },
};

export const LIMIT_PRESETS = [12, 24, 50, 100];

export function parseCollectOptions(input = {}) {
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 12));
  const timeRange = Object.hasOwn(TIME_RANGE_PRESETS, input.timeRange) ? input.timeRange : "90d";
  const preset = TIME_RANGE_PRESETS[timeRange];
  return {
    limit,
    timeRange,
    timeRangeLabel: preset.label,
    cutoffMs: preset.ms ? Date.now() - preset.ms : null,
    githubDays: preset.githubDays,
    hnSinceUnix: preset.hnSeconds ? Math.floor(Date.now() / 1000) - preset.hnSeconds : null,
    xhsPublishTime: xhsPublishTimeFilter(timeRange),
  };
}

export function xhsPublishTimeFilter(timeRange) {
  if (timeRange === "1h" || timeRange === "1d") return "一天内";
  if (timeRange === "1w") return "一周内";
  return "半年内";
}

export function itemPublishedMs(item) {
  const directRepo = ["github", "github_kol"].includes(item.collection?.sourceId);
  const created = directRepo ? item.facts?.find((fact) => fact.kind === "created_at")?.value : null;
  const published =
    created ||
    item.collection?.publishedAt ||
    item.facts?.find((fact) => fact.kind === "published_at")?.value ||
    item.discoveredAt ||
    item.lastSeenAt;
  const ts = new Date(published || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function filterByTimeRange(items, collectOptions) {
  const cutoff = collectOptions?.cutoffMs;
  if (!cutoff) return items;
  return items.filter((item) => itemPublishedMs(item) >= cutoff);
}
