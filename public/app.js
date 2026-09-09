const state = {
  items: [],
  sources: [],
  dimensions: {},
  selectedSourceIds: [],
  weights: {},
  type: "all",
  region: "all",
  status: "all",
  itemSearch: "",
  sourceSearch: "",
  samples: true,
  initialized: false,
};

const $ = (selector) => document.querySelector(selector);
const fmt = (value) => (value === null || value === undefined ? "未知" : value);
const pct = (value) => `${Math.round((value ?? 0) * 100)}%`;
const score = (value) => (value === null || value === undefined ? "未知" : Math.round(value));

const statusLabel = {
  new: "新发现",
  watching: "关注",
  researched: "已研究",
  ignored: "忽略",
};

const sourceStatusLabel = {
  implemented: "已实现",
  needs_key: "缺 API key",
  commercial: "需商业授权",
  manual: "可手动导入",
  unverified: "未验证",
  needs_setup: "自动采集 · 待配置",
  configured: "自动采集 · 已配置",
};

await loadState();
bindEvents();
registerModelContextTools();

async function loadState() {
  const params = new URLSearchParams({
    type: state.type,
    status: state.status,
    samples: String(state.samples),
  });
  if (state.initialized) params.set("sources", state.selectedSourceIds.join(","));
  if (Object.keys(state.weights).length) params.set("weights", JSON.stringify(state.weights));
  const data = await fetchJson(`/api/state?${params}`);
  Object.assign(state, {
    items: data.items,
    sources: data.sources,
    dimensions: data.dimensions,
    selectedSourceIds: data.selectedSourceIds,
    weights: data.weights,
    initialized: true,
  });
  render(data);
}

function bindEvents() {
  $("#connectionsBtn").addEventListener("click", openConnections);
  $("#closeConnections").addEventListener("click", () => $("#connectionsDialog").close());
  $("#connectionsForm").addEventListener("submit", saveConnections);
  $("#refreshBtn").addEventListener("click", refreshSources);
  $("#exportBtn").addEventListener("click", () => window.open("/api/export", "_blank"));
  $("#sourceSearch").addEventListener("input", (event) => {
    state.sourceSearch = event.target.value.toLowerCase();
    renderSources();
  });
  $("#itemSearch").addEventListener("input", (event) => {
    state.itemSearch = event.target.value.toLowerCase();
    renderItems();
  });
  $("#statusFilter").addEventListener("change", async (event) => {
    state.status = event.target.value;
    await loadState();
  });
  $("#sampleToggle").addEventListener("change", async (event) => {
    state.samples = event.target.checked;
    await loadState();
  });
  $("#saveWeightsBtn").addEventListener("click", saveSettings);
  $("#importForm").addEventListener("submit", importMaterial);
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".tabs button").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      state.type = button.dataset.type;
      await loadState();
    });
  });
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segmented button").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      state.region = button.dataset.region;
      renderSources();
    });
  });
}

function render(data = {}) {
  $("#modelBadge").textContent = data.model?.kimiConnected ? `Kimi 已接通：${data.model.model}` : "规则模式";
  renderSources();
  renderWeights();
  renderItems();
  renderRunBanner(data.runs?.[0]);
  renderImportSources();
}

function renderSources() {
  const filtered = state.sources.filter((source) => {
    if (state.region !== "all" && source.region !== state.region) return false;
    const haystack = `${source.name} ${source.status} ${source.env} ${source.notes}`.toLowerCase();
    return haystack.includes(state.sourceSearch);
  });
  $("#sourceCount").textContent = `${state.selectedSourceIds.length}/${state.sources.length}`;
  $("#sourcesList").innerHTML = filtered
    .map(
      (source) => `
        <label class="source-row">
          <input type="checkbox" data-source="${source.id}" ${state.selectedSourceIds.includes(source.id) ? "checked" : ""} />
          <span>
            <span class="source-title">
              <span>${escapeHtml(source.name)}</span>
              <span class="pill ${source.status}">${sourceStatusLabel[source.status]}</span>
            </span>
            <small>${regionText(source.region)} · trust ${source.trust} · ${source.env || "无需 env"}</small>
            <small>${escapeHtml(source.notes)}</small>
            ${source.connection ? `<small>${connectionText(source.connection)}</small>` : ""}
          </span>
        </label>`,
    )
    .join("");
  document.querySelectorAll("[data-source]").forEach((checkbox) => {
    checkbox.addEventListener("change", async (event) => {
      const id = event.target.dataset.source;
      state.selectedSourceIds = event.target.checked
        ? [...new Set([...state.selectedSourceIds, id])]
        : state.selectedSourceIds.filter((sourceId) => sourceId !== id);
      await loadState();
    });
  });
}

