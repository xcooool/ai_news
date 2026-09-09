import test from "node:test";
import assert from "node:assert/strict";
import { scoreItem } from "../lib/scoring.mjs";

test("zero selected sources produces no score", () => {
  const result = scoreItem(sampleItem(), { selectedSourceIds: [] });
  assert.equal(result.potentialIndex, null);
  assert.equal(result.state, "no_sources");
  assert.equal(result.dimensions.every((dimension) => dimension.effectiveWeight === 0), true);
});

test("zero configured weights produces no score", () => {
  const result = scoreItem(sampleItem(), {
    selectedSourceIds: ["github"],
    weights: { real_adoption: 0, maintenance_delivery: 0, growth_persistence: 0, ecosystem_expansion: 0 },
  });
  assert.equal(result.potentialIndex, null);
  assert.equal(result.state, "zero_weight");
});

test("missing evidence is unknown, not zero", () => {
  const result = scoreItem({ ...sampleItem(), evidence: [] }, { selectedSourceIds: ["github"] });
  assert.equal(result.potentialIndex, null);
  assert.equal(result.state, "no_evidence");
});

test("single high evidence is coverage-penalized", () => {
  const result = scoreItem(sampleItem(), { selectedSourceIds: ["github"] });
  assert.equal(result.state, "partial_evidence");
  assert.ok(result.coverage < 0.45);
  assert.ok(result.potentialIndex < 60);
  assert.equal(result.dimensions.filter((dimension) => dimension.dimensionScore !== null).length, 1);
});

function sampleItem() {
  return {
    id: "sample",
    type: "open_source",
    name: "sample",
    evidence: [
      {
        id: "e1",
        sourceId: "github",
        dimensionId: "real_adoption",
        metric: { name: "stars", value: 100000, method: "log", excellent: 50000 },
        credibility: "fact",
        confidence: 0.35,
        collectedAt: new Date().toISOString(),
        note: "stars only",
      },
    ],
  };
}
