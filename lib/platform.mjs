import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import PQueue from "p-queue";
import { providerCatalog, collectProvider } from "./provider-adapters.mjs";
import { serviceUrl, readConnectors } from "./connectors.mjs";
import { request, fail } from "./acquisition.mjs";
import { implementedSourceIds } from "./sources.mjs";
import { scheduleToCron, sourceLimit } from "./source-settings.mjs";

export const schedules = { manual: "仅手动", hourly: "每小时", "0 * * * *": "每小时", "0 9 * * *": "每天 09:00" };

export class CollectionPlatform {
  constructor({ directory = path.join(process.cwd(), "data"), runCollectors, upsertItems, fetcher = fetch, readConfig = readConnectors } = {}) {
    this.file = path.join(directory, "platform.json");
    mkdirSync(directory, { recursive: true });
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : { schemaVersion: 2, timezone: "Asia/Shanghai", providers: Object.fromEntries(providerCatalog.map((p) => [p.id, { baseUrl: p.baseUrl }])), checks: {}, runs: [] };
    this.queue = new PQueue({ concurrency: 1 });
    this.schedules = new Map();
    this.active = new Map();
    this.runCollectors = runCollectors;
    this.upsertItems = upsertItems;
    this.fetcher = fetcher;
    this.readConfig = readConfig;
    for (const run of this.state.runs) if (["running", "queued"].includes(run.status)) { run.status = "interrupted"; run.finishedAt = new Date().toISOString(); }
    this.persist();
    this.reschedule();
  }

  persist() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  async reschedule() {
    for (const job of this.schedules.values()) job.stop();
    this.schedules.clear();
    const config = await this.readConfig();
    for (const sourceId of implementedSourceIds()) {
      const settings = config.sourceSettings?.[sourceId];
      const cron = settings?.scheduleEnabled ? scheduleToCron(settings.schedule) : null;
      if (!cron) continue;
      this.schedules.set(sourceId, new Cron(cron, { timezone: this.state.timezone, protect: true }, () => this.enqueueSource(sourceId, "schedule")));
    }
  }

  async scheduledSources() {
    const config = await this.readConfig();
    return implementedSourceIds().map((sourceId) => {
      const settings = config.sourceSettings?.[sourceId] ?? {};
      return {
        sourceId,
        schedule: settings.schedule ?? "manual",
        scheduleEnabled: Boolean(settings.scheduleEnabled),
        limit: sourceLimit(config.sourceSettings, sourceId),
        nextRunAt: this.schedules.get(sourceId)?.nextRun()?.toISOString() || null,
        activeRunId: this.active.get(sourceId) || null,
      };
    });
  }

  snapshot() {
    return {
      ...this.state,
      providers: providerCatalog.map((p) => ({ ...p, ...this.state.providers[p.id], check: this.state.checks[p.id] || null })),
      scheduledSources: [],
      queueSize: this.queue.size,
      running: this.queue.pending,
      schedules,
    };
  }

  async fullSnapshot() {
    const base = this.snapshot();
    base.scheduledSources = await this.scheduledSources();
    return base;
  }

  saveProvider(id, input) {
    const provider = providerCatalog.find((p) => p.id === id);
    if (!provider) throw fail("not_found", "服务不存在");
    const baseUrl = provider.baseUrl ? serviceUrl(String(input.baseUrl || "").trim()) : "";
    if (provider.baseUrl && !baseUrl) throw fail("invalid_config", "服务地址不能为空");
    this.state.providers[id] = { baseUrl };
    delete this.state.checks[id];
    this.persist();
    return this.state.providers[id];
  }

  async checkProvider(id) {
    const provider = providerCatalog.find((p) => p.id === id);
    if (!provider) throw fail("not_found", "服务不存在");
    let check;
    try {
      if (!provider.healthPath) check = { state: "task_required", message: "该来源没有统一登录状态，请运行一条任务验证。" };
      else {
        const headers = id === "xiaohongshu" && process.env.XHS_MCP_TOKEN ? { Authorization: `Bearer ${process.env.XHS_MCP_TOKEN}` } : {};
        await request(`${this.state.providers[id].baseUrl}${provider.healthPath}`, { headers }, this.fetcher);
        check = { state: "reachable", message: "服务可达；平台登录与数据可用性以任务结果为准。" };
      }
    } catch (error) { check = { state: error.code || "error", message: error.message }; }
    this.state.checks[id] = { ...check, at: new Date().toISOString() };
    this.persist();
    return this.state.checks[id];
  }

  enqueueSource(sourceId, trigger = "manual") {
    if (!implementedSourceIds().includes(sourceId)) throw fail("not_found", "来源不存在");
    if (this.active.has(sourceId)) return this.state.runs.find((r) => r.id === this.active.get(sourceId));
    const run = {
      id: randomUUID(),
      sourceId,
      taskName: sourceId,
      trigger,
      status: "queued",
      queuedAt: new Date().toISOString(),
      itemCount: 0,
      errors: [],
      targetResults: [],
    };
    this.active.set(sourceId, run.id);
    this.state.runs.unshift(run);
    this.state.runs = this.state.runs.slice(0, 200);
    this.persist();
    this.queue.add(async () => {
      run.status = "running";
      run.startedAt = new Date().toISOString();
      this.persist();
      try {
        const config = await this.readConfig();
        const limit = sourceLimit(config.sourceSettings, sourceId, 12);
        const result = await this.runCollectors({ sources: [sourceId], limit, connectors: config, fetcher: this.fetcher });
        run.itemCount = result.items.length;
        run.errors = result.run.errors || [];
        run.targetResults = result.run.sourceResults || [];
        const errors = run.errors.filter((e) => e.code !== "pagination_remaining");
        run.status = errors.length ? (result.items.length ? "partial" : errors[0].code || "error") : result.items.length ? "ok" : "empty";
        run.finishedAt = new Date().toISOString();
        await this.upsertItems(result.items, result.run);
      } catch (error) {
        run.status = error.code || "error";
        run.errors = [{ code: error.code || "error", message: error.message }];
      } finally {
        run.finishedAt = new Date().toISOString();
        this.active.delete(sourceId);
        this.persist();
      }
    }).catch((error) => {
      run.status = "error";
      run.errors = [{ message: error.message }];
      this.active.delete(sourceId);
      this.persist();
    });
    return run;
  }

  close() { for (const job of this.schedules.values()) job.stop(); }
}