function renderWeights() {
  const groups = [
    ["open_source", "开源四维"],
    ["startup", "创业四维"],
    ["kimi_fit", "Kimi 商业匹配"],
  ];
  $("#weightsPanel").innerHTML = groups
    .map(([type, title]) => {
      const dimensions = state.dimensions[type] ?? [];
      return `
        <div class="weights-group">
          <h3>${title}</h3>
          ${dimensions
            .map((dimension) => {
              const value = state.weights[type]?.[dimension.id] ?? dimension.weight;
              return `
                <div class="weight-row">
                  <label>
                    <span>${dimension.label}</span>
                    <span>${value}</span>
                  </label>
                  <input type="range" min="0" max="60" value="${value}" data-weight-type="${type}" data-weight-id="${dimension.id}" />
                </div>`;
            })
            .join("")}
        </div>`;
    })
    .join("");
  document.querySelectorAll("[data-weight-id]").forEach((range) => {
    range.addEventListener("input", async (event) => {
      const type = event.target.dataset.weightType;
      const id = event.target.dataset.weightId;
      state.weights[type] = { ...(state.weights[type] ?? {}), [id]: Number(event.target.value) };
      await loadState();
    });
  });
}

function renderItems() {
  const items = state.items.filter((item) => {
    const haystack = `${item.name} ${item.tagline} ${(item.evidence ?? []).map((e) => e.note).join(" ")}`.toLowerCase();
    return haystack.includes(state.itemSearch);
  });
  $("#itemsList").innerHTML = items.length
    ? items.map((item) => itemCard(item)).join("")
    : `<section class="panel item-card"><div><h3>当前筛选下没有对象</h3><p>可以放宽来源、打开示例模式，或导入一段材料。</p></div></section>`;
  document.querySelectorAll("[data-open-detail]").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.openDetail));
  });
  document.querySelectorAll("[data-status-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await fetchJson("/api/status", {
        method: "POST",
        body: JSON.stringify({ id: button.dataset.itemId, status: button.dataset.statusAction }),
      });
      toast("状态已保存");
      await loadState();
    });
  });
}

function itemCard(item) {
  const scoring = item.scoring;
  const dimensions = scoring.dimensions ?? [];
  const primaryUrl = item.sampleMode ? null : (item.urls ?? []).map(safeUrl).find(Boolean);
  return `
    <article class="item-card">
      <div>
        <div class="item-title">
          <h3>${primaryUrl ? externalLink(primaryUrl, item.name) : escapeHtml(item.name)}</h3>
          <span class="pill">${item.collection?.entityVerified === false ? "待核实线索" : item.type === "open_source" ? "开源项目" : "创业公司"}</span>
          <span class="pill">${statusLabel[item.status] ?? item.status}</span>
          ${item.sampleMode ? '<span class="pill commercial">示例模式</span>' : ""}
        </div>
        <p>${escapeHtml(item.tagline)}</p>
        ${itemLinks(item)}
        <div class="meta">${escapeHtml(item.stage)} · ${escapeHtml(item.country)} · 首次发现 ${dateText(item.discoveredAt)} · 最后看到 ${dateText(item.lastSeenAt)}</div>
        <div class="dimension-grid">
          ${dimensions
            .map(
              (dimension) => `
                <div class="dimension-chip">
                  <strong>${dimension.label}</strong>
                  <span>${score(dimension.dimensionScore)} · 覆盖 ${pct(dimension.evidenceCoverage)} · 有效权重 ${dimension.effectiveWeight.toFixed(1)}</span>
                </div>`,
            )
            .join("")}
        </div>
        <div class="actions">
          <button class="small" data-open-detail="${item.id}">展开评分</button>
          <button class="status-btn" data-item-id="${item.id}" data-status-action="watching">关注</button>
          <button class="status-btn" data-item-id="${item.id}" data-status-action="researched">已研究</button>
          <button class="status-btn" data-item-id="${item.id}" data-status-action="ignored">忽略</button>
        </div>
      </div>
      <div class="scorebox">
        <span class="score-number ${scoring.potentialIndex === null ? "na" : ""}">${score(scoring.potentialIndex)}</span>
        <div class="bar"><span style="width:${scoring.potentialIndex ?? 0}%"></span></div>
        <div class="score-note">潜力指数 · 覆盖 ${pct(scoring.coverage)} · 置信 ${pct(scoring.confidence)}</div>
        <div class="score-note">${escapeHtml(scoring.reason)}</div>
        <div class="pill">Kimi 匹配：${score(item.kimiFit?.index)}</div>
      </div>
    </article>`;
}

