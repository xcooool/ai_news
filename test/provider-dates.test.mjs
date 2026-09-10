import test from "node:test";
import assert from "node:assert/strict";
import { collectGitHub, collectHuggingFace } from "../lib/collectors.mjs";
import { collectAcquisition } from "../lib/acquisition.mjs";
import { parseCollectOptions } from "../lib/collect-options.mjs";

test("GitHub and HF retain recent API records and exclude old ones", async () => {
  const dates = [new Date().toISOString(), "2020-01-01T00:00:00Z"];
  const options = parseCollectOptions({limit:12,timeRange:"90d"});
  const repos = dates.map((date,i)=>({full_name:`indie/repo${i}`,name:`repo${i}`,html_url:`https://github.com/indie/repo${i}`,created_at:date,stargazers_count:10,forks_count:1}));
  const github = await collectGitHub(options,async()=>Response.json({items:repos}));
  assert.equal(github.length,1);
  const models = dates.map((date,i)=>({id:`indie/agent${i}`,createdAt:date,downloads:10,likes:1}));
  const hf = await collectHuggingFace(options,async()=>Response.json(models));
  assert.equal(hf.length,1);
  assert.equal(hf[0].name,"indie/agent0");
});

test("Spaces requests recent creations rather than historical like leaders", async () => {
  const batch = await collectAcquisition("hf_spaces",12,async url=>{
    assert.equal(new URL(url).searchParams.get("sort"),"createdAt");
    return Response.json([{id:"indie/agent-demo",createdAt:new Date().toISOString(),likes:2}]);
  },{hf_spaces:[{id:"indie",handle:"indie",name:"indie"}]});
  assert.equal(batch.items.length,1);
});
