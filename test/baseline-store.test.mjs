import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gzipSync } from "node:zlib";

test("mergeBaselineIntoStore adds and merges without replacing unrelated items", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "baseline-"));
  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(
    path.join(dataDir, "store.json"),
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      settings: { selectedSourceIds: ["github"] },
      runs: [],
      items: [
        { id: "keep_me", type: "startup", name: "Keep", sampleMode: false, facts: [{ kind: "note", value: "local", collectedAt: "2026-01-02T00:00:00.000Z" }] },
        { id: "shared", type: "open_source", name: "Shared Old", sampleMode: false, tagline: "old" },
      ],
    }),
  );
  await writeFile(
    path.join(root, "config/baseline-store.json.gz"),
    gzipSync(
      JSON.stringify({
        exportedAt: "2026-01-03T00:00:00.000Z",
        items: [
          { id: "shared", type: "open_source", name: "Shared New", sampleMode: false, tagline: "new", facts: [] },
          { id: "from_baseline", type: "startup", name: "Baseline Only", sampleMode: false, tagline: "seed" },
        ],
      }),
    ),
  );

  process.chdir(root);
  const { loadBaselineStore } = await import(`../lib/baseline-store.mjs?test=${Date.now()}`);
  const { mergeBaselineIntoStore, readStore } = await import(`../lib/store.mjs?test=${Date.now() + 1}`);

  const baseline = await loadBaselineStore();
  const result = await mergeBaselineIntoStore(baseline.items);
  const store = await readStore();

  assert.equal(result.added, 1);
  assert.equal(result.merged, 1);
  assert.equal(result.after, 3);
  assert.ok(store.items.find((item) => item.id === "keep_me"));
  assert.equal(store.items.find((item) => item.id === "shared").tagline, "new");
  assert.ok(store.items.find((item) => item.id === "from_baseline"));
});
