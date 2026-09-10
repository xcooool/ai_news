/** Discovery bias: prefer emerging OSS / small AI startups over big labs. */

export const INCUMBENT_GITHUB_ORGS = [
  "openai",
  "microsoft",
  "google",
  "google-deepmind",
  "deepmind",
  "facebook",
  "meta",
  "meta-llama",
  "huggingface",
  "anthropics",
  "anthropic",
  "deepseek-ai",
  "qwenlm",
  "alibaba",
  "alibaba-nlp",
  "bytedance",
  "tencent",
  "amazon",
  "aws",
  "apple",
  "nvidia",
  "ibm",
  "langchain-ai",
  "mistralai",
  "xai-org",
  "cohere-ai",
  "run-llama",
  "vllm-project",
  "ggml-org",
  "ollama",
  "stability-ai",
  "midjourney",
  "baidu",
  "paddlepaddle",
  "pytorch",
  "tensorflow",
  "keras-team",
  "huggingface",
  "eleutherai",
  "mosaicml",
  "databricks",
  "snowflake",
  "salesforce",
  "adobe",
  "oracle",
  "intel",
  "amd",
  "qualcomm",
  "samsung",
  "sony",
  "huawei",
  "baidu-research",
  "tencent-ailab",
  "bytedance-seed",
];

export const INCUMBENT_HANDLES = [
  "openai",
  "anthropicai",
  "anthropic",
  "googledeepmind",
  "googleai",
  "deepmind",
  "sama",
  "huggingface",
  "mistralai",
  "qwen_lm",
  "qwenlm",
  "deepseek_ai",
  "deepseek-ai",
  "langchainai",
  "langchain-ai",
  "microsoft",
  "msft",
  "nvidia",
  "metaai",
  "llama_index",
  "vllm_project",
  "vllm-project",
  "ylecun",
  "andrewyng",
  "clementdelangue",
  "satyanadella",
  "sundarpichai",
  "elonmusk",
  "xai",
  "perplexity_ai",
  "cohere",
  "stabilityai",
  "midjourney",
  "baidu",
  "tencent",
  "bytedance",
  "alibaba",
  "huawei",
];

/** Company / lab names for title and body matching (lowercase). */
export const INCUMBENT_NAME_PHRASES = [
  "google deepmind",
  "deepmind",
  "google gemini",
  "gemini 2",
  "gemini pro",
  "openai",
  "chatgpt",
  "gpt-4",
  "gpt-5",
  "gpt4",
  "gpt5",
  "anthropic",
  "claude 3",
  "claude 4",
  "microsoft",
  "copilot",
  "azure openai",
  "meta ai",
  "facebook ai",
  "llama 3",
  "llama 4",
  "amazon",
  "aws bedrock",
  "nvidia",
  "apple intelligence",
  "xai",
  "grok",
  "mistral ai",
  "mistral large",
  "deepseek",
  "qwen",
  "通义千问",
  "文心一言",
  "ernie bot",
  "字节跳动",
  "字节",
  "bytedance",
  "tiktok",
  "抖音",
  "腾讯",
  "tencent",
  "阿里巴巴",
  "阿里云",
  "alibaba",
  "alibaba cloud",
  "百度",
  "baidu",
  "华为",
  "huawei",
  "科大讯飞",
  "iflytek",
  "商汤",
  "sensetime",
  "旷视",
  "megvii",
  "hugging face",
  "langchain",
  "llamaindex",
  "llama index",
  "vllm",
  "ollama",
  "stability ai",
  "midjourney",
  "databricks",
  "snowflake",
  "salesforce",
  "oracle ai",
  "ibm watson",
  "谷歌",
  "微软",
  "苹果",
  "亚马逊",
  "英伟达",
  "脸书",
  "open ai",
];

/** Word-boundary English tokens (avoid matching substrings like "metadata"). */
export const INCUMBENT_NAME_WORDS = [
  "google",
  "microsoft",
  "amazon",
  "nvidia",
  "apple",
  "facebook",
  "anthropic",
  "openai",
  "deepmind",
  "bytedance",
  "tencent",
  "alibaba",
  "baidu",
  "huawei",
  "ibm",
  "intel",
  "amd",
  "oracle",
  "adobe",
  "salesforce",
  "samsung",
  "sony",
  "qualcomm",
  "cisco",
];

export const INCUMBENT_DOMAINS = [
  "openai.com",
  "anthropic.com",
  "deepmind.com",
  "google.com",
  "blog.google",
  "microsoft.com",
  "meta.com",
  "facebook.com",
  "amazon.com",
  "aws.amazon.com",
  "apple.com",
  "nvidia.com",
  "ibm.com",
  "oracle.com",
  "salesforce.com",
  "adobe.com",
  "bytedance.com",
  "tiktok.com",
  "tencent.com",
  "qq.com",
  "alibaba.com",
  "aliyun.com",
  "baidu.com",
  "huawei.com",
  "mistral.ai",
  "deepseek.com",
  "huggingface.co",
  "langchain.com",
  "x.ai",
  "cohere.com",
  "stability.ai",
  "midjourney.com",
  "databricks.com",
  "snowflake.com",
];

