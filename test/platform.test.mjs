import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CollectionPlatform } from "../lib/platform.mjs";
import { collectProvider } from "../lib/provider-adapters.mjs";
import { defaultConnectors, validateConnectors } from "../lib/connectors.mjs";
const response = (d) => new Response(JSON.stringify(d));

test("platform schedules sources, avoids duplicate jobs and serializes execution", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "collection-platform-"));
  const config = validateConnectors({
    ...defaultConnectors(),
    sourceSettings: {
      github: { schedule: "hourly", scheduleEnabled: true, limit: 5 },
      hackernews: { schedule: "manual", scheduleEnabled: false, limit: 5 },
    },
  });
  let running = 0;
  let peak = 0;
  let calls = 0;
  const platform = new CollectionPlatform({
    directory,
    readConfig: async () => config,
    upsertItems: async () => {},
    runCollectors: async () => {
      calls++;
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 15));
      running--;
      return { items: [], run: { errors: [], sourceResults: [] } };
    },
  });
  try {
    const scheduled = await platform.scheduledSources();
    assert.ok(scheduled.find((entry) => entry.sourceId === "github")?.nextRunAt);
    const run = platform.enqueueSource("github");
    assert.equal(platform.enqueueSource("github").id, run.id);
    platform.enqueueSource("hackernews");
    await platform.queue.onIdle();
    assert.equal(calls, 2);
    assert.equal(peak, 1);
    assert.equal(run.status, "empty");
    platform.close();
    const restored = new CollectionPlatform({ directory, readConfig: async () => config, runCollectors: async () => ({ items: [], run: { errors: [], sourceResults: [] } }), upsertItems: async () => {} });
    try {
      assert.equal(restored.state.runs.length, 2);
    } finally {
      restored.close();
    }
  } finally {
    platform.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("provider updates are atomic", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "collection-platform-"));
  const platform = new CollectionPlatform({ directory });
  try {
    const before = platform.state.providers.newsnow.baseUrl;
    assert.throws(() => platform.saveProvider("newsnow", { baseUrl: "" }));
    assert.equal(platform.state.providers.newsnow.baseUrl, before);
  } finally {
    platform.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("NewsNow adapter preserves platform rank, caching and original URL without inventing body", async () => {
  const result = await collectProvider({ provider: "newsnow", targets: ["douyin"], limit: 10 }, { baseUrl: "http://localhost:9000" }, {
    fetcher: async (url) => {
      assert.equal(url, "http://localhost:9000/api/s?id=douyin");
      return response({ status: "cache", updatedTime: 1234, items: [{ id: "n", title: "热点", url: "https://www.douyin.com/hot/123" }] });
    },
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].collection.sourceId, "douyin");
  assert.equal(result.items[0].content.text, "");
  assert.equal(result.items[0].collection.raw.upstreamStatus, "cache");
  assert.equal(result.items[0].facts.find((f) => f.kind === "rank").value, 1);
});

test("CodeNexus consumes existing paginated API and reports remaining pages", async () => {
  const calls = [];
  const result = await collectProvider({ provider: "codenexus", targets: ["news"], limit: 1, maxPages: 2 }, { baseUrl: "http://localhost:9000" }, {
    fetcher: async (url) => {
      calls.push(url);
      const n = new URL(url).searchParams.get("page");
      return response({ items: [{ id: n, title: "新闻", url: `https://example.com/${n}` }], total_pages: 3 });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.targetResults[0].hasMore, true);
});

test("YC directory keeps the full recent-active set instead of the first N rows", async () => {
  const result = await collectProvider({ provider: "yc", targets: ["companies/all.json"], limit: 1 }, { baseUrl: "https://yc-oss.github.io/api" }, {
    fetcher: async () => response([
      { id: 1, name: "A", url: "https://example.com/a", batch: "Summer 2025", status: "Active" },
      { id: 2, name: "B", url: "https://example.com/b", batch: "Winter 2024", status: "Active" },
      { id: 3, name: "Canopy Labs", url: "https://example.com/c", batch: "Summer 2012", status: "Inactive" },
    ]),
  });
  assert.deepEqual(result.items.map((i) => i.name), ["A", "B"]);
  assert.equal(result.targetResults[0].coverage, "active_recent_batches");
});
