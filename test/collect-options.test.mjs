import test from "node:test";
import assert from "node:assert/strict";
import {
  filterByTimeRange,
  itemPublishedMs,
  parseCollectOptions,
  xhsPublishTimeFilter,
} from "../lib/collect-options.mjs";

test("parseCollectOptions clamps limit and defaults timeRange", () => {
  const options = parseCollectOptions({ limit: 500, timeRange: "bad" });
  assert.equal(options.limit, 100);
  assert.equal(options.timeRange, "90d");
  assert.equal(options.githubDays, 90);
});

test("filterByTimeRange keeps recent items only", () => {
  const now = Date.now();
  const options = parseCollectOptions({ limit: 10, timeRange: "1d" });
  const items = [
    { id: "old", discoveredAt: new Date(now - 3 * 86400000).toISOString() },
    { id: "new", collection: { publishedAt: new Date(now - 3600000).toISOString() } },
  ];
  const kept = filterByTimeRange(items, options);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, "new");
});

test("xhsPublishTimeFilter maps windows", () => {
  assert.equal(xhsPublishTimeFilter("1h"), "一天内");
  assert.equal(xhsPublishTimeFilter("1w"), "一周内");
  assert.equal(xhsPublishTimeFilter("90d"), "半年内");
});

test("itemPublishedMs prefers publishedAt", () => {
  const ms = itemPublishedMs({
    discoveredAt: "2020-01-01T00:00:00.000Z",
    collection: { publishedAt: "2026-09-09T00:00:00.000Z" },
  });
  assert.equal(new Date(ms).toISOString(), "2026-09-09T00:00:00.000Z");
});
