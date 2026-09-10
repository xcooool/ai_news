import { readFileSync } from "node:fs";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const PROXY_KEYS = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Load `.env`; proxy keys always override IDE-injected temporary proxies. */
export function loadProjectEnv(filePath = ".env") {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { applied: [], overriddenProxy: [] };
    throw error;
  }

  const applied = [];
  const overriddenProxy = [];
  for (const raw of content.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = stripQuotes(line.slice(eq + 1));
    const isProxy = PROXY_KEYS.has(key);
    if (isProxy || process.env[key] === undefined) {
      if (isProxy && process.env[key] !== undefined && process.env[key] !== value) {
        overriddenProxy.push(key);
      }
      process.env[key] = value;
      applied.push(key);
    }
  }
  return { applied, overriddenProxy };
}

loadProjectEnv();

const proxy =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy;

if (proxy) {
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      noProxy: [process.env.NO_PROXY || process.env.no_proxy, "localhost", "127.0.0.1", "::1"]
        .filter(Boolean)
        .join(","),
    }),
  );
}
