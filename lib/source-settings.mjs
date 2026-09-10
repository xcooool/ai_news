import { implementedSourceIds } from "./sources.mjs";
import { rssSourceIds } from "./connectors.mjs";

export const scheduleOptions = {
  manual: "仅手动",
  hourly: "每小时",
};

export function defaultSourceSetting(sourceId) {
  return { schedule: "manual", limit: sourceId === "xiaohongshu" ? 20 : 12, scheduleEnabled: false };
}

export function defaultSourceSettings() {
  return Object.fromEntries(implementedSourceIds().map((id) => [id, defaultSourceSetting(id)]));
}

export function validateSourceSettings(input, sourceIds = implementedSourceIds()) {
  const result = defaultSourceSettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const id of sourceIds) {
    const raw = input[id];
    if (!raw || typeof raw !== "object") continue;
    const base = defaultSourceSetting(id);
    const limit = Number(raw.limit ?? base.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`${id} 每目标条数须为 1–100 的整数。`);
    const schedule = String(raw.schedule ?? base.schedule);
    if (!["manual", "hourly"].includes(schedule) && !/^daily:(?:[01]?\d|2[0-3])$/.test(schedule)) {
      throw new Error(`${id} 定时策略无效。`);
    }
    result[id] = {
      schedule,
      limit,
      scheduleEnabled: Boolean(raw.scheduleEnabled) && schedule !== "manual",
    };
  }
  return result;
}

export function scheduleToCron(schedule) {
  if (!schedule || schedule === "manual") return null;
  if (schedule === "hourly") return "0 * * * *";
  const daily = schedule.match(/^daily:(\d{1,2})$/);
  if (daily) return `0 ${daily[1]} * * *`;
  return null;
}

export function scheduleLabel(schedule, scheduleEnabled = false) {
  if (!scheduleEnabled || schedule === "manual") return scheduleOptions.manual;
  if (schedule === "hourly") return scheduleOptions.hourly;
  const daily = schedule.match(/^daily:(\d{1,2})$/);
  if (daily) return `每天 ${String(daily[1]).padStart(2, "0")}:00`;
  return scheduleOptions.manual;
}

export function summarizeSourceTargets(sourceId, config) {
  if (sourceId === "xiaohongshu") return config.xhsKeywords?.length ? config.xhsKeywords.join(" · ") : "未配置搜索词";
  if (sourceId === "wechat") return config.wechatFeedIds?.length ? config.wechatFeedIds.join(" · ") : "未配置订阅";
  if (sourceId === "zhihu") {
    if (config.routes?.zhihu?.length) return `${config.routes.zhihu.length} 个作者订阅`;
    return config.zhihuKeywords?.length ? `热榜 · ${config.zhihuKeywords.join("、")}` : "热榜 · 全部";
  }
  if (rssSourceIds.includes(sourceId)) {
    const routes = config.routes?.[sourceId] ?? [];
    if (routes.length) return `${routes.length} 条订阅路由`;
    if (sourceId === "jike") return "内置作者 watchlist";
    return "需配置 RSSHub 路由";
  }
  if (sourceId === "feeds") return "内置媒体 / 机构 RSS";
  if (sourceId === "github_kol") return "内置作者 / 组织 watchlist";
  if (sourceId === "github") return "近 90 天新兴 AI 仓库";
  if (sourceId === "hackernews") return "Show HN / 热门讨论";
  if (sourceId === "huggingface") return "公开模型与数据集";
  if (sourceId === "hf_spaces") return "HF Spaces 热门";
  if (sourceId === "producthunt") return "需 PRODUCTHUNT_TOKEN";
  if (sourceId === "reddit") return "内置 subreddit RSS";
  if (sourceId === "x") return "内置作者 timeline";
  if (sourceId === "douyin") return "需配置作者主页";
  return "勾选后采集";
}

export function sourceLimit(sourceSettings, sourceId, fallback = 12) {
  return sourceSettings?.[sourceId]?.limit ?? fallback;
}
