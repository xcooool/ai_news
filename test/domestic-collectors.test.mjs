import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConnectors, validateConnectors, catalogWithConnections } from "../lib/connectors.mjs";
import { collectDomestic, normalizeJsonFeed, parseInteraction, serviceJson } from "../lib/domestic-collectors.mjs";
import { runCollectors } from "../lib/collectors.mjs";
import { sourceCatalog, implementedSourceIds } from "../lib/sources.mjs";
import { scoreItem, scoreKimiFit, defaultWeights } from "../lib/scoring.mjs";

const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
async function withXhsCookies(cookies, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "xhs-cookies-"));
  const file = path.join(dir, "cookies.json");
  await writeFile(file, JSON.stringify({ version: 2, cookies: cookies ?? [{ name: "session", value: "test" }] }));
  const previous = process.env.XHS_COOKIES_PATH;
  process.env.XHS_COOKIES_PATH = file;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.XHS_COOKIES_PATH;
    else process.env.XHS_COOKIES_PATH = previous;
  }
}
function configured() {
  return { ...defaultConnectors(), xhsBaseUrl: "http://localhost:18060", weweBaseUrl: "http://localhost:4000",
    rsshubBaseUrl: "http://localhost:1200", keywords: ["AI"], xhsKeywords: ["AI"],
    routes: { ...defaultConnectors().routes, zhihu: ["/zhihu/people/answers/example"], jike: ["/jike/topic/example"] } };
}

test("domestic sources are automatic but not falsely marked connected", () => {
  for (const id of ["wechat", "xiaohongshu", "zhihu", "jike", "douyin", "bilibili", "36kr"]) {
    assert.ok(implementedSourceIds().includes(id));
    const source = catalogWithConnections(sourceCatalog, defaultConnectors()).find(x => x.id === id);
    assert.equal(source.status, id === "jike" ? "implemented" : id === "zhihu" ? "configured" : "needs_setup");
    assert.equal(source.connection.state, "not_tested");
  }
});

test("connector validation rejects credentials, escaped routes and unbounded inputs", () => {
  const config = configured();
  assert.equal(validateConnectors(config).xhsBaseUrl, config.xhsBaseUrl);
  assert.throws(() => validateConnectors({ ...config, xhsBaseUrl: "http://user:password@localhost" }));
  assert.throws(() => validateConnectors({ ...config, keywords: Array(11).fill("AI") }));
  for (const route of ["https://wrong.example/zhihu/a", "/zhihu/../../secret", "/zhihu/%2e%2e/secret", "/jike/topic/x"]) {
    assert.throws(() => validateConnectors({ ...config, routes: { zhihu: [route] } }));
  }
});

test("platform profile links become matching subscription routes", () => {
  const config = configured();
  config.routes.zhihu = ["https://www.zhihu.com/people/example/answers"];
  config.routes.jike = ["https://web.okjike.com/topic/123", "https://m.okjike.com/users/456"];
  const validated = validateConnectors(config);
  assert.deepEqual(validated.routes.zhihu, ["/zhihu/people/answers/example"]);
  assert.deepEqual(validated.routes.jike, ["/jike/topic/123", "/jike/user/456"]);
  config.routes.jike = ["https://web.okjike.com.evil.example/topic/123"];
  assert.throws(() => validateConnectors(config));
});

test("unconfigured and logged-out sources fail without fabricating records", async () => {
  await assert.rejects(collectDomestic("wechat", defaultConnectors(), 2, () => assert.fail("must not fetch")), { code: "needs_setup" });
  await withXhsCookies([], async () => {
    await assert.rejects(collectDomestic("xiaohongshu", configured(), 2, () => assert.fail("must not fetch")), { code: "needs_login" });
  });
  await withXhsCookies([{ name: "session", value: "test" }], async () => {
    const paths = [];
    await assert.rejects(collectDomestic("xiaohongshu", configured(), 2, async url => {
      paths.push(new URL(url).pathname); return json({ success: true, data: { is_logged_in: false } });
    }), { code: "needs_login" });
    assert.deepEqual(paths, ["/api/v1/login/status"]);
  });
});

