import { confirmAnalysisEntity } from './lib/store.mjs';
import { buildAnalysis } from './lib/analysis.mjs';
import { getResearch, enqueueResearch, loadResearchFacts } from './lib/team-research.mjs';
import { answerChat } from './lib/chat.mjs';
import { researchAvailability, selectResearchBatch } from './lib/research-batch.mjs';
import "./lib/env.mjs";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { runCollectors, extractManualMaterial } from "./lib/collectors.mjs";
import { sourceCatalog, implementedSourceIds } from "./lib/sources.mjs";
import { defaultWeights, openSourceDimensions, scoreItems, startupDimensions, kimiDimensions } from "./lib/scoring.mjs";
import { importMaterial, mergeBaselineIntoStore, readStore, updateItemStatus, updateSettings, upsertItems } from "./lib/store.mjs";
import { baselineStoreInfo, loadBaselineStore } from "./lib/baseline-store.mjs";
import { readConnectors, saveConnectors, catalogWithConnections, withXhsLogin, withWechatLogin } from "./lib/connectors.mjs";
import { CollectionPlatform } from "./lib/platform.mjs";
import { buildSourceConfigView, saveSourceConfig } from "./lib/source-config.mjs";
import { sourceLimit } from "./lib/source-settings.mjs";
import { request as providerRequest } from "./lib/acquisition.mjs";
import { annotateDiscovery } from "./lib/discovery.mjs";
import { bootstrap, prepareRuntime } from "./lib/bootstrap.mjs";
import { xhsLoginState } from "./lib/xhs-auth.mjs";
import { resolveXhsQrcode } from "./lib/xhs-login.mjs";
import { werssLoginState, resolveWerssQrcode } from "./lib/werss-auth.mjs";

const PORT = Number(process.env.PORT || 3000);
// Never bind loopback on cloud: Railway Variables sometimes set HOST=localhost.
function resolveListenHost() {
  const raw = String(process.env.HOST || "0.0.0.0").trim();
  if (!raw || raw === "localhost" || raw === "127.0.0.1" || raw === "::1") return "0.0.0.0";
  return raw;
}
const HOST = resolveListenHost();
const enableLocalServices = process.env.ENABLE_LOCAL_SERVICES === "1";
console.log("DEPLOY_MARK=railway-v3-20260910");
const prepared = await prepareRuntime({ startServices: enableLocalServices });
if (enableLocalServices) {
  if (prepared.services?.wechat?.state === "missing") {
    console.warn("微信公众号 WeRSS 未安装，跳过自动启动。");
  } else if (prepared.services?.wechat?.state && prepared.services.wechat.state !== "running") {
    console.warn(`微信公众号 WeRSS: ${prepared.services.wechat.state}${prepared.services.wechat.message ? ` — ${prepared.services.wechat.message}` : ""}`);
  }
}
console.log(
  JSON.stringify({
    event: "server_boot",
    host: HOST,
    port: PORT,
    hostEnv: process.env.HOST || null,
    enableLocalServices,
    node: process.version,
  }),
);
const PUBLIC_DIR = path.join(process.cwd(), "public");
const platform = new CollectionPlatform({ runCollectors, upsertItems });

async function sourcesWithLogin(storeRuns) {
  const catalog = catalogWithConnections(sourceCatalog, await readConnectors(), storeRuns);
  return withWechatLogin(await withXhsLogin(catalog));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message, stack: process.env.NODE_ENV === "production" ? undefined : error.stack });
  }
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(`AI News Potential Monitor listening on ${typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : `${HOST}:${PORT}`}`);
});

