import test from "node:test";
import assert from "node:assert/strict";
import { collectDomestic } from "../lib/domestic-collectors.mjs";
import { defaultConnectors } from "../lib/connectors.mjs";
import { collectProvider } from "../lib/provider-adapters.mjs";
import { collectZhihuHot, matchesZhihuKeywords } from "../lib/zhihu.mjs";

const fetcher = async url => {
  assert.equal(new URL(url).hostname, "www.zhihu.com");
  return Response.json({ data: [{ target: {
    title_area: { text: "人工智能的新进展" }, excerpt_area: { text: "问题摘要" },
    link: { url: "https://www.zhihu.com/question/123" },
  } }] });
};

test("unconfigured Zhihu uses direct hotlist and retains metadata without inventing a publication date", async () => {
  const batch = await collectDomestic("zhihu", defaultConnectors(), 12, fetcher);
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].content.text, "问题摘要");
  assert.equal(batch.items[0].collection.mode, "zhihu_hot_api");
  assert.equal(batch.items[0].collection.publishedAt, null);
  assert.equal(batch.items[0].collection.coverage, "hotlist_metadata");
});

test("existing hotlist tasks read Zhihu directly without NewsNow", async () => {
  const batch = await collectProvider({ provider: "newsnow", targets: ["zhihu"], limit: 12 }, { baseUrl: "https://unavailable.example" }, { fetcher });
  assert.equal(batch.items.length, 1);
  assert.equal(batch.targetResults[0].status, "ok");
});

test("Zhihu rejects blocked and incompatible responses instead of reporting empty success", async () => {
  await assert.rejects(collectZhihuHot(12, async () => new Response("blocked", { status: 403 })), { code: "access_denied" });
  await assert.rejects(collectZhihuHot(12, async () => Response.json({ data: [{}] })), { code: "invalid_response" });
});

test("Zhihu filters before limiting and does not match AI inside unrelated English words", async () => {
  assert.equal(matchesZhihuKeywords({name:"daily news"}, ["AI"]), false);
  assert.equal(matchesZhihuKeywords({name:"AI 有哪些进展"}, ["AI"]), true);
  const response = async () => Response.json({data:["西瓜", "人工智能"].map((text,index)=>({target:{title_area:{text},link:{url:`https://www.zhihu.com/question/${index}`}}}))});
  const filtered = await collectZhihuHot(1, response, ["人工智能"]);
  assert.equal(filtered.items[0].name, "人工智能");
  assert.equal((await collectZhihuHot(12, response, ["大模型"])).items.length, 0);
  assert.equal((await collectZhihuHot(12, response, [])).items.length, 2);
});