test("JSON feeds keep original URLs and body, filter unrelated content and do not invent scores", () => {
  const items = normalizeJsonFeed({ items: [
    { id: "1", title: "AI 企业知识库", url: "https://mp.weixin.qq.com/s/abc", content_html: "<p>AI 新闻</p>" },
    { id: "2", title: "周末散步", url: "https://mp.weixin.qq.com/s/def" },
    { id: "3", title: "AI", url: "javascript:alert(1)" },
  ] }, "wechat", ["AI"]);
  assert.equal(items.length, 1);
  assert.equal(items[0].urls[0], "https://mp.weixin.qq.com/s/abc");
  assert.equal(items[0].content.html, "<p>AI 新闻</p>");
  assert.equal(items[0].collection.entityVerified, false);
  assert.equal(scoreItem(items[0], { selectedSourceIds: ["wechat"], weights: defaultWeights }).potentialIndex, null);
  assert.throws(() => normalizeJsonFeed({ message: "login required" }, "wechat"), { code: "invalid_response" });
});

test("WeWe uses JSON feed endpoint, deduplicates subscriptions and respects limit", async () => {
  const config = { ...configured(), wechatFeedIds: ["all", "MP_WXS_123"] };
  const paths = [];
  const batch = await collectDomestic("wechat", config, 1, async url => {
    const parsed = new URL(url); paths.push(parsed.pathname);
    assert.equal(parsed.searchParams.get("limit"), "100");
    return json({ items: [1, 1, 2].map(id => ({ id, title: "AI", url: `https://mp.weixin.qq.com/s/${id}` })) });
  });
  assert.equal(batch.items.length, 1);
  assert.deepEqual(paths, ["/feeds/all.json"]);
});

test("RSSHub uses JSON output and preserves a successful route when another fails", async () => {
  const config = configured();
  config.routes.jike.push("/jike/user/second");
  const batch = await collectDomestic("jike", config, 5, async url => {
    const parsed = new URL(url); assert.equal(parsed.searchParams.get("format"), "json");
    if (parsed.pathname.includes("topic")) return new Response("blocked", { status: 403 });
    return json({ items: [{ id: "1", title: "AI", url: "https://m.okjike.com/originalPosts/1" }] });
  });
  assert.equal(batch.items.length, 1);
  assert.equal(batch.warnings[0].code, "needs_login");
});

test("XHS searches and reads detail using only read operations, preserving share URL", async () => {
  await withXhsCookies(undefined, async () => {
  const paths = [];
  const batch = await collectDomestic("xiaohongshu", configured(), 1, async (url, options) => {
    const pathname = new URL(url).pathname; paths.push(pathname);
    if (pathname.endsWith("status")) return json({ success: true, data: { is_logged_in: true } });
    const body = JSON.parse(options.body);
    if (pathname.endsWith("search")) {
      assert.equal(body.keyword, "AI");
      assert.equal(body.filters.sort_by, "最新");
      return json({ success: true, data: { feeds: [{ id: "note1", xsecToken: "share+token", noteCard: { displayTitle: "AI 开源助手" } }] } });
    }
    assert.equal(body.xsec_token, "share+token");
    assert.equal(body.load_all_comments, false);
    return json({ success: true, data: { data: { note: { title: "AI 开源助手", desc: "Agent 正文", interactInfo: { likedCount: "1.7万", commentCount: "" } } } } });
  });
  assert.deepEqual(paths, ["/api/v1/login/status", "/api/v1/feeds/search", "/api/v1/feeds/detail"]);
  assert.equal(batch.items[0].content.text, "Agent 正文");
  assert.equal(new URL(batch.items[0].urls[0]).searchParams.get("xsec_token"), "share+token");
  assert.equal(batch.items[0].evidence.length, 1);
  assert.equal(batch.items[0].evidence[0].metric.value, 17000);
  assert.equal(scoreKimiFit(batch.items[0], { selectedSourceIds: ["xiaohongshu"], weights: defaultWeights }).index, null);
  });
});