function openDetail(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  $("#detailDrawer").classList.remove("hidden");
  $("#detailDrawer").innerHTML = `
    <div class="drawer-inner">
      <div class="drawer-head">
        <div>
          <p class="eyebrow">${item.type === "open_source" ? "开源潜力" : "创业潜力"} · ${item.sampleMode ? "示例记录" : "真实/导入记录"}</p>
          <h2>${escapeHtml(item.name)}</h2>
          <p class="hint">${escapeHtml(item.tagline)}</p>
          ${itemLinks(item)}
        </div>
        <button id="closeDrawer" class="ghost">关闭</button>
      </div>
      <section>
        ${item.content ? `<h3>采集正文</h3><pre class="collected-content">${escapeHtml(contentText(item.content) || "未取得正文，请打开原始链接。")}</pre>` : ""}
      </section>
      <section>
        <h3>指数链路</h3>
        <p class="hint">${escapeHtml(item.scoring.reason)} 当前指数不混入 Kimi 商业匹配。</p>
        ${scoreBreakdown(item.scoring)}
      </section>
      <section>
        <h3>Kimi 商业匹配</h3>
        ${kimiBreakdown(item.kimiFit)}
      </section>
      <section>
        <h3>事实与来源</h3>
        ${(item.facts ?? [])
          .map(
            (fact) => `
              <div class="trace-card">
                <strong>${escapeHtml(fact.kind)}</strong>
                <div>${escapeHtml(String(fact.value))}</div>
                <div class="trace">${credibilityText(fact.credibility)} · ${dateText(fact.collectedAt)} ${safeUrl(fact.url) ? `· ${externalLink(fact.url)}` : ""}</div>
              </div>`,
          )
          .join("")}
      </section>
    </div>`;
  $("#closeDrawer").addEventListener("click", () => $("#detailDrawer").classList.add("hidden"));
}

function scoreBreakdown(scoring) {
  return (scoring.dimensions ?? [])
    .map(
      (dimension) => `
        <details open>
          <summary>${dimension.label}：维度分 ${score(dimension.dimensionScore)}，基础权重 ${dimension.configuredWeight}，覆盖 ${pct(dimension.evidenceCoverage)}，有效权重 ${dimension.effectiveWeight.toFixed(2)}</summary>
          <p class="hint">${escapeHtml(dimension.definition)}</p>
          ${dimension.traces.length ? dimension.traces.map(traceCard).join("") : '<p class="hint">当前来源下无证据，未知不记 0 分。</p>'}
        </details>`,
    )
    .join("");
}

function kimiBreakdown(kimiFit) {
  if (!kimiFit?.dimensions?.length) return '<p class="hint">当前来源/权重下没有可计算的 Kimi 匹配证据。</p>';
  return `
    <p class="hint">Kimi 匹配仅用于销售优先级和合作时机，不冒充项目/公司的创业潜力。</p>
    ${kimiFit.dimensions
      .map(
        (dimension) => `
          <details>
            <summary>${dimension.label}：${score(dimension.dimensionScore)}，有效权重 ${dimension.effectiveWeight.toFixed(2)}</summary>
            <p class="hint">${escapeHtml(dimension.definition)}</p>
            ${dimension.traces.length ? dimension.traces.map(traceCard).join("") : '<p class="hint">无证据。</p>'}
          </details>`,
      )
      .join("")}`;
}

