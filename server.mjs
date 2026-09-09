import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { runCollectors, extractManualMaterial } from "./lib/collectors.mjs";
import { sourceCatalog, implementedSourceIds } from "./lib/sources.mjs";
import { defaultWeights, openSourceDimensions, scoreItems, startupDimensions, kimiDimensions } from "./lib/scoring.mjs";
import { importMaterial, readStore, updateItemStatus, updateSettings, upsertItems } from "./lib/store.mjs";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(process.cwd(), "public");

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message, stack: process.env.NODE_ENV === "production" ? undefined : error.stack });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI News Potential Monitor running at http://localhost:${PORT}`);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    const store = await readStore();
    const selectedSourceIds = parseCsv(url.searchParams.get("sources")) || store.settings.selectedSourceIds;
    const weights = parseJsonParam(url.searchParams.get("weights")) || store.settings.weights;
    const type = url.searchParams.get("type") || "all";
    const status = url.searchParams.get("status") || "all";
    const showSamples = url.searchParams.get("samples") !== "false";
    const items = scoreItems(
      store.items.filter((item) => {
        if (type !== "all" && item.type !== type) return false;
        if (status !== "all" && item.status !== status) return false;
        if (!showSamples && item.sampleMode) return false;
        return true;
      }),
      { selectedSourceIds, weights },
    );
    sendJson(response, 200, {
      items,
      sources: sourceCatalog,
      dimensions: { open_source: openSourceDimensions, startup: startupDimensions, kimi_fit: kimiDimensions },
      settings: store.settings,
      selectedSourceIds,
      weights,
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
    sendJson(response, 200, { sources: sourceCatalog, implementedSourceIds: implementedSourceIds() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/export") {
    sendJson(response, 200, await readStore());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/refresh") {
    const body = await readBody(request);
    const sources = Array.isArray(body.sources)
      ? body.sources.filter((source) => implementedSourceIds().includes(source))
      : implementedSourceIds();
    const result = await runCollectors({ sources, limit: Number(body.limit || 12) });
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
