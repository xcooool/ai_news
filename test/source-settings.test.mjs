import test from "node:test";
import assert from "node:assert/strict";
import { scheduleLabel, scheduleToCron, summarizeSourceTargets, validateSourceSettings } from "../lib/source-settings.mjs";
import { defaultConnectors } from "../lib/connectors.mjs";

test("schedule helpers map daily hour and labels", () => {
  assert.equal(scheduleToCron("manual"), null);
  assert.equal(scheduleToCron("hourly"), "0 * * * *");
  assert.equal(scheduleToCron("daily:9"), "0 9 * * *");
  assert.equal(scheduleLabel("daily:9", true), "每天 09:00");
  assert.equal(scheduleLabel("manual", false), "仅手动");
});

test("xiaohongshu target summary uses xhsKeywords", () => {
  const config = { ...defaultConnectors(), xhsKeywords: ["ai startup", "ai github"] };
  assert.equal(summarizeSourceTargets("xiaohongshu", config), "ai startup · ai github");
});

test("validateSourceSettings rejects invalid schedule", () => {
  assert.throws(() => validateSourceSettings({ github: { schedule: "weekly", limit: 12 } }));
});