function traceCard(trace) {
  return `
    <div class="trace-card">
      <strong>${escapeHtml(trace.sourceName)} · ${credibilityText(trace.credibility)}</strong>
      <div class="trace">原始指标：<code>${escapeHtml(JSON.stringify(trace.rawMetric))}</code></div>
      <div class="trace">归一化：${escapeHtml(trace.normalization)}</div>
      <div class="trace">归一化分 ${score(trace.normalizedScore)} · 人工/模型置信 ${pct(trace.confidence)} · 来源可信 ${pct(trace.sourceTrust)} · 事实属性系数 ${pct(trace.credibilityFactor)} · 有效置信 ${pct(trace.effectiveConfidence)}</div>
      <div>${escapeHtml(trace.note ?? "")}</div>
      <div class="trace">${dateText(trace.collectedAt)} ${safeUrl(trace.url) ? `· ${externalLink(trace.url)}` : ""}</div>
    </div>`;
}

function renderRunBanner(run) {
  if (!run) {
    $("#runBanner").classList.add("hidden");
    return;
  }
  $("#runBanner").classList.remove("hidden");
  const errors = run.errors?.length ? `；错误：${run.errors.map((e) => `${e.sourceId} ${e.message}`).join(" / ")}` : "";
  $("#runBanner").textContent = `最近刷新 ${dateText(run.finishedAt)}，来源 ${run.sources.join(", ")}，写入 ${run.itemCount} 条${errors}`;
}

function renderImportSources() {
  $("#importSource").innerHTML = state.sources
    .filter((source) => ["manual", "implemented"].includes(source.status))
    .map((source) => `<option value="${source.id}">${source.name}</option>`)
    .join("");
}

function registerModelContextTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  try {
    context.registerTool({
      name: "list_visible_candidates",
      title: "List visible AI candidates",
      description: "Read the currently visible AI project and startup candidates with potential index, coverage, status, and Kimi fit.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        return {
          selectedSourceIds: state.selectedSourceIds,
          items: state.items.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            status: item.status,
            potentialIndex: item.scoring?.potentialIndex,
            coverage: item.scoring?.coverage,
            kimiFit: item.kimiFit?.index,
            sampleMode: item.sampleMode,
          })),
        };
      },
    });
    context.registerTool({
      name: "set_candidate_status",
      title: "Set candidate status",
      description: "Set a visible candidate status to watching, researched, ignored, or new; it updates the same persisted state as the visible buttons.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["new", "watching", "researched", "ignored"] },
        },
        required: ["id", "status"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input?.id || !input?.status) throw new Error("id and status are required");
        await fetchJson("/api/status", {
          method: "POST",
          body: JSON.stringify({ id: input.id, status: input.status }),
        });
        await loadState();
        return { id: input.id, status: input.status };
      },
    });
  } catch (error) {
    console.warn("WebMCP registration failed", error);
  }
}

async function refreshSources() {
  $("#refreshBtn").disabled = true;
  $("#refreshBtn").textContent = "刷新中...";
  try {
    const implemented = state.selectedSourceIds.filter((id) => {
      const source = state.sources.find((entry) => entry.id === id);
      return source?.status === "implemented" || source?.automatic;
    });
    const result = await fetchJson("/api/refresh", {
      method: "POST",
      body: JSON.stringify({ sources: implemented }),
    });
    toast(`刷新完成：${result.run.itemCount} 条，错误 ${result.run.errors.length} 个`);
    await loadState();
  } catch (error) {
    toast(`刷新失败：${error.message}`);
  } finally {
    $("#refreshBtn").disabled = false;
    $("#refreshBtn").textContent = "刷新真实来源";
  }
}