test("wechat WERSS path requires login before fetching feed", async () => {
  const previous = process.env.WERSS_BASE_URL;
  process.env.WERSS_BASE_URL = "http://werss.test";
  process.env.WERSS_USERNAME = "admin";
  process.env.WERSS_PASSWORD = "x";
  try {
    let hitFeed = false;
    await assert.rejects(
      collectDomestic("wechat", { ...configured(), wechatFeedIds: ["all"] }, 2, async (url) => {
        if (String(url).includes("/auth/login")) {
          return new Response(JSON.stringify({ code: 0, data: { access_token: "t" } }), { status: 200 });
        }
        if (String(url).includes("/auth/qr/status")) {
          return new Response(JSON.stringify({ code: 0, data: { login_status: false } }), { status: 200 });
        }
        hitFeed = true;
        return new Response("<rss/>", { status: 200 });
      }),
      (error) => error.code === "needs_login",
    );
    assert.equal(hitFeed, false);
  } finally {
    if (previous === undefined) delete process.env.WERSS_BASE_URL;
    else process.env.WERSS_BASE_URL = previous;
    delete process.env.WERSS_USERNAME;
    delete process.env.WERSS_PASSWORD;
  }
});

test("detail failure retains search result and reports partial collection", async () => {
  await withXhsCookies(undefined, async () => {
  const result = await runCollectors({ sources: ["xiaohongshu"], connectors: configured(), limit: 1, fetcher: async url => {
    if (url.includes("login/status")) return json({ data: { is_logged_in: true } });
    if (url.includes("feeds/search")) return json({ data: { feeds: [{ id: "n", xsecToken: "s", noteCard: { displayTitle: "AI" } }] } });
    if (url.includes("feeds/detail")) return new Response("timeout", { status: 504 });
    assert.fail(`Unexpected request: ${url}`);
  } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].collection.detailFetched, false);
  assert.deepEqual(result.run.sourceResults.map(x => x.status), ["partial"]);
  assert.equal(result.run.errors.length, 1);
  });
});

test("interaction counts preserve missing vs zero and service errors do not expose upstream body", async () => {
  assert.equal(parseInteraction(""), null);
  assert.equal(parseInteraction("未知"), null);
  assert.equal(parseInteraction("0"), 0);
  assert.equal(parseInteraction("10万+"), 100000);
  await assert.rejects(serviceJson("http://localhost", {}, async () => new Response("SECRET", { status: 429 })), error => error.code === "rate_limited" && !error.message.includes("SECRET"));
});

test("XHS distinguishes a slow search and an offline service from expired login", async () => {
  await assert.rejects(serviceJson("http://localhost/api/v1/feeds/search", {}, async () => {
    throw new DOMException("timed out", "TimeoutError");
  }), error => error.code === "timeout" && error.message.includes("90 秒"));
  await assert.rejects(serviceJson("http://localhost/api/v1/login/status", {}, async () => {
    throw new TypeError("fetch failed");
  }), { code: "unreachable" });
});

test("domestic collection sends completion progress even on its early continue", async () => {
  await withXhsCookies(undefined, async () => {
    const progress = [];
    const result = await runCollectors({ sources: ["xiaohongshu"], connectors: configured(), onProgress: event => progress.push(event), fetcher: async url => {
      if (url.includes("login/status")) return json({ data: { is_logged_in: true } });
      throw new DOMException("timed out", "TimeoutError");
    } });
    assert.deepEqual(progress.map(event => event.phase), ["start", "done"]);
    assert.equal(progress[1].itemCount, 0);
    assert.match(result.run.errors[0].message, /搜索「AI」失败/);
  });
});
