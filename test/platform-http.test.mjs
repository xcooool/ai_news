import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, symlink, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { defaultConnectors } from "../lib/connectors.mjs";

test("source config HTTP flow aligns with homepage sources", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "platform-http-"));
  await mkdir(path.join(directory, "data"), { recursive: true });
  await writeFile(path.join(directory, "data", "connectors.json"), `${JSON.stringify({
    ...defaultConnectors(),
    xhsBaseUrl: "http://127.0.0.1:18060",
    xhsKeywords: ["ai startup", "ai github"],
  }, null, 2)}\n`);
  await symlink(fileURLToPath(new URL("../public", import.meta.url)), path.join(directory, "public"));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd: directory,
    env: { ...process.env, PORT: "0", ANTCHAT_API_KEY: "", RESEARCH_LLM_API_KEY: "", DEEPSEEK_API_KEY: "", MOONSHOT_API_KEY: "", TAVILY_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/localhost:(\d+)/);
        if (match) resolve(match[1]);
      });
      child.once("exit", () => reject(new Error(stderr)));
    });
    const base = `http://127.0.0.1:${port}`;
    const post = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.match(await (await fetch(base)).text(), /潜力监测|爆款的可能性/);
    assert.match(await (await fetch(base + "/collection.html")).text(), /数据源配置/);
    const configView = await (await fetch(base + "/api/source-config")).json();
    const xhs = configView.sources.find((source) => source.id === "xiaohongshu");
    assert.ok(xhs);
    assert.equal(xhs.targetSummary, "ai startup · ai github");
    const saved = await post("/api/source-config/xiaohongshu", {
      schedule: "daily:9",
      scheduleEnabled: true,
      limit: 15,
      xhsBaseUrl: "http://127.0.0.1:18060",
      xhsKeywords: "ai startup\nai github",
    });
    assert.equal(saved.status, 200);
    const updated = await (await fetch(base + "/api/source-config")).json();
    const next = updated.sources.find((source) => source.id === "xiaohongshu");
    assert.equal(next.scheduleLabel, "每天 09:00");
    assert.equal(next.limit, 15);
    const platform = await (await fetch(base + "/api/platform")).json();
    assert.ok(platform.scheduledSources.find((entry) => entry.sourceId === "xiaohongshu")?.nextRunAt);
    assert.equal((await post("/api/platform/providers/newsnow", { baseUrl: "https://user:secret@example.com" })).status, 400);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
