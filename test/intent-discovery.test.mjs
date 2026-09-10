import test from "node:test";
import assert from "node:assert/strict";
import {
  applyIntentClassification,
  classifyItemType,
  matchesIntentKeywords,
  githubIntentQueries,
} from "../lib/intent-discovery.mjs";

test("intent keywords match startup and github phrases", () => {
  assert.equal(matchesIntentKeywords("This ai startup just raised seed"), true);
  assert.equal(matchesIntentKeywords("ai hot github repo for agents"), true);
  assert.equal(matchesIntentKeywords("今天天气不错"), false);
});

test("github repo anchor classifies as open_source", () => {
  const item = {
    name: "Cool agent",
    tagline: "Check it out",
    urls: ["https://github.com/acme/agent"],
    content: { text: "New tool" },
    collection: { sourceId: "jike", outboundLinks: ["https://github.com/acme/agent"] },
  };
  assert.equal(classifyItemType(item), "open_source");
});

test("generic jike comment without intent is dropped", () => {
  const item = {
    name: "随便聊聊",
    tagline: "今天模型又更新了",
    urls: ["https://m.okjike.com/originalPosts/1"],
    content: { text: "OpenAI 真强" },
    collection: { sourceId: "jike" },
  };
  assert.equal(applyIntentClassification(item), null);
});

test("intent-matching news without anchor becomes hotnews", () => {
  const item = {
    name: "AI startup 融资观察",
    tagline: "ai startup 融资趋势观察",
    urls: ["https://news.example/1"],
    content: { text: "多家 ai startup 获得融资，市场仍在升温" },
    collection: { sourceId: "feeds" },
  };
  const kept = applyIntentClassification(item);
  assert.equal(kept.type, "hotnews");
});

test("github intent queries include startup and oss bands", () => {
  const queries = githubIntentQueries({ days: 30, minStars: 5, maxStars: 1000 });
  assert.equal(queries.length, 3);
  assert.match(queries[1], /open source/);
  assert.match(queries[2], /ai startup/);
  for (const query of queries) assert.ok((query.match(/\b(?:AND|OR|NOT)\b/g) || []).length <= 5);
});