async function importMaterial(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const body = Object.fromEntries(form.entries());
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "抽取中...";
  try {
    const result = await fetchJson("/api/import", { method: "POST", body: JSON.stringify(body) });
    toast(result.extracted.warning || "导入完成");
    formElement.reset();
    await loadState();
  } catch (error) {
    toast(`导入失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "导入并抽取证据";
  }
}

async function saveSettings() {
  await fetchJson("/api/settings", {
    method: "POST",
    body: JSON.stringify({ weights: state.weights, selectedSourceIds: state.selectedSourceIds }),
  });
  toast("权重和来源选择已保存");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  setTimeout(() => $("#toast").classList.add("hidden"), 3600);
}

function regionText(region) {
  return { china: "国内来源", overseas: "海外来源", mixed: "国内/海外混合" }[region] ?? region;
}

function credibilityText(value) {
  return {
    fact: "事实",
    self_reported: "公司自述",
    third_party_estimate: "第三方估算/平台指标",
    model_inference: "模型推断",
  }[value] ?? value;
}

function dateText(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function externalLink(url, label) {
  const href = safeUrl(url);
  if (!href) return "";
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(href)}（新标签页打开）">${escapeHtml(label ?? href)}</a>`;
}

function itemLinks(item) {
  if (item.sampleMode) return '<p class="hint">示例记录，无真实项目链接。</p>';
  const projectUrls = (item.urls ?? []).map(safeUrl).filter(Boolean);
  const sourceUrls = [...(item.evidence ?? []), ...(item.facts ?? [])]
    .map((entry) => safeUrl(entry.url)).filter(Boolean);
  const urls = [...new Set([...projectUrls, ...sourceUrls])];
  if (!urls.length) return '<p class="hint">尚未收录原始链接。</p>';
  return `<div class="item-links">${urls.map((url) => `<div><span>${item.collection?.entityVerified === false ? "内容原文" : projectUrls.includes(url) ? "项目链接" : "证据来源"}</span>${externalLink(url)}</div>`).join("")}</div>`;
}

function connectionText(connection) {
  const labels = { not_tested: "尚未执行采集", ok: "最近采集成功", partial: "最近采集部分成功", error: "最近采集失败", needs_login: "需要登录", needs_setup: "需要配置", unreachable: "服务不可达", rate_limited: "上游限流", upstream_error: "上游服务异常", invalid_response: "接口响应异常" };
  return `${labels[connection.state] || "采集异常"}${connection.at ? ` · ${dateText(connection.at)} · ${connection.itemCount} 条` : ""}`;
}

function contentText(content) {
  if (content.text) return content.text;
  if (!content.html) return "";
  // Template contents remain inert; only extracted text enters the live page.
  const template = document.createElement("template");
  template.innerHTML = content.html;
  template.content.querySelectorAll("script,style,noscript").forEach(node => node.remove());
  template.content.querySelectorAll("p,div,br,li,h1,h2,h3").forEach(node => node.append(document.createTextNode("\n")));
  return template.content.textContent.trim();
}

async function openConnections() {
  try {
    const config = await fetchJson("/api/connectors");
    const form = $("#connectionsForm");
    for (const key of ["xhsBaseUrl", "weweBaseUrl", "rsshubBaseUrl"]) form.elements.namedItem(key).value = config[key];
    for (const key of ["keywords", "wechatFeedIds"]) form.elements.namedItem(key).value = config[key].join("\n");
    for (const [key, routes] of Object.entries(config.routes)) form.elements.namedItem(key).value = routes.join("\n");
    $("#connectionsError").textContent = "";
    $("#connectionsDialog").showModal();
  } catch (error) { toast(error.message); }
}

async function saveConnections(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const lines = value => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const config = {
    xhsBaseUrl: data.xhsBaseUrl, weweBaseUrl: data.weweBaseUrl, rsshubBaseUrl: data.rsshubBaseUrl,
    keywords: lines(data.keywords), wechatFeedIds: lines(data.wechatFeedIds),
    routes: Object.fromEntries(["zhihu", "jike", "douyin", "bilibili", "36kr"].map(id => [id, lines(data[id])])),
  };
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await fetchJson("/api/connectors", { method: "POST", body: JSON.stringify(config) });
    await loadState();
    $("#connectionsDialog").close();
    toast("连接配置已保存，请勾选来源并刷新。");
  } catch (error) { $("#connectionsError").textContent = error.message; }
  finally { button.disabled = false; }
}
