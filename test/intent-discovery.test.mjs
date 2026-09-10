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

test("jike lifestyle post without project anchor is dropped", () => {
  const item = {
    name: "少楠Plidezus",
    tagline: "关于中国经济的读书清单",
    urls: ["https://m.okjike.com/originalPosts/2"],
    content: { text: "推荐几本书，和 AI 创业无关。" },
    collection: { sourceId: "jike" },
  };
  assert.equal(applyIntentClassification(item), null);
});

test("zhihu hotlist ai game chatter is dropped", () => {
  const item = {
    name: "既然 AI 一分钟就能开发出像消消乐这样的游戏，为什么排行榜上还是老游戏？",
    tagline: "热榜摘要",
    urls: ["https://www.zhihu.com/question/1"],
    content: { text: "AI 游戏开发讨论" },
    collection: { sourceId: "zhihu" },
  };
  assert.equal(applyIntentClassification(item), null);
});

test("jike agent share can stay as hotnews when keywords match", () => {
  const item = {
    name: "新 agent 框架发布",
    tagline: "开源仓库已公开",
    urls: ["https://m.okjike.com/originalPosts/3"],
    content: { text: "团队发布了一个新的 agent 工具，欢迎试用。" },
    collection: { sourceId: "jike" },
  };
  const kept = applyIntentClassification(item);
  assert.equal(kept.type, "hotnews");
});

test("zhihu entry with github anchor is kept as open_source", () => {
  const item = {
    name: "这个 ai startup 开源了 agent 框架",
    tagline: "github.com/acme/agent",
    urls: ["https://www.zhihu.com/question/2"],
    content: { text: "团队把仓库放在 https://github.com/acme/agent" },
    collection: { sourceId: "zhihu", outboundLinks: ["https://github.com/acme/agent"] },
  };
  const kept = applyIntentClassification(item);
  assert.equal(kept.type, "open_source");
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
