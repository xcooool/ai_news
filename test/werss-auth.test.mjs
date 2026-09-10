import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWerssAdminCredentials, resolveWerssQrcode, werssLoginState } from "../lib/werss-auth.mjs";
import { withWechatLogin } from "../lib/connectors.mjs";

test("readWerssAdminCredentials reads USERNAME/PASSWORD from service .env", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "werss-env-"));
  await writeFile(path.join(dir, ".env"), "USERNAME=admin\nPASSWORD=secret\n", { mode: 0o600 });
  const prevUser = process.env.WERSS_USERNAME;
  const prevPass = process.env.WERSS_PASSWORD;
  delete process.env.WERSS_USERNAME;
  delete process.env.WERSS_PASSWORD;
  try {
    const creds = await readWerssAdminCredentials(dir);
    assert.deepEqual(creds, { username: "admin", password: "secret" });
  } finally {
    if (prevUser === undefined) delete process.env.WERSS_USERNAME;
    else process.env.WERSS_USERNAME = prevUser;
    if (prevPass === undefined) delete process.env.WERSS_PASSWORD;
    else process.env.WERSS_PASSWORD = prevPass;
  }
});

test("werssLoginState reports loggedIn from qr/status login_status", async () => {
  const state = await werssLoginState({
    baseUrl: "http://werss.test",
    fetcher: async (url, options = {}) => {
      if (String(url).endsWith("/api/v1/wx/auth/login")) {
        return new Response(JSON.stringify({ code: 0, data: { access_token: "tok" } }), { status: 200 });
      }
      if (String(url).includes("/api/v1/wx/auth/qr/status")) {
        assert.match(options.headers.Authorization, /Bearer tok/);
        return new Response(JSON.stringify({ code: 0, data: { login_status: true, qr_code: false } }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    },
    credentials: { username: "admin", password: "x" },
  });
  assert.equal(state.loggedIn, true);
});

test("resolveWerssQrcode waits for QR png and returns a data URL", async () => {
  let hits = 0;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const result = await resolveWerssQrcode({
    baseUrl: "http://127.0.0.1:8001",
    pollMs: 1,
    timeoutMs: 1000,
    fetcher: async (url) => {
      if (String(url).endsWith("/api/v1/wx/auth/login")) {
        return new Response(JSON.stringify({ code: 0, data: { access_token: "tok" } }), { status: 200 });
      }
      if (String(url).includes("/api/v1/wx/auth/qr/code")) {
        return new Response(JSON.stringify({ code: 0, data: { code: "/static/wx_qrcode.png?t=1", is_exists: false } }), { status: 200 });
      }
      if (String(url).includes("/api/v1/wx/auth/qr/status")) {
        return new Response(JSON.stringify({ code: 0, data: { login_status: false, qr_code: hits > 0 } }), { status: 200 });
      }
      if (String(url).includes("/static/wx_qrcode.png")) {
        hits += 1;
        if (hits < 2) return new Response("missing", { status: 404 });
        return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
      }
      throw new Error(String(url));
    },
    credentials: { username: "admin", password: "x" },
  });
  assert.equal(result.isLoggedIn, false);
  assert.match(result.image, /^data:image\/png;base64,/);
});

test("withWechatLogin annotates wechat source only", async () => {
  const sources = await withWechatLogin(
    [{ id: "wechat" }, { id: "xiaohongshu" }],
    { loggedIn: true, reason: null },
  );
  assert.equal(sources[0].login.loggedIn, true);
  assert.equal(sources[1].login, undefined);
});
