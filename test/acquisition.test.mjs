import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, parseJikePage, collectAcquisition, eachTarget, rawItem } from "../lib/acquisition.mjs";
const target = { id: "author", name: "作者", url: "https://example.com/feed" };
const response = data => new Response(JSON.stringify(data));

test("RSS/Atom/JSON preserve text without filtering; HTML error pages are rejected", () => {
  const rss = '<rss><channel><item><guid>1</guid><title>新产品</title><link>https://example.com/1</link><description><![CDATA[<p>完整文章</p>]]></description><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const [item] = parseFeed(rss, "feeds", target);
  assert.equal(item.content.html, "<p>完整文章</p>");
  assert.equal(item.content.text, "完整文章");
  assert.equal(item.collection.publishedAt, "2026-09-08T10:00:00.000Z");
  assert.deepEqual(item.evidence, []);
  assert.equal(parseFeed('<feed><entry><id>x</id><link rel="self" href="https://example.com/api"/><link rel="alternate" href="https://example.com/post"/><content>body</content></entry></feed>', "feeds", target)[0].urls[0], "https://example.com/post");
  assert.equal(parseFeed(JSON.stringify({ items: [{ id: "n", url: "https://example.com/n", content_text: "没有关键词" }] }), "feeds", target).length, 1);
  assert.throws(() => parseFeed('<html>Login</html>', "feeds", target), { code: "invalid_response" });
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>', "feeds", target), { code: "invalid_response" });
});

test("Jike preserves reposts and verifies configured identity", () => {
  const data = { props: { pageProps: { user: { screenName: "作者" }, posts: [{ id: "123", type: "REPOST", content: "看看", createdAt: "2026-09-08T01:00:00Z", target: { content: "原文", user: { screenName: "原作者" } }, urlsInText: [{ originalUrl: "https://github.com/test/repo" }] }] } } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const [item] = parseJikePage(html, target);
  assert.equal(item.urls[0], "https://m.okjike.com/reposts/123");
  assert.ok(item.content.text.includes("原文"));
  assert.deepEqual(item.collection.outboundLinks, ["https://github.com/test/repo"]);
  assert.throws(() => parseJikePage(html, { ...target, expectedName: "错号" }), { code: "identity_mismatch" });
});

test("every target gets attempted; failures do not discard successful targets", async () => {
  const calls = [];
  const result = await eachTarget(["a", "b", "c"].map(id => ({ ...target, id })), async t => {
    calls.push(t.id);
    if (t.id === "b") throw Object.assign(new Error("blocked"), { code: "needs_login" });
    return [rawItem("feeds", { id: t.id, url: `https://example.com/${t.id}`, text: "body" }, t, "rss")];
  });
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.equal(result.items.length, 2);
  assert.equal(result.targetResults[1].status, "needs_login");
});

test("rate_limited stops remaining targets instead of hammering the upstream", async () => {
  const calls = [];
  const result = await eachTarget(["a", "b", "c"].map(id => ({ ...target, id })), async t => {
    calls.push(t.id);
    throw Object.assign(new Error("上游 HTTP 429"), { code: "rate_limited" });
  });
  assert.deepEqual(calls, ["a"]);
  assert.equal(result.targetResults[0].status, "rate_limited");
  assert.equal(result.targetResults.filter(t => t.status === "skipped_rate_limit").length, 2);
  assert.ok(result.warnings.some(w => w.message.includes("已跳过剩余 2 个目标")));
});

test("X handles missing credentials and author timeline pagination", async () => {
  const old = process.env.X_BEARER_TOKEN, oldPages = process.env.X_MAX_PAGES, oldMode = process.env.X_MODE;
  try {
    delete process.env.X_BEARER_TOKEN;
    process.env.X_MODE = "api";
    const config = { x: [{ ...target, handle: "author" }] };
    const missing = await collectAcquisition("x", 10, () => assert.fail("must not fetch"), config);
    assert.equal(missing.targetResults[0].status, "needs_key");
    process.env.X_BEARER_TOKEN = "test-secret"; process.env.X_MAX_PAGES = "2";
    let calls = 0;
    const result = await collectAcquisition("x", 5, async (input, options) => {
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      const url = new URL(input); calls++;
      if (url.pathname.includes("by/username")) return response({ data: { id: "42", name: "作者" } });
      const second = url.searchParams.has("pagination_token");
      return response({ data: [{ id: second ? "2" : "1", text: "ai startup launch https://acme.example", created_at: "2026-09-08T01:00:00Z" }], meta: second ? {} : { next_token: "next" } });
    }, config);
    assert.equal(calls, 3); assert.equal(result.items.length, 2);
    assert.equal(JSON.stringify(result.items).includes("test-secret"), false);
    process.env.X_MODE = "embed";
    const blocked = await collectAcquisition("x", 5, async (input) => {
      const url = new URL(input);
      assert.ok(!url.hostname.includes("syndication.twitter.com"), "must not fall back to embed when token is set");
      if (url.pathname.includes("by/username")) {
        return new Response("", { status: 402, statusText: "Payment Required" });
      }
      return response({});
    }, config);
    assert.equal(blocked.targetResults[0].status, "needs_credits");
  } finally {
    if (old === undefined) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = old;
    if (oldPages === undefined) delete process.env.X_MAX_PAGES; else process.env.X_MAX_PAGES = oldPages;
    if (oldMode === undefined) delete process.env.X_MODE; else process.env.X_MODE = oldMode;
  }
});
