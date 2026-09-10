import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { xhsLoginState } from "../lib/xhs-auth.mjs";

test("xhsLoginState reports missing login when cookies are empty", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xhs-auth-"));
  const file = path.join(dir, "cookies.json");
  await writeFile(file, JSON.stringify({ version: 2, cookies: [] }));
  const previous = process.env.XHS_COOKIES_PATH;
  process.env.XHS_COOKIES_PATH = file;
  try {
    const state = await xhsLoginState();
    assert.equal(state.loggedIn, false);
    assert.match(state.reason, /尚未登录|cookies/i);
  } finally {
    if (previous === undefined) delete process.env.XHS_COOKIES_PATH;
    else process.env.XHS_COOKIES_PATH = previous;
  }
});

test("withXhsLogin annotates xiaohongshu login state", async () => {
  const { withXhsLogin } = await import("../lib/connectors.mjs");
  const sources = await withXhsLogin(
    [{ id: "xiaohongshu", name: "小红书" }, { id: "github", name: "GitHub" }],
    { loggedIn: true, savedAt: "2026-09-09T22:22:49+08:00" },
  );
  assert.equal(sources[0].login.loggedIn, true);
  assert.equal(sources[0].login.savedAt, "2026-09-09T22:22:49+08:00");
  assert.equal(sources[1].login, undefined);
});
