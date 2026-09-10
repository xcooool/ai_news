import test from "node:test";
import assert from "node:assert/strict";
import { mergeConnectors, prepareRuntime, templateConnectors } from "../lib/bootstrap.mjs";
import { defaultConnectors } from "../lib/connectors.mjs";

test("prepareRuntime starts services even when bootstrap is skipped", async () => {
  let called = false;
  await prepareRuntime({
    startServices: true,
    start: async () => {
      called = true;
      return { wechat: { state: "running" } };
    },
  });
  assert.equal(called, true);
});

test("mergeConnectors fills empty xhs and keywords without clobbering user values", () => {
  const template = templateConnectors();
  const merged = mergeConnectors({ ...defaultConnectors(), xhsBaseUrl: "", keywords: [], xhsKeywords: [] }, template);
  assert.equal(merged.xhsBaseUrl, "http://127.0.0.1:18060");
  assert.deepEqual(merged.keywords, template.keywords);
  assert.deepEqual(merged.xhsKeywords, template.xhsKeywords);
  assert.deepEqual(merged.wechatFeedIds, ["all"]);
});

test("mergeConnectors keeps existing user keywords", () => {
  const merged = mergeConnectors(
    { ...defaultConnectors(), xhsBaseUrl: "http://127.0.0.1:9999", keywords: ["自定义"], xhsKeywords: ["ai startup"] },
    templateConnectors(),
  );
  assert.equal(merged.xhsBaseUrl, "http://127.0.0.1:9999");
  assert.deepEqual(merged.keywords, ["自定义"]);
  assert.deepEqual(merged.xhsKeywords, ["ai startup"]);
});
