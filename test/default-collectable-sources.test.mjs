import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionSourceIds, collectAcquisition } from "../lib/acquisition.mjs";
import { defaultConnectors, catalogWithConnections } from "../lib/connectors.mjs";
import { sourceCatalog, SOURCE_STATUS, implementedSourceIds } from "../lib/sources.mjs";

const DEFAULT_KEYWORDS = [
  "ai github",
  "ai startup",
  "ai startup hiring",
  "ai hot github",
  "AI",
  "agent",
  "llm",
  "开源",
];
const DEFAULT_ZHIHU = ["AI", "agent", "llm", "开源", "智能体", "大模型"];

test("default connectors bake in shared + zhihu keyword defaults", () => {
  const config = defaultConnectors();
  assert.deepEqual(config.keywords, DEFAULT_KEYWORDS);
  assert.deepEqual(config.zhihuKeywords, DEFAULT_ZHIHU);
});

test("YC and X are first-class automatic sources; Xiaohongshu stays setup-gated", () => {
  assert.ok(implementedSourceIds().includes("yc"));
  assert.ok(acquisitionSourceIds.includes("yc"));
  const byId = Object.fromEntries(sourceCatalog.map((s) => [s.id, s]));
  assert.equal(byId.yc.status, SOURCE_STATUS.IMPLEMENTED);
  assert.equal(byId.x.status, SOURCE_STATUS.IMPLEMENTED);
  assert.equal(byId.xiaohongshu.status, SOURCE_STATUS.NEEDS_SETUP);
  for (const id of ["github", "huggingface", "hf_spaces", "hackernews", "reddit", "jike", "zhihu", "feeds", "github_kol"]) {
    assert.ok(implementedSourceIds().includes(id), `${id} should be collectable`);
  }
});

test("catalog marks Product Hunt ready only when token exists; X ready without token", () => {
  const old = process.env.PRODUCTHUNT_TOKEN;
  try {
    delete process.env.PRODUCTHUNT_TOKEN;
    const without = catalogWithConnections(sourceCatalog, defaultConnectors());
    assert.equal(without.find((s) => s.id === "producthunt").status, SOURCE_STATUS.NEEDS_KEY);
    assert.equal(without.find((s) => s.id === "x").status, SOURCE_STATUS.IMPLEMENTED);
    assert.equal(without.find((s) => s.id === "yc").status, SOURCE_STATUS.IMPLEMENTED);
    assert.equal(without.find((s) => s.id === "zhihu").status, "configured");

    process.env.PRODUCTHUNT_TOKEN = "ph-test";
    const withToken = catalogWithConnections(sourceCatalog, defaultConnectors());
    assert.equal(withToken.find((s) => s.id === "producthunt").status, SOURCE_STATUS.IMPLEMENTED);
  } finally {
    if (old === undefined) delete process.env.PRODUCTHUNT_TOKEN;
    else process.env.PRODUCTHUNT_TOKEN = old;
  }
});

test("YC acquisition keeps full recent-active set and ignores per-source limit", async () => {
  const result = await collectAcquisition(
    "yc",
    1,
    async () =>
      new Response(
        JSON.stringify([
          { id: 1, name: "A", url: "https://example.com/a", batch: "Summer 2025", status: "Active", one_liner: "ai" },
          { id: 2, name: "B", url: "https://example.com/b", batch: "Winter 2024", status: "Active", one_liner: "llm" },
          { id: 3, name: "Old", url: "https://example.com/c", batch: "Summer 2012", status: "Inactive", one_liner: "ai" },
        ]),
      ),
    { yc: [{ id: "ai", name: "YC AI", path: "tags/artificial-intelligence.json", enabled: true }] },
  );
  assert.deepEqual(result.items.map((i) => i.name).sort(), ["A", "B"]);
  assert.equal(result.targetResults[0].coverage, "active_recent_batches");
});
