import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("repeated collection updates metrics while preserving user status and first discovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-news-refresh-"));
  try {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { writeStore, upsertItems, readStore } from ${JSON.stringify(new URL("../lib/store.mjs", import.meta.url).href)};
      const existing = {id:"note1",name:"AI",status:"researched",discoveredAt:"2026-01-01",evidence:[{id:"likes",metric:{value:10}}],urls:[],facts:[]};
      await writeStore({items:[existing],runs:[]});
      await upsertItems([{...existing,status:"new",discoveredAt:"2026-09-09",evidence:[{id:"likes",metric:{value:20}}]}],{id:"run"});
      console.log(JSON.stringify((await readStore()).items));
    `], { cwd: directory, encoding: "utf8" });
    const items = JSON.parse(result);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "researched");
    assert.equal(items[0].discoveredAt, "2026-01-01");
    assert.equal(items[0].evidence[0].metric.value, 20);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
