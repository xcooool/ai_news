import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateDiscovery,
  filterEmergingItems,
  filterEmergingTargets,
  githubEmergingQuery,
  hasEmergingProjectAnchor,
  isIncumbentHandle,
  isIncumbentGithubOrg,
  isIncumbentItem,
  isStaleStartup,
  parseBatchYear,
  textMentionsIncumbent,
} from "../lib/discovery.mjs";

test("incumbent handles and github orgs are detected", () => {
  assert.equal(isIncumbentHandle("GoogleDeepMind"), true);
  assert.equal(isIncumbentHandle("swyx"), false);
  assert.equal(isIncumbentGithubOrg("microsoft/autogen"), true);
  assert.equal(isIncumbentGithubOrg("browser-use/browser-use"), false);
});

test("watchlist targets for big labs are filtered out", () => {
  const kept = filterEmergingTargets([
    { id: "googledeepmind", handle: "GoogleDeepMind", enabled: true },
    { id: "swyx", handle: "swyx", enabled: true },
    { id: "openai", handle: "OpenAI", enabled: false },
  ]);
  assert.deepEqual(kept.map((t) => t.id), ["swyx"]);
});

test("github emerging query prefers mid-star recent repos and excludes labs", () => {
  const query = githubEmergingQuery({ days: 90, minStars: 3, maxStars: 3000 });
  assert.match(query, /created:>/);
  assert.match(query, /stars:3\.\.3000/);
  assert.match(query, /-org:openai/);
  assert.match(query, /-org:microsoft/);
  assert.doesNotMatch(query, /sort=stars/);
});

test("annotateDiscovery marks DeepMind-style items as incumbent", () => {
  const [deepmind, indie] = annotateDiscovery([
    {
      name: "Google DeepMind update",
      tagline: "Gemini launch",
      urls: ["https://x.com/GoogleDeepMind/status/1"],
      collection: { targetId: "googledeepmind", author: "Google DeepMind" },
    },
    {
      name: "acme/tiny-agent",
      tagline: "small agent runtime",
      urls: ["https://github.com/acme/tiny-agent"],
      collection: { sourceId: "github" },
    },
  ]);
  assert.equal(isIncumbentItem(deepmind), true);
  assert.equal(deepmind.discovery.incumbent, true);
  assert.equal(indie.discovery.incumbent, false);
});

test("text matching catches Chinese big-tech news headlines", () => {
  assert.equal(textMentionsIncumbent("字节跳动发布新模型"), true);
  assert.equal(textMentionsIncumbent("某开源 Agent 框架发布"), false);
});

test("feed-style big company news without project anchor is incumbent", () => {
  assert.equal(
    isIncumbentItem({
      name: "OpenAI 发布 GPT-5，多模态能力再升级",
      tagline: "Sam Altman 在发布会上介绍了新能力",
      urls: ["https://www.qbitai.com/2026/09/openai-gpt5.html"],
      collection: { sourceId: "feeds", outboundLinks: ["https://openai.com/blog/gpt-5"] },
    }),
    true,
  );
});

test("startup article comparing to ChatGPT but linking a repo is kept", () => {
  const item = {
    name: "Show HN: Local ChatGPT alternative for teams",
    tagline: "Self-hosted agent runtime",
    urls: ["https://news.ycombinator.com/item?id=1"],
    collection: {
      sourceId: "hackernews",
      outboundLinks: ["https://github.com/acme/local-agent"],
    },
  };
  assert.equal(hasEmergingProjectAnchor(item), true);
  assert.equal(isIncumbentItem(item), false);
});

test("huggingface spaces and models are not dropped as incumbent hosts", () => {
  const space = {
    name: "acme/demo-space",
    type: "open_source",
    urls: ["https://huggingface.co/spaces/acme/demo-space"],
    collection: { sourceId: "hf_spaces" },
  };
  const model = {
    name: "acme/tiny-agent",
    type: "open_source",
    urls: ["https://huggingface.co/acme/tiny-agent"],
    collection: { sourceId: "huggingface", publishedAt: "2026-08-01T00:00:00.000Z" },
  };
  // model URL path is /{owner}/{repo} not /models/ — still sourced as huggingface
  assert.equal(hasEmergingProjectAnchor(space), true);
  assert.equal(isIncumbentItem(space), false);
  assert.equal(hasEmergingProjectAnchor(model), true);
  assert.equal(isIncumbentItem(model), false);
});

test("filterEmergingItems drops incumbent news from mixed batch", () => {
  const kept = filterEmergingItems([
    { name: "Microsoft Copilot 更新", tagline: "Azure 集成", collection: { sourceId: "feeds" } },
    { name: "acme/agent", urls: ["https://github.com/acme/agent"], collection: { sourceId: "github" } },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, "acme/agent");
});

test("stale YC companies are not emerging potential", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  assert.equal(parseBatchYear("Summer 2012"), 2012);
  assert.equal(parseBatchYear("W24"), 2024);
  assert.equal(isStaleStartup({ collection: { raw: { batch: "Summer 2012", status: "Inactive" } } }, now), true);
  assert.equal(isStaleStartup({ collection: { raw: { batch: "Summer 2014", status: "Active" } } }, now), true);
  assert.equal(isStaleStartup({ collection: { raw: { batch: "Summer 2025", status: "Active" } } }, now), false);
  assert.equal(isStaleStartup({ collection: { raw: { batch: "Winter 2023", status: "Acquired" } } }, now), true);
});