async function handleApi(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
      return sendJson(response, 403, { error: '来源不匹配' });
    }
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const input = await readBody(request);
      return sendJson(
        response,
        200,
        await answerChat(input, {
          store: await readStore(),
          research: await loadResearchFacts(),
          getReport: getResearch,
          signal: controller.signal,
        }),
      );
    } catch (e) {
      if (!response.destroyed) {
        return sendJson(response, 400, {
          error:
            e.name === 'AbortError'
              ? '请求已取消'
              : e.name === 'TimeoutError'
                ? '回答超时，请重试'
                : e.message,
        });
      }
      return;
    }
  }

  if (url.pathname.startsWith('/api/analysis')) {
    try {
      if(request.method==='GET' && url.pathname==='/api/analysis') {
        const excludeIncumbents = url.searchParams.get('excludeIncumbents') !== 'false';
        return sendJson(response,200,{...buildAnalysis(await readStore(), { excludeIncumbents, research: await loadResearchFacts() }),researchAvailability:researchAvailability()});
      }
      if(request.method==='POST' && url.pathname==='/api/analysis/research-batch') {
        if(request.headers.origin && new URL(request.headers.origin).host!==request.headers.host) return sendJson(response,403,{error:'来源不匹配'});
        const ready=researchAvailability();if(!ready.ready)return sendJson(response,409,{error:ready.message});
        const body=await readBody(request);
        if(!Array.isArray(body.ids)||body.ids.length>150||body.ids.some(id=>typeof id!=='string'))return sendJson(response,400,{error:'请选择最多 150 个候选供排队筛选'});
        const items=buildAnalysis(await readStore(),{research:await loadResearchFacts()}).items;
        const running=items.filter(i=>['queued','running'].includes(i.research?.status)).length;
        const batch=selectResearchBatch(items,body.ids,{limit:Math.max(0,5-running)});
        const queued=[];for(const item of batch.selected){await enqueueResearch(item);queued.push(item.id);}
        return sendJson(response,202,{queued,skipped:batch.skipped});
      }
      if(request.method==='POST' && url.pathname==='/api/analysis/confirm') {
        if(request.headers.origin && new URL(request.headers.origin).host!==request.headers.host) return sendJson(response,403,{error:'来源不匹配'});
        return sendJson(response,200,await confirmAnalysisEntity(await readBody(request)));
      }
      const match=url.pathname.match(/^\/api\/analysis\/(entity_[a-f0-9]{20})\/research$/);
      if(match && request.method==='GET') {
        let report=await getResearch(match[1]);
        if(report.status==='not_started') {
          const entity=buildAnalysis(await readStore(),{research:await loadResearchFacts()}).items.find(i=>i.id===match[1]);
          if(entity?.researchReportId && entity.researchReportId!==match[1]) report=await getResearch(entity.researchReportId);
        }
        return sendJson(response,200,report);
      }
      if(match && request.method==='POST') {
        if(request.headers.origin && new URL(request.headers.origin).host!==request.headers.host) return sendJson(response,403,{error:'来源不匹配'});
        const entity=buildAnalysis(await readStore(),{research:await loadResearchFacts()}).items.find(i=>i.id===match[1]);
        if(!entity || entity.type==='lead') return sendJson(response,400,{error:'请先确认项目实体，再进行团队调研。'});
        return sendJson(response,202,await enqueueResearch(entity));
      }
      return sendJson(response,404,{error:'接口不存在'});
    } catch(e) { return sendJson(response,400,{error:e.message}); }
  }

  if (url.pathname.startsWith('/api/platform')) {
    if (request.method === 'POST') {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return sendJson(response, 403, { error: '仅允许本机平台页面修改任务' });
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/platform') return sendJson(response, 200, await platform.fullSnapshot());
      const provider = url.pathname.match(/^\/api\/platform\/providers\/([^/]+)(?:\/(check|qrcode))?$/);
      if (request.method === 'POST' && provider) {
        if (provider[2] === 'check') return sendJson(response, 200, await platform.checkProvider(provider[1]));
        if (provider[2] === 'qrcode' && provider[1] === 'xiaohongshu') {
          const headers = process.env.XHS_MCP_TOKEN ? { Authorization: `Bearer ${process.env.XHS_MCP_TOKEN}` } : {};
          const upstream = await providerRequest(`${platform.state.providers.xiaohongshu.baseUrl}/api/v1/login/qrcode`, { headers });
          const data = (await upstream.json()).data;
          if (!data?.is_logged_in && !/^data:image\/(png|jpeg);base64,/.test(data?.img || '')) throw new Error('上游没有返回有效登录二维码');
          return sendJson(response, 200, { isLoggedIn: Boolean(data.is_logged_in), image: data.img });
        }
        if (!provider[2]) return sendJson(response, 200, platform.saveProvider(provider[1], await readBody(request)));
      }
      if (request.method === 'GET' && url.pathname === '/api/platform/export') {
        const items = (await readStore()).items.filter(i => !i.sampleMode);
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="raw-content.jsonl"' });
        return response.end(items.map(i => JSON.stringify(i)).join('\n') + '\n');
      }
      return sendJson(response, 404, { error: '接口不存在' });
    } catch (error) { return sendJson(response, 400, { error: error.message, code: error.code }); }
  }
  if (request.method === "GET" && url.pathname === "/api/store/baseline") {
    try {
      const info = await baselineStoreInfo();
      const store = await readStore();
      return sendJson(response, 200, {
        ...info,
        currentItems: store.items.filter((item) => !item.sampleMode).length,
        mergedAt: store.settings?.baselineMergedAt || null,
      });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/store/load-baseline") {
    try {
      const baseline = await loadBaselineStore();
      if (!baseline?.items?.length) {
        return sendJson(response, 404, { error: "未找到原始数据库文件（config/baseline-store.json.gz）" });
      }
      const result = await mergeBaselineIntoStore(baseline.items);
      return sendJson(response, 200, {
        ...result,
        baselineItems: baseline.items.length,
        exportedAt: baseline.exportedAt || baseline.updatedAt || null,
        label: baseline.label || "原始数据库",
      });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    const store = await readStore();
    const selectedSourceIds = parseCsv(url.searchParams.get("sources")) || store.settings.selectedSourceIds;
    const weights = parseJsonParam(url.searchParams.get("weights")) || store.settings.weights;
    const type = url.searchParams.get("type") || "all";
    const status = url.searchParams.get("status") || "all";
    const showSamples = url.searchParams.get("samples") !== "false";
    const excludeIncumbents = url.searchParams.get("excludeIncumbents") !== "false";
    const items = annotateDiscovery(
      scoreItems(
        store.items.filter((item) => {
          if (type !== "all" && item.type !== type) return false;
          if (status !== "all" && item.status !== status) return false;
          if (!showSamples && item.sampleMode) return false;
          return true;
        }),
        { selectedSourceIds, weights },
      ),
    ).filter((item) => !(excludeIncumbents && item.discovery?.incumbent));
    sendJson(response, 200, {
      items,
      sources: await sourcesWithLogin(store.runs),
      dimensions: { open_source: openSourceDimensions, startup: startupDimensions, kimi_fit: kimiDimensions },
      settings: store.settings,
      selectedSourceIds,
      weights,
      discovery: { excludeIncumbents, focus: "emerging_oss_or_startup" },
      runs: store.runs ?? [],
      updatedAt: store.updatedAt,
      model: {
        kimiConnected: Boolean(process.env.MOONSHOT_API_KEY),
        model: process.env.MOONSHOT_MODEL || "kimi-k2-0711-preview",
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sources") {
    sendJson(response, 200, { sources: await sourcesWithLogin((await readStore()).runs), implementedSourceIds: implementedSourceIds() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors") {
    sendJson(response, 200, await readConnectors());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/source-config") {
    sendJson(response, 200, await buildSourceConfigView((await readStore()).runs));
    return;
  }

  const sourceConfigMatch = url.pathname.match(/^\/api\/source-config\/([^/]+)$/);
  if (request.method === "POST" && sourceConfigMatch) {
    try {
      const config = await saveSourceConfig(sourceConfigMatch[1], await readBody(request));
      await platform.reschedule();
      sendJson(response, 200, { ok: true, config });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/xiaohongshu/login-status") {
    const local = await xhsLoginState();
    sendJson(response, 200, { loggedIn: local.loggedIn, savedAt: local.savedAt, reason: local.reason });
    return;
  }

  if ((request.method === "POST" || request.method === "GET") && url.pathname === "/api/xiaohongshu/qrcode") {
    try {
      const config = await readConnectors();
      const baseUrl = String(config.xhsBaseUrl || "http://127.0.0.1:18060");
      const result = await resolveXhsQrcode({ baseUrl, timeoutMs: 25000 });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/wechat/login-status") {
    const local = await werssLoginState();
    sendJson(response, 200, { loggedIn: local.loggedIn, reason: local.reason });
    return;
  }

  if ((request.method === "POST" || request.method === "GET") && url.pathname === "/api/wechat/qrcode") {
    try {
      const result = await resolveWerssQrcode({ baseUrl: process.env.WERSS_BASE_URL || "http://127.0.0.1:8001" });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bootstrap") {
    try {
      sendJson(response, 200, await bootstrap({ startServices: true, force: url.searchParams.get("force") === "1" }));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/connectors") {
    try {
      const config = await saveConnectors(await readBody(request));
      await platform.reschedule();
      sendJson(response, 200, config);
    } catch (error) { sendJson(response, 400, { error: error.message }); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/export") {
    sendJson(response, 200, await readStore());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/refresh") {
    const body = await readBody(request);
    if (url.searchParams.get("stream") === "1") {
      await streamRefresh(response, body);
      return;
    }
    const sources = resolveRefreshSources(body);
    const connectors = await readConnectors();
    const result = await runCollectors({
      sources,
      limit: Number(body.limit || 12),
      timeRange: body.timeRange,
      connectors,
      perSourceLimit: (sourceId, fallback) => sourceLimit(connectors.sourceSettings, sourceId, fallback),
    });
    const store = await upsertItems(result.items, result.run);
    sendJson(response, 200, { run: result.run, storedItems: store.items.length });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/status") {
    const body = await readBody(request);
    const item = await updateItemStatus(body.id, body.status);
    sendJson(response, 200, { item });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(request);
    const settings = await updateSettings(body);
    sendJson(response, 200, { settings });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import") {
    const body = await readBody(request);
    if (!body.name || !body.type || !body.text) {
      sendJson(response, 400, { error: "name、type、text 为必填。" });
      return;
    }
    const extracted = await extractManualMaterial(body);
    const item = await importMaterial(body, extracted);
    sendJson(response, 200, { item, extracted });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function serveStatic(response, pathname) {
  const filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(302, { Location: "/" });
    response.end();
  }
}

function resolveRefreshSources(body) {
  return Array.isArray(body.sources)
    ? body.sources.filter((source) => implementedSourceIds().includes(source))
    : implementedSourceIds();
}

async function streamRefresh(response, body) {
  const sources = resolveRefreshSources(body);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    send("start", { total: sources.length, sources });
    const connectors = await readConnectors();
    const result = await runCollectors({
      sources,
      limit: Number(body.limit || 12),
      timeRange: body.timeRange,
      connectors,
      perSourceLimit: (sourceId, fallback) => sourceLimit(connectors.sourceSettings, sourceId, fallback),
      onProgress: (progress) => send("progress", progress),
    });
    send("progress", { phase: "saving", total: sources.length, completed: sources.length });
    const store = await upsertItems(result.items, result.run);
    send("done", { run: result.run, storedItems: store.items.length });
    response.end();
  } catch (error) {
    send("error", { error: error.message });
    response.end();
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function parseCsv(value) {
  if (value === null) return null;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseJsonParam(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