const handleSet = new Set(INCUMBENT_HANDLES.map((value) => value.toLowerCase()));
const orgSet = new Set(INCUMBENT_GITHUB_ORGS.map((value) => value.toLowerCase()));
const phraseList = INCUMBENT_NAME_PHRASES.map((value) => value.toLowerCase());
const wordPatterns = INCUMBENT_NAME_WORDS.map((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
const domainList = INCUMBENT_DOMAINS.map((value) => value.toLowerCase());

export function normalizeHandle(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

export function isIncumbentHandle(value) {
  return handleSet.has(normalizeHandle(value));
}

export function githubOwner(fullNameOrUrl) {
  const text = String(fullNameOrUrl ?? "");
  const fromPath = text.match(/github\.com\/([^/]+)/i)?.[1];
  if (fromPath) return fromPath.toLowerCase();
  const owner = text.split("/")[0];
  return owner ? owner.toLowerCase() : "";
}

export function isIncumbentGithubOrg(value) {
  return orgSet.has(githubOwner(value));
}

export function isIncumbentDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return domainList.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function textMentionsIncumbent(text) {
  const haystack = String(text ?? "").toLowerCase();
  if (!haystack.trim()) return false;
  if (phraseList.some((phrase) => haystack.includes(phrase))) return true;
  return wordPatterns.some((pattern) => pattern.test(haystack));
}

const PROJECT_SOURCES = new Set(["github", "github_kol", "hackernews", "producthunt", "hf_spaces", "huggingface"]);

export function hasEmergingProjectAnchor(item = {}) {
  const links = [...(item.urls ?? []), ...(item.collection?.outboundLinks ?? [])];
  for (const url of links) {
    if (/github\.com\/[\w.-]+\/[\w.-]+/i.test(url) && !isIncumbentGithubOrg(url)) return true;
    if (/producthunt\.com\/posts\//i.test(url)) return true;
    if (/huggingface\.co\/(spaces|models)\//i.test(url) && !isIncumbentGithubOrg(url)) return true;
  }
  if (PROJECT_SOURCES.has(item.collection?.sourceId)) {
    if (item.collection?.sourceId === "hackernews" && [item.name, item.collection?.originalTitle, ...(item.aliases || [])].some((t) => /^show hn:/i.test(String(t || "")))) return true;
    if (item.type === "open_source" && !isIncumbentGithubOrg(item.name)) return true;
    return item.collection?.sourceId === "producthunt";
  }
  return false;
}

export function isIncumbentTarget(target = {}) {
  const keys = [target.id, target.handle, target.name, target.value]
    .map(normalizeHandle)
    .filter(Boolean);
  if (keys.some((key) => handleSet.has(key) || orgSet.has(key))) return true;
  if (target.url && /github\.com/i.test(target.url) && isIncumbentGithubOrg(target.url)) return true;
  if (target.url && /x\.com|twitter\.com/i.test(target.url)) {
    const handle = target.url.match(/(?:x|twitter)\.com\/([^/?#]+)/i)?.[1];
    if (isIncumbentHandle(handle)) return true;
  }
  return false;
}

export function isIncumbentItem(item = {}) {
  if (item.sampleMode) return false;
  if (isIncumbentHandle(item.collection?.targetId) || isIncumbentHandle(item.collection?.author)) return true;
  if (isIncumbentGithubOrg(item.name)) return true;

  // Emerging HF Spaces/models, indie repos, PH posts — keep before host-level giant list.
  if (hasEmergingProjectAnchor(item)) return false;

  const links = [...(item.urls ?? []), ...(item.collection?.outboundLinks ?? [])];
  for (const url of links) {
    if (/github\.com/i.test(url) && isIncumbentGithubOrg(url)) return true;
    const handle = url.match(/(?:x|twitter)\.com\/([^/?#]+)/i)?.[1];
    if (isIncumbentHandle(handle)) return true;
    if (isIncumbentDomain(url)) return true;
  }

  const title = `${item.name ?? ""}`.trim();
  const body = `${item.tagline ?? ""} ${item.content?.text ?? ""}`.trim();
  if (textMentionsIncumbent(title)) return true;
  if (textMentionsIncumbent(body)) return true;

  return false;
}

export function annotateDiscovery(items) {
  return items.map((item) => ({
    ...item,
    discovery: {
      incumbent: isIncumbentItem(item),
      focus: "emerging_oss_or_startup",
    },
  }));
}

export const DEAD_COMPANY_STATUSES = new Set(["inactive", "acquired", "public", "dead", "shutdown", "closed", "exited"]);
export const EMERGING_STARTUP_MAX_AGE_YEARS = 4;

export function parseBatchYear(batch) {
  const text = String(batch ?? "").trim();
  const year = text.match(/(?:19|20)\d{2}/);
  if (year) return Number(year[0]);
  const compact = text.match(/^([WFSX])(\d{2})$/i);
  if (compact) return 2000 + Number(compact[2]);
  return null;
}

export function isClosedCompanyStatus(status) {
  return DEAD_COMPANY_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function isStaleStartup(record = {}, now = new Date()) {
  const raw = record.collection?.raw || {};
  const status = record.metrics?.companyStatus ?? raw.status;
  const batch = record.metrics?.batch ?? raw.batch;
  if (isClosedCompanyStatus(status)) return true;
  const year = parseBatchYear(batch);
  if (year != null && year < now.getFullYear() - (EMERGING_STARTUP_MAX_AGE_YEARS - 1)) return true;
  return false;
}

export function filterEmergingItems(items = []) {
  return items.filter((item) => !isIncumbentItem(item) && !isStaleStartup(item));
}

export function filterEmergingTargets(targets = []) {
  return targets.filter((target) => target.enabled !== false && !isIncumbentTarget(target));
}

export function githubEmergingQuery({ days = 90, minStars = 3, maxStars = 3000 } = {}) {
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * days).toISOString().slice(0, 10);
  const excludes = INCUMBENT_GITHUB_ORGS.slice(0, 12)
    .map((org) => `-org:${org}`)
    .join(" ");
  return `(agent OR llm OR ai OR rag OR multimodal OR copilot OR "open source") created:>${since} stars:${minStars}..${maxStars} fork:false ${excludes}`;
}
