import { renderAnalysis } from './analysis.js';
const state = {
  items: [],
  sources: [],
  dimensions: {},
  runs: [],
  selectedSourceIds: [],
  weights: {},
  phase: localStorage.getItem("appPhase") || "collect",
  collectLimit: Number(localStorage.getItem("collectLimit")) || 24,
  collectTimeRange: localStorage.getItem("collectTimeRange") || "90d",
  collectItemSearch: "",
  collectItemSource: "all",
  type: "all",
  region: "all",
  sourceAvailability: "all",
  sourceStatus: "all",
  status: "all",
  itemSource: "all",
  itemRegion: "all",
  stage: "all",
  country: "all",
  sort: "potential",
  scoreState: "all",
  mode: "all",
  minPotential: 0,
  hideUnknown: false,
  itemSearch: "",
  sourceSearch: "",
  samples: true,
  excludeIncumbents: true,
  initialized: false,
  openCombobox: null,
  sourcesCollapsed: localStorage.getItem("sourcesCollapsed") === "true",
  selectionSavedAt: null,
  collecting: false,
  collectProgress: { completed: 0, total: 0, sourceName: "", detail: "" },
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
  implemented: "开箱即用",
  needs_key: "缺 API key",
  commercial: "需商业授权",
  manual: "可手动导入",
  unverified: "未验证",
  needs_setup: "待配置",
  configured: "已配置",
};

const TIME_RANGE_LABELS = {
  "1h": "近 1 小时",
  "1d": "近 1 天",
  "1w": "近 1 周",
  "30d": "近 30 天",
  "90d": "近 90 天",
  all: "不限",
};

const sortOptions = [
  { value: "potential", label: "潜力指数 ↓" },
  { value: "discovered", label: "首次发现 ↓" },
  { value: "lastSeen", label: "最近看到 ↓" },
  { value: "name", label: "名称 A→Z" },
];

const scoreStateOptions = [
  { value: "all", label: "全部评分状态" },
  { value: "scored", label: "已评分" },
  { value: "partial", label: "证据不足" },
  { value: "no_evidence", label: "无证据" },
];

const comboboxDefs = {
  status: {
    label: "状态",
    static: true,
    options: () => [
      { value: "all", label: "全部状态" },
      { value: "new", label: "新发现" },
      { value: "watching", label: "关注" },
      { value: "researched", label: "已研究" },
      { value: "ignored", label: "忽略" },
    ],
  },
  itemSource: {
    label: "来源平台",
    options: () => {
      const counts = itemCountBySource();
      return [
        { value: "all", label: "全部来源" },
        ...state.sources
          .filter((s) => (counts[s.id] ?? 0) > 0)
          .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
          .map((s) => ({ value: s.id, label: s.name, meta: `${counts[s.id]} 条` })),
      ];
    },
  },
  itemRegion: {
    label: "条目地区",
    static: true,
    options: () => [
      { value: "all", label: "全部地区" },
      { value: "china", label: "国内来源" },
      { value: "overseas", label: "海外来源" },
      { value: "mixed", label: "混合来源" },
    ],
  },
  stage: {
    label: "阶段",
    options: () => uniqueFieldOptions("stage"),
  },
  country: {
    label: "国家/地区",
    options: () => uniqueFieldOptions("country"),
  },
  sort: {
    label: "排序",
    static: true,
    options: () => sortOptions,
  },
  scoreState: {
    label: "评分",
    static: true,
    options: () => scoreStateOptions,
  },
  mode: {
    label: "采集方式",
    options: () => uniqueModeOptions(),
  },
  sourceStatus: {
    label: "来源状态",
    static: true,
    options: () => [
      { value: "all", label: "全部状态" },
      ...Object.entries(sourceStatusLabel).map(([value, label]) => ({ value, label })),
    ],
  },
  collectItemSource: {
    label: "入库来源",
    options: () => {
      const counts = itemCountBySource();
      return [
        { value: "all", label: "全部来源" },
        ...state.sources
          .filter((s) => (counts[s.id] ?? 0) > 0)
          .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
          .map((s) => ({ value: s.id, label: s.name, meta: `${counts[s.id]} 条` })),
      ];
    },
  },
};

async function loadState() {
  const params = new URLSearchParams({
    type: "all",
    status: "all",
    samples: String(state.samples),
  });
  if (state.initialized) params.set("sources", state.selectedSourceIds.join(","));
  if (Object.keys(state.weights).length) params.set("weights", JSON.stringify(state.weights));
  params.set("excludeIncumbents", String(state.excludeIncumbents));
  const data = await fetchJson(`/api/state?${params}`);
  Object.assign(state, {
    items: data.items,
    sources: data.sources,
    dimensions: data.dimensions,
    selectedSourceIds: data.selectedSourceIds,
    weights: data.weights,
    runs: data.runs ?? [],
    initialized: true,
  });
  render(data);
}

function bindEvents() {
  $("#phaseCollectBtn").addEventListener("click", () => setPhase("collect"));
  $("#phaseAnalyzeBtn").addEventListener("click", () => setPhase("analyze"));
  $("#collectLimit").addEventListener("change", (event) => {
    state.collectLimit = Number(event.target.value);
    localStorage.setItem("collectLimit", String(state.collectLimit));
    renderCollectSection();
  });
  $("#collectTimeRange").addEventListener("change", (event) => {
    state.collectTimeRange = event.target.value;
    localStorage.setItem("collectTimeRange", state.collectTimeRange);
    renderCollectSection();
  });
  $("#collectItemSearch").addEventListener("input", (event) => {
    state.collectItemSearch = event.target.value.toLowerCase();
    renderCollectItems();
  });
  $("#collectBtn").addEventListener("click", collectFromSources);
  $("#collapseSourcesBtn").addEventListener("click", () => setSidebarCollapsed(true));
  $("#expandSourcesBtn").addEventListener("click", () => setSidebarCollapsed(false));
  $("#exportBtn").addEventListener("click", () => window.open("/api/export", "_blank"));
  $("#loadBaselineBtn").addEventListener("click", loadBaselineStore);
  $("#itemSearch").addEventListener("input", (event) => {
    state.itemSearch = event.target.value.toLowerCase();
    renderItems();
    renderFilterSummary();
  });
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".tabs button").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      state.type = button.dataset.type;
      renderItems();
    });
  });
  document.querySelectorAll(".segmented[aria-label='来源地区'] button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segmented[aria-label='来源地区'] button").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      state.region = button.dataset.region;
      renderSources();
    });
  });
  document.querySelectorAll(".source-availability button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".source-availability button").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      state.sourceAvailability = button.dataset.availability;
      renderSources();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".combobox")) closeAllComboboxes();
    const loginBtn = event.target.closest("[data-xhs-login]");
    if (loginBtn) {
      event.preventDefault();
      event.stopPropagation();
      openXhsQrDialog();
    }
    const wechatLoginBtn = event.target.closest("[data-wechat-login]");
    if (wechatLoginBtn) {
      event.preventDefault();
      event.stopPropagation();
      openWechatQrDialog();
    }
  });
  $("#closeXhsQr").addEventListener("click", () => {
    stopXhsLoginPoll();
    $("#xhsQrDialog").close();
  });
  $("#xhsQrRetry").addEventListener("click", () => fetchXhsQr());
  $("#xhsQrDialog").addEventListener("close", stopXhsLoginPoll);
  $("#closeWechatQr").addEventListener("click", () => {
    stopWechatLoginPoll();
    $("#wechatQrDialog").close();
  });
  $("#wechatQrRetry").addEventListener("click", () => fetchWechatQr());
  $("#wechatQrDialog").addEventListener("close", stopWechatLoginPoll);
}

function uniqueFieldOptions(field) {
  const counts = new Map();
  for (const item of state.items) {
    const val = item[field] || "未知";
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  return [
    { value: "all", label: field === "stage" ? "全部阶段" : "全部国家/地区" },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, meta: `${count} 条` })),
  ];
}

function uniqueModeOptions() {
  const counts = new Map();
  for (const item of state.items) {
    const val = item.collection?.mode || "未知";
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  return [
    { value: "all", label: "全部采集方式" },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, meta: `${count} 条` })),
  ];
}

function renderAllComboboxes() {
  for (const [key, def] of Object.entries(comboboxDefs)) {
    const el = document.querySelector(`.combobox[data-key="${key}"]`);
    if (el) renderCombobox(el, key, def);
  }
}

function renderCombobox(container, key, def) {
  const value = state[key] ?? "all";
  const options = def.options();
  const selected = options.find((o) => o.value === value) ?? options[0];
  const searchable = !def.static && options.length > 6;

  container.innerHTML = `
    <button type="button" class="combobox-trigger" aria-haspopup="listbox">
      <span class="label">${escapeHtml(def.label)}：${escapeHtml(selected?.label ?? "全部")}</span>
      <span class="chevron">▾</span>
    </button>
    <div class="combobox-menu hidden" role="listbox">
      ${searchable ? `<div class="combobox-search-wrap"><input class="input combobox-search" placeholder="搜索…" /></div>` : ""}
      <ul class="combobox-options">
        ${options
          .map(
            (opt) => `
          <li class="combobox-option ${opt.value === value ? "selected" : ""}" data-value="${escapeHtml(opt.value)}" role="option">
            ${escapeHtml(opt.label)}
            ${opt.meta ? `<span class="option-meta">${escapeHtml(opt.meta)}</span>` : ""}
          </li>`,
          )
          .join("")}
      </ul>
    </div>`;

  const trigger = container.querySelector(".combobox-trigger");
  const menu = container.querySelector(".combobox-menu");
  const searchInput = container.querySelector(".combobox-search");

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !menu.classList.contains("hidden");
    closeAllComboboxes();
    if (!isOpen) {
      menu.classList.remove("hidden");
      container.classList.add("open");
      state.openCombobox = container;
      if (searchInput) {
        searchInput.value = "";
        filterComboboxOptions(container, "");
        searchInput.focus();
      }
    }
  });

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      event.stopPropagation();
      filterComboboxOptions(container, event.target.value.toLowerCase());
    });
    searchInput.addEventListener("click", (event) => event.stopPropagation());
  }

  container.querySelectorAll(".combobox-option").forEach((option) => {
    option.addEventListener("click", async (event) => {
      event.stopPropagation();
      const newValue = option.dataset.value;
      closeAllComboboxes();
      if (state[key] === newValue) return;
      state[key] = newValue;
      if (key === "status") {
        await loadState();
      } else if (key === "sort") {
        renderItems();
        renderFilterSummary();
        renderAllComboboxes();
      } else if (key === "sourceStatus") {
        renderSources();
        renderAllComboboxes();
      } else if (key === "collectItemSource") {
        renderCollectItems();
        renderAllComboboxes();
      } else {
        renderItems();
        renderFilterSummary();
        renderAllComboboxes();
      }
    });
  });
}

function filterComboboxOptions(container, query) {
  container.querySelectorAll(".combobox-option").forEach((option) => {
    const text = option.textContent.toLowerCase();
    option.classList.toggle("hidden", query && !text.includes(query));
  });
}

function closeAllComboboxes() {
  document.querySelectorAll(".combobox.open").forEach((el) => {
    el.classList.remove("open");
    el.querySelector(".combobox-menu")?.classList.add("hidden");
  });
  state.openCombobox = null;
}

function setPhase(phase) {
  state.phase = phase;
  localStorage.setItem("appPhase", phase);
  $("#collectPhase").classList.toggle("hidden", phase !== "collect");
  $("#analyzePhase").classList.toggle("hidden", phase !== "analyze");
  $("#phaseCollectBtn").classList.toggle("active", phase === "collect");
  $("#phaseAnalyzeBtn").classList.toggle("active", phase === "analyze");
  $("#collectBtn").classList.toggle("hidden", phase !== "collect");
}

function applyCollectOptionsToForm() {
  $("#collectLimit").value = String(state.collectLimit);
  $("#collectTimeRange").value = state.collectTimeRange;
}

function renderFilterSummary() { /* Analysis module owns counts, independent of collection selection. */ }

function filterItems() {
  let items = state.items.filter((item) => {
    const haystack = `${item.name} ${item.tagline} ${(item.evidence ?? []).map((e) => e.note).join(" ")} ${item.collection?.sourceId ?? ""}`.toLowerCase();
    if (state.itemSearch && !haystack.includes(state.itemSearch)) return false;

    if (state.itemSource !== "all" && item.collection?.sourceId !== state.itemSource) return false;

    if (state.itemRegion !== "all") {
      const source = state.sources.find((s) => s.id === item.collection?.sourceId);
      if (!source || source.region !== state.itemRegion) return false;
    }

    if (state.stage !== "all" && (item.stage || "未知") !== state.stage) return false;
    if (state.country !== "all" && (item.country || "未知") !== state.country) return false;
    if (state.mode !== "all" && (item.collection?.mode || "未知") !== state.mode) return false;

    if (state.scoreState !== "all") {
      const s = item.scoring?.state;
      if (state.scoreState === "scored" && s !== "scored") return false;
      if (state.scoreState === "partial" && s !== "partial_evidence") return false;
      if (state.scoreState === "no_evidence" && !["no_evidence", "no_sources", "zero_weight"].includes(s)) return false;
    }

    const potential = item.scoring?.potentialIndex;
    if (state.hideUnknown && (potential === null || potential === undefined)) return false;
    if (state.minPotential > 0 && (potential === null || potential === undefined || potential < state.minPotential)) return false;

    return true;
  });

  items = sortItems(items);
  return items;
}

function sortItems(items) {
  const copy = [...items];
  switch (state.sort) {
    case "discovered":
      copy.sort((a, b) => new Date(b.discoveredAt || 0) - new Date(a.discoveredAt || 0));
      break;
    case "lastSeen":
      copy.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
      break;
    case "name":
      copy.sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"));
      break;
    default:
      copy.sort((a, b) => (b.scoring?.rankScore ?? -1) - (a.scoring?.rankScore ?? -1));
  }
  return copy;
}

function filterCollectItems() {
  let items = [...state.items].filter((item) => {
    const haystack = `${item.name} ${item.tagline} ${item.collection?.sourceId ?? ""}`.toLowerCase();
    if (state.collectItemSearch && !haystack.includes(state.collectItemSearch)) return false;
    if (state.collectItemSource !== "all" && item.collection?.sourceId !== state.collectItemSource) return false;
    return true;
  });
  items.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
  return items;
}

function render(data = {}) {
  applyCollectOptionsToForm();
  setPhase(state.phase);
  renderSources();
  renderCollectSection();
  renderCoverage();
  renderCollectItems();
  renderLastRun(data.runs?.[0] ?? state.runs?.[0]);
  renderRunBanner(data.runs?.[0] ?? state.runs?.[0]);
  renderItems();
  renderFilterSummary();
  renderAllComboboxes();
}

function renderCollectItems() {
  const items = filterCollectItems();
  $("#collectInventoryCount").textContent = `${items.length} 条`;
  $("#collectItemsList").innerHTML = items.length
    ? items.map((item) => collectItemCard(item)).join("")
    : `<section class="empty-state"><div><h3>尚无入库数据</h3></div></section>`;
  bindItemCardActions("#collectItemsList");
}

function renderLastRun(run) {
  const el = $("#lastRunPanel");
  if (!el) return;
  if (!run) {
    el.innerHTML = "尚无采集记录";
    return;
  }
  const timeLabel = dateText(run.finishedAt || run.startedAt);
  const rangeLabel = run.timeRange ? TIME_RANGE_LABELS[run.timeRange] || run.timeRange : "近 90 天";
  const errors = (run.errors ?? []).length
    ? `<p class="hint setup-error">${run.errors.length} 个来源报错</p>`
    : "";
  el.innerHTML = `
    <p><strong>${timeLabel}</strong></p>
    <p class="hint">${run.itemCount ?? 0} 条 · 每源 ${run.limit ?? 12} 条 · ${rangeLabel}</p>
    <p class="hint">${(run.sources ?? []).length} 个来源</p>
    ${errors}`;
}

function collectItemCard(item) {
  const source = state.sources.find((entry) => entry.id === item.collection?.sourceId);
  const primaryUrl = item.sampleMode ? null : (item.urls ?? []).map(safeUrl).find(Boolean);
  const facts = latestFacts(item).slice(0, 4);
  return `
    <article class="item-card collect-card">
      <div>
        <div class="item-title">
          <h3>${primaryUrl ? externalLink(primaryUrl, item.name) : escapeHtml(item.name)}</h3>
          ${source ? `<span class="pill">${escapeHtml(source.name)}</span>` : ""}
          ${item.sampleMode ? '<span class="pill commercial">示例</span>' : ""}
        </div>
        <p>${escapeHtml(item.tagline)}</p>
        <div class="meta">入库 ${dateText(item.discoveredAt)} · 更新 ${dateText(item.lastSeenAt)}</div>
        <div class="fact-grid">
          ${
            facts.length
              ? facts
                  .map(
                    (fact) => `
              <div class="fact-chip">
                <strong>${escapeHtml(factLabel(fact.kind))}</strong>
                <span>${escapeHtml(formatFactValue(fact.value))}</span>
              </div>`,
                  )
                  .join("")
              : '<span class="hint">暂无 facts</span>'
          }
        </div>
        <div class="actions">
          <button class="small" data-open-detail="${item.id}">查看原始数据</button>
        </div>
      </div>
      <div class="collect-side">
        <div class="score-note">原始入库</div>
        <div class="score-note">${escapeHtml(item.collection?.mode || "未知")}</div>
        <div class="score-note">facts ${(item.facts ?? []).length}${item.collection?.coverage === "hotlist_metadata" ? " · 热榜摘要" : item.content ? " · 有正文" : ""}</div>
      </div>
    </article>`;
}

function bindItemCardActions(containerSelector) {
  document.querySelectorAll(`${containerSelector} [data-open-detail]`).forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.openDetail));
  });
  document.querySelectorAll(`${containerSelector} [data-status-action]`).forEach((button) => {
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

function setSidebarCollapsed(collapsed) {
  state.sourcesCollapsed = collapsed;
  localStorage.setItem("sourcesCollapsed", String(collapsed));
  applySidebarCollapsed();
}

function applySidebarCollapsed() {
  $("#sourcesPanel").classList.toggle("collapsed", state.sourcesCollapsed);
  document.querySelector(".workspace").classList.toggle("sidebar-collapsed", state.sourcesCollapsed);
}

function isSourceCollectible(source) {
  if (!source) return false;
  if (source.status === "implemented" || source.status === "configured") return true;
  return source.automatic && !sourceNeedsSetup(source);
}

function isSourceUnavailable(source) {
  return !isSourceCollectible(source);
}

function matchesSourceAvailability(source) {
  if (state.sourceAvailability === "ready") return isSourceCollectible(source);
  if (state.sourceAvailability === "unavailable") return isSourceUnavailable(source);
  return true;
}

function collectibleSourceIds() {
  return state.sources.filter(source => isSourceCollectible(source) && (!["xiaohongshu", "wechat"].includes(source.id) || source.login?.loggedIn === true)).map(source => source.id);
}

function renderCollectSection() {
  const collectible = collectibleSourceIds();
  const rangeLabel = TIME_RANGE_LABELS[state.collectTimeRange] || state.collectTimeRange;
  const collectBtn = $("#collectBtn");
  if (collectBtn && !state.collecting) {
    collectBtn.disabled = collectible.length === 0;
    collectBtn.textContent = "一键采集";
    collectBtn.title =
      collectible.length === 0
        ? "暂无可用来源，请先登录或配置"
        : `${rangeLabel} · 每源 ${state.collectLimit} 条`;
  }
  $("#collectOptionsHint").textContent = `每源 ${state.collectLimit} 条 · ${rangeLabel}`;
  $("#sourceCountCollapsed").textContent = `${collectible.length} 源`;
}

function renderSourceSelectionStatus(message) {
  const el = $("#sourceSelectionStatus");
  if (!el) return;
  el.textContent = message ?? "";
}

function applySourceSelection(nextIds) {
  state.selectedSourceIds = [...new Set(nextIds)];
  renderSources();
  renderCollectSection();
  persistSourceSelection();
}

function toggleSource(id, checked) {
  if (!id) return;
  applySourceSelection(
    checked
      ? [...state.selectedSourceIds, id]
      : state.selectedSourceIds.filter((sourceId) => sourceId !== id),
  );
}

async function persistSourceSelection() {
  try {
    await fetchJson("/api/settings", {
      method: "POST",
      body: JSON.stringify({ selectedSourceIds: state.selectedSourceIds }),
    });
    state.selectionSavedAt = Date.now();
    renderSourceSelectionStatus(`已选 ${state.selectedSourceIds.length} 个来源`);
  } catch (error) {
    toast(`保存选择失败：${error.message}`);
  }
}

function selectVisibleSources(checked) {
  const visibleIds = visibleSourceIds();
  applySourceSelection(
    checked
      ? [...state.selectedSourceIds, ...visibleIds]
      : state.selectedSourceIds.filter((id) => !visibleIds.includes(id)),
  );
}

function selectAllSources() {
  applySourceSelection(state.sources.map((source) => source.id));
}

function invertVisibleSources() {
  const visibleIds = new Set(visibleSourceIds());
  const selected = new Set(state.selectedSourceIds);
  for (const id of visibleIds) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  applySourceSelection([...selected]);
}

function clearAllSources() {
  applySourceSelection([]);
}

function updateSourceSelectAllCheckbox() {
  const checkbox = $("#selectAllVisibleCheckbox");
  if (!checkbox) return;
  const visibleIds = visibleSourceIds();
  if (!visibleIds.length) {
    checkbox.checked = false;
    checkbox.indeterminate = false;
    checkbox.disabled = true;
    return;
  }
  checkbox.disabled = false;
  const selectedCount = visibleIds.filter((id) => state.selectedSourceIds.includes(id)).length;
  checkbox.checked = selectedCount === visibleIds.length;
  checkbox.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length;
}

function filterSourcesList(sources) {
  return sources.filter((source) => {
    if (state.region !== "all" && source.region !== state.region) return false;
    if (!matchesSourceAvailability(source)) return false;
    const haystack = `${source.name} ${source.status} ${source.env} ${source.notes}`.toLowerCase();
    return haystack.includes(state.sourceSearch);
  });
}

function visibleSourceIds() {
  return filterSourcesList(state.sources).map((source) => source.id);
}

function itemCountBySource() {
  const counts = Object.fromEntries(state.sources.map((source) => [source.id, 0]));
  for (const item of state.items) {
    const id = item.collection?.sourceId;
    if (id && counts[id] !== undefined) counts[id] += 1;
  }
  return counts;
}

function sourceNeedsSetup(source) {
  return ["needs_setup", "needs_key"].includes(source.status) || source.setup?.missing?.length;
}

function renderSourceAvailabilityTabs() {
  const readyCount = state.sources.filter(isSourceCollectible).length;
  const unavailableCount = state.sources.length - readyCount;
  document.querySelectorAll(".source-availability button").forEach((button) => {
    const count =
      button.dataset.availability === "ready"
        ? readyCount
        : button.dataset.availability === "unavailable"
          ? unavailableCount
          : state.sources.length;
    const base =
      button.dataset.availability === "ready"
        ? "可用"
        : button.dataset.availability === "unavailable"
          ? "需配置"
          : "全部";
    button.textContent = `${base} ${count}`;
    button.classList.toggle("active", button.dataset.availability === state.sourceAvailability);
  });
}

function renderSources() {
  const loginSources = state.sources.filter(source => ["xiaohongshu", "wechat"].includes(source.id));
  $("#sourceCount").textContent = "";
  $("#sourcesList").innerHTML = loginSources.map(source => `
    <div class="login-source-row">
      <div><strong>${escapeHtml(source.name)}</strong><small>${source.login?.loggedIn ? "已登录" : "未登录"}</small></div>
      <button type="button" class="ghost small" ${source.id === "xiaohongshu" ? "data-xhs-login" : "data-wechat-login"}>${source.login?.loggedIn ? "重新登录" : "扫码登录"}</button>
    </div>`).join("");
}

function renderCoverage() {
  const counts = itemCountBySource();
  const regions = [
    ["china", "国内来源"],
    ["overseas", "海外来源"],
    ["mixed", "混合来源"],
  ];
  const rows = regions.map(([region, label]) => {
    const sources = state.sources.filter((source) => source.region === region);
    const itemTotal = sources.reduce((sum, source) => sum + (counts[source.id] ?? 0), 0);
    const withData = sources.filter((source) => (counts[source.id] ?? 0) > 0).length;
    const empty = sources.filter((source) => (counts[source.id] ?? 0) === 0);
    return `
      <div class="coverage-block">
        <div class="coverage-head">
          <strong>${label}</strong>
          <span>${itemTotal} 条 · ${withData}/${sources.length} 源有数据</span>
        </div>
        <div class="coverage-sources">
          ${sources
            .map((source) => {
              const n = counts[source.id] ?? 0;
              return `<div class="coverage-row ${n ? "ok" : "empty"}"><span>${escapeHtml(source.name)}</span><span>${n} 条</span></div>`;
            })
            .join("")}
        </div>
        ${empty.length ? `<p class="hint">尚无数据：${empty.map((s) => s.name).join("、")}</p>` : ""}
      </div>`;
  });
  $("#coverageTotal").textContent = `${state.items.length} 条可见`;
  $("#coveragePanel").innerHTML = rows.join("");
}

function renderItems() {
  renderAnalysis({ type: state.type, search: state.itemSearch, reset: () => { state.type = 'all'; state.itemSearch = ''; } });
}

function itemCard(item) {
  const primaryUrl = item.sampleMode ? null : (item.urls ?? []).map(safeUrl).find(Boolean);
  const source = state.sources.find((entry) => entry.id === item.collection?.sourceId);
  const scoring = item.scoring ?? {};
  const potential =
    scoring.potentialIndex === null || scoring.potentialIndex === undefined
      ? null
      : Math.round(scoring.potentialIndex);
  const typeText = item.type === "open_source" ? "开源" : "创业";

  return `
    <article class="item-card item-card-minimal">
      <div class="item-row">
        <div class="item-main">
          <div class="item-title">
            <h3>${primaryUrl ? externalLink(primaryUrl, item.name) : escapeHtml(item.name)}</h3>
            ${potential !== null ? `<span class="score-badge">${potential}</span>` : ""}
          </div>
          <p>${escapeHtml(item.tagline)}</p>
          <div class="meta">${typeText}${source ? ` · ${escapeHtml(source.name)}` : ""} · ${dateText(item.lastSeenAt)}</div>
        </div>
        <div class="item-actions-minimal">
          <button class="ghost icon-btn" data-open-detail="${item.id}" title="详情">⋯</button>
        </div>
      </div>
    </article>`;
}

const METRIC_KINDS = [
  { kind: "stars", label: "Stars", excellent: 10000, color: "#10a37f" },
  { kind: "forks", label: "Forks", excellent: 2000, color: "#2563eb" },
  { kind: "watchers", label: "Watchers", excellent: 1000, color: "#7c3aed" },
  { kind: "downloads", label: "Downloads", excellent: 100000, color: "#b45309" },
  { kind: "likes", label: "Likes", excellent: 5000, color: "#db2777" },
  { kind: "points", label: "Points", excellent: 1500, color: "#0891b2" },
  { kind: "comments", label: "Comments", excellent: 600, color: "#64748b" },
];

function logBarPercent(value, excellent) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(100, (Math.log1p(num) / Math.log1p(excellent)) * 100);
}

function detailSparkline(facts, kind) {
  const points = (facts ?? [])
    .filter((fact) => fact.kind === kind && Number.isFinite(Number(fact.value)))
    .sort((a, b) => Date.parse(a.collectedAt || 0) - Date.parse(b.collectedAt || 0));
  if (points.length < 2) return "";
  const values = points.map((point) => Number(point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const width = 300;
  const height = 72;
  const pad = 8;
  const coords = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <figure class="detail-sparkline">
      <figcaption>${escapeHtml(factLabel(kind))} 历史</figcaption>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(factLabel(kind))} 趋势">
        <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#ececf1"/>
        <polyline points="${coords.join(" ")}" fill="none" stroke="#10a37f" stroke-width="2.5"/>
        ${values.map((value, index) => {
          const x = pad + (index / (values.length - 1)) * (width - pad * 2);
          const y = height - pad - ((value - min) / range) * (height - pad * 2);
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#10a37f"><title>${escapeHtml(dateText(points[index].collectedAt))}：${value.toLocaleString("zh-CN")}</title></circle>`;
        }).join("")}
      </svg>
      <div class="detail-sparkline-range"><span>${min.toLocaleString("zh-CN")}</span><span>${max.toLocaleString("zh-CN")}</span></div>
    </figure>`;
}

function detailMetricBars(item) {
  const facts = latestFacts(item);
  const bars = METRIC_KINDS.map((spec) => {
    const fact = facts.find((entry) => entry.kind === spec.kind);
    if (!fact || !Number.isFinite(Number(fact.value))) return "";
    const value = Number(fact.value);
    const width = logBarPercent(value, spec.excellent);
    return `
      <div class="detail-metric-row">
        <div class="detail-metric-head">
          <span>${escapeHtml(spec.label)}</span>
          <strong>${value.toLocaleString("zh-CN")}</strong>
        </div>
        <div class="detail-metric-bar"><span style="width:${width.toFixed(1)}%;background:${spec.color}"></span></div>
      </div>`;
  }).filter(Boolean);
  if (!bars.length) return '<p class="hint">暂无数值型指标（stars / forks 等）。</p>';
  const sparklines = ["stars", "forks"].map((kind) => detailSparkline(item.facts, kind)).filter(Boolean).join("");
  return `<div class="detail-metrics">${bars.join("")}</div>${sparklines}`;
}

function detailDateChips(item) {
  const facts = latestFacts(item).filter((fact) => !METRIC_KINDS.some((spec) => spec.kind === fact.kind));
  if (!facts.length) return "";
  return `
    <div class="fact-grid">
      ${facts.map((fact) => `
        <div class="fact-chip">
          <strong>${escapeHtml(factLabel(fact.kind))}</strong>
          <span>${escapeHtml(formatFactValue(fact.value))}</span>
        </div>`).join("")}
    </div>`;
}

function detailHeroStats(scoring, item) {
  const facts = latestFacts(item);
  const stars = facts.find((fact) => fact.kind === "stars")?.value;
  const forks = facts.find((fact) => fact.kind === "forks")?.value;
  const cells = [
    { label: "潜力指数", value: scoring.potentialIndex, na: "未知" },
    { label: "Kimi 匹配", value: item.kimiFit?.index, na: "未知" },
    { label: "Stars", value: stars, na: "—" },
    { label: "Forks", value: forks, na: "—" },
  ];
  return `
    <div class="detail-hero">
      ${cells.map((cell) => `
        <div class="detail-hero-cell">
          <strong class="${cell.value === null || cell.value === undefined ? "na" : ""}">${cell.value === null || cell.value === undefined ? cell.na : (Number.isFinite(Number(cell.value)) ? Number(cell.value).toLocaleString("zh-CN") : score(cell.value))}</strong>
          <span>${cell.label}</span>
          ${Number.isFinite(Number(cell.value)) && (cell.label === "潜力指数" || cell.label === "Kimi 匹配") ? `<div class="bar"><span style="width:${Math.min(100, Number(cell.value))}%"></span></div>` : ""}
        </div>`).join("")}
    </div>`;
}

function detailDimensionChart(dimensions) {
  if (!dimensions.length) return '<p class="hint">没有维度评分。</p>';
  return `
    <div class="detail-dimensions">
      ${dimensions.map((dim) => {
        const value = dim.dimensionScore;
        const width = value === null ? 0 : Math.min(100, Math.max(0, value));
        return `
          <div class="detail-dimension ${value === null ? "unknown" : ""}">
            <div class="detail-dimension-head">
              <strong>${escapeHtml(dim.label)}</strong>
              <span>${value === null ? "未知" : Math.round(value)}</span>
            </div>
            <div class="bar"><span style="width:${width}%"></span></div>
            <div class="detail-dimension-meta">
              <span>覆盖 ${pct(dim.evidenceCoverage)}</span>
              <span>权重 ${dim.configuredWeight}</span>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

function detailFactsTable(facts) {
  if (!facts?.length) return '<p class="hint">没有历史记录。</p>';
  return `
    <table class="detail-table">
      <thead><tr><th>指标</th><th>数值</th><th>采集时间</th></tr></thead>
      <tbody>
        ${facts.map((fact) => `
          <tr>
            <td>${escapeHtml(factLabel(fact.kind))}</td>
            <td>${escapeHtml(formatFactValue(fact.value))}</td>
            <td>${escapeHtml(dateText(fact.collectedAt))}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function detailEvidenceTable(evidence) {
  if (!evidence?.length) return '<p class="hint">没有证据条目。</p>';
  return `
    <table class="detail-table">
      <thead><tr><th>来源</th><th>指标</th><th>值</th></tr></thead>
      <tbody>
        ${evidence.map((entry) => `
          <tr>
            <td>${escapeHtml(entry.sourceId || "—")}</td>
            <td>${escapeHtml(entry.metric?.name || entry.dimensionId || "—")}</td>
            <td>${escapeHtml(entry.metric?.value ?? JSON.stringify(entry.metric ?? entry.value ?? "—"))}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function openDetail(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const source = state.sources.find((entry) => entry.id === item.collection?.sourceId);
  const scoring = item.scoring ?? {};
  const typeLabel = item.type === "open_source" ? "开源项目" : item.type === "lead" || item.type === "hotnews" ? "待识别线索" : "创业公司";
  $("#detailDrawer").classList.remove("hidden");
  $("#detailDrawer").innerHTML = `
    <div class="drawer-inner detail-viz">
      <div class="drawer-head">
        <div>
          <p class="eyebrow">${typeLabel} · ${item.sampleMode ? "示例记录" : "真实/导入记录"}</p>
          <h2>${escapeHtml(item.name)}</h2>
          <p class="hint">${escapeHtml(item.tagline)}</p>
          ${itemLinks(item)}
          <div class="meta">${source ? `${regionText(source.region)} · ${escapeHtml(source.name)}` : "来源未知"} · ${escapeHtml(item.collection?.mode || "")}</div>
        </div>
        <button id="closeDrawer" class="ghost">关闭</button>
      </div>
      ${detailHeroStats(scoring, item)}
      <section class="detail-section">
        <h3>关键指标</h3>
        ${detailMetricBars(item)}
        ${detailDateChips(item)}
      </section>
      <section class="detail-section">
        <h3>维度评分</h3>
        ${detailDimensionChart(scoring.dimensions ?? [])}
      </section>
      <details class="detail-fold">
        <summary>采集正文</summary>
        <pre class="collected-content">${escapeHtml(item.content ? contentText(item.content) : "未取得正文，请打开原始链接。")}</pre>
      </details>
      <details class="detail-fold">
        <summary>历史采集记录（${(item.facts ?? []).length} 条）</summary>
        ${detailFactsTable(item.facts)}
      </details>
      <details class="detail-fold">
        <summary>原始证据（${(item.evidence ?? []).length} 条）</summary>
        ${detailEvidenceTable(item.evidence)}
      </details>
      <details class="detail-fold">
        <summary>collection 元数据</summary>
        <pre class="collected-content compact-json">${escapeHtml(JSON.stringify(item.collection ?? {}, null, 2))}</pre>
      </details>
    </div>`;
  const drawer = $("#detailDrawer");
  const closeDrawer = () => drawer.classList.add("hidden");
  $("#closeDrawer").addEventListener("click", closeDrawer);
  drawer.onclick = (event) => {
    if (event.target === drawer) closeDrawer();
  };
}

function latestFacts(item) {
  const map = new Map();
  for (const fact of item.facts ?? []) {
    const previous = map.get(fact.kind);
    if (!previous || new Date(fact.collectedAt || 0) >= new Date(previous.collectedAt || 0)) {
      map.set(fact.kind, fact);
    }
  }
  return [...map.values()];
}

function factLabel(kind) {
  return (
    {
      stars: "Stars",
      forks: "Forks",
      watchers: "Watchers",
      open_issues: "Open issues",
      created_at: "创建时间",
      pushed_at: "最近推送",
      downloads: "Downloads",
      likes: "Likes",
      points: "Points",
      comments: "Comments",
      followers: "Followers",
      score: "平台分",
    }[kind] ?? kind
  );
}

function formatFactValue(value) {
  if (value === null || value === undefined) return "未知";
  if (typeof value === "number") return value.toLocaleString("zh-CN");
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return dateText(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderRunBanner(run) {
  if (!run) {
    $("#runBanner").classList.add("hidden");
    return;
  }
  $("#runBanner").classList.remove("hidden");
  const sourceIds = run.sources?.length
    ? run.sources
    : [...new Set((run.errors ?? []).map((error) => error.sourceId).filter(Boolean))];
  const sourceText = sourceIds.length
    ? sourceIds.map((id) => state.sources.find((source) => source.id === id)?.name || id).join("、")
    : "未知";
  $("#runBanner").textContent = `最近刷新 ${dateText(run.finishedAt)}，来源 ${sourceText}，写入 ${run.itemCount} 条${summarizeRunErrors(run.errors)}`;
}

function summarizeRunErrors(errors) {
  if (!errors?.length) return "";
  const groups = new Map();
  for (const error of errors) {
    const key = `${error.sourceId || "unknown"}|${error.code || error.message}`;
    const group = groups.get(key) || {
      sourceId: error.sourceId,
      code: error.code,
      message: error.message,
      count: 0,
    };
    group.count += 1;
    groups.set(key, group);
  }
  const parts = [...groups.values()].map((group) => {
    const name = state.sources.find((source) => source.id === group.sourceId)?.name || group.sourceId || "未知来源";
    if (group.code === "rate_limited") {
      return `${name} 被上游限流 ${group.count} 次（HTTP 429）。公开接口配额打满，稍后再试；库存数据不受影响`;
    }
    if (group.code === "skipped_rate_limit") {
      return `${name} 因限流跳过 ${group.count} 个目标`;
    }
    return group.count > 1 ? `${name}：${group.message} ×${group.count}` : `${name}：${group.message}`;
  });
  return `。${parts.join("；")}`;
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
          items: filterItems().map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            status: item.status,
            sourceId: item.collection?.sourceId,
            urls: item.urls,
            facts: latestFacts(item),
            potentialIndex: item.scoring?.potentialIndex,
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

function setCollectProgress({ completed = 0, total = 0, sourceName = "采集中", detail = "", saving = false } = {}) {
  state.collectProgress = { completed, total, sourceName, detail };
  const el = $("#collectProgress");
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  el.classList.toggle("hidden", !state.collecting);
  el.classList.toggle("is-saving", saving);
  $("#progressRingFill").style.strokeDashoffset = String(100 - percent);
  $("#progressFraction").textContent = total ? `${completed}/${total}` : "…";
  $("#progressSourceName").textContent = sourceName;
  $("#progressDetail").textContent = detail;
}

function beginCollectUI(total) {
  state.collecting = true;
  setCollectProgress({ completed: 0, total, sourceName: "准备采集", detail: `共 ${total} 个来源` });
}

function endCollectUI() {
  state.collecting = false;
  $("#collectProgress").classList.add("hidden");
  $("#collectProgress").classList.remove("is-saving");
}

function finishCollectUI() {
  endCollectUI();
  renderCollectSection();
}

async function loadBaselineStore() {
  const button = $("#loadBaselineBtn");
  if (button.disabled) return;
  try {
    const info = await fetchJson("/api/store/baseline");
    if (!info.available) {
      toast("未找到原始数据库文件，请先在本机运行 npm run baseline:export 并部署。");
      return;
    }
    const when = info.exportedAt ? info.exportedAt.slice(0, 10) : "未知日期";
    const ok = window.confirm(
      `将合并仓库内的原始数据库（${info.items} 条，导出于 ${when}）到当前入库数据。\n\n` +
        `当前非示例条目：${info.currentItems} 条。相同 ID 会合并 facts/证据，不会整库覆盖。\n\n继续？`,
    );
    if (!ok) return;
    button.disabled = true;
    button.textContent = "合并中…";
    const result = await fetchJson("/api/store/load-baseline", { method: "POST" });
    toast(`已加载原始数据库：新增 ${result.added} 条，合并 ${result.merged} 条，现有 ${result.after} 条。`);
    await loadState();
    await renderAnalysis({ type: state.type, search: state.itemSearch, reset: () => { state.type = "all"; state.itemSearch = ""; } });
  } catch (error) {
    toast(`加载失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "加载原始数据库";
  }
}

async function collectFromSources() {
  const implemented = collectibleSourceIds();
  if (!implemented.length) {
    toast("暂无可用来源，请先登录账号或配置数据源");
    return;
  }
  const button = $("#collectBtn");
  button.disabled = true;
  button.textContent = "采集中…";
  beginCollectUI(implemented.length);
  let hideTimer = null;
  try {
    const result = await collectWithProgress(implemented);
    const loginError = result.run.errors?.find((error) => error.code === "needs_login" && error.sourceId === "xiaohongshu");
    const wechatLoginError = result.run.errors?.find((error) => error.code === "needs_login" && error.sourceId === "wechat");
    if (loginError) {
      toast("小红书需要先扫码登录");
      openXhsQrDialog({ reason: loginError.message.replace(/运行 npm run xhs:qrcode[^。]*。?/g, "").trim() || "请用小红书 App 扫码登录后再采集" });
    } else if (wechatLoginError) {
      toast("微信公众号需要先扫码登录");
      openWechatQrDialog({ reason: wechatLoginError.message || "请用微信扫码授权后再采集" });
    } else if (result.run.errors?.length) {
      const summary = result.run.errors.map((error) => {
        const name = state.sources.find((source) => source.id === error.sourceId)?.name || error.sourceId;
        return `${name}：${error.message}`;
      }).join("；");
      toast(`采集${result.run.itemCount ? "部分完成" : "未取得数据"}：写入 ${result.run.itemCount} 条；${summary}`);
    } else if (result.run.itemCount === 0) {
      toast("采集完成，但未写入新数据（来源可能为空或尚未同步）");
    } else {
      toast(`采集完成：写入 ${result.run.itemCount} 条`);
    }
    setCollectProgress({
      completed: implemented.length,
      total: implemented.length,
      sourceName: "采集完成",
      detail: `写入 ${result.run.itemCount} 条`,
    });
    // Restore the button immediately; keep the progress chip visible briefly.
    button.disabled = false;
    button.textContent =
      "一键采集";
    hideTimer = setTimeout(() => finishCollectUI(), 1800);
    await loadState().catch((error) => {
      toast(`刷新列表失败：${error.message}`);
    });
  } catch (error) {
    if (hideTimer) clearTimeout(hideTimer);
    finishCollectUI();
    toast(`采集失败：${error.message}`);
  } finally {
    button.disabled = false;
    if (!state.collecting) renderCollectSection();
  }
}

async function collectWithProgress(sources) {
  const response = await fetch("/api/refresh?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sources,
      limit: state.collectLimit,
      timeRange: state.collectTimeRange,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "start") {
        beginCollectUI(payload.total ?? sources.length);
      }
      if (event === "progress") {
        handleCollectProgress(payload);
      }
      if (event === "done") result = payload;
      if (event === "error") throw new Error(payload.error || "采集失败");
    }
  }

  if (!result) throw new Error("采集未完成");
  return result;
}

function handleCollectProgress(payload) {
  if (payload.phase === "saving") {
    setCollectProgress({
      completed: payload.completed ?? payload.total ?? 0,
      total: payload.total ?? 0,
      sourceName: "写入本地",
      detail: "保存入库中…",
      saving: true,
    });
    return;
  }

  const completed = payload.phase === "done" ? payload.index + 1 : payload.index;
  const detail =
    payload.phase === "start"
      ? "正在采集…"
      : payload.status === "ok"
        ? `完成 · ${payload.itemCount ?? 0} 条`
        : payload.status === "partial"
          ? `部分成功 · ${payload.itemCount ?? 0} 条`
          : `跳过或失败`;

  setCollectProgress({
    completed,
    total: payload.total ?? 0,
    sourceName: payload.phase === "start" ? `正在采集 ${payload.sourceName ?? payload.sourceId}` : payload.sourceName ?? payload.sourceId ?? "采集中",
    detail,
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error(body.error === "Not found" ? "服务接口未加载，请刷新页面；若仍失败，终端运行 npm run up 重启" : body.error || "接口不存在");
    }
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

function connectionText(source) {
  const connection = source.connection || {};
  if (source.id === "xiaohongshu" && source.login?.loggedIn && ["needs_login", "not_tested"].includes(connection.state)) {
    return `已登录${source.login.savedAt ? ` · ${dateText(source.login.savedAt)}` : ""} · 可采集`;
  }
  if (source.id === "wechat" && source.login?.loggedIn && ["needs_login", "not_tested"].includes(connection.state)) {
    return "已登录 · 可采集";
  }
  const labels = { not_tested: "尚未执行采集", ok: "最近采集成功", partial: "最近采集部分成功", error: "最近采集失败", needs_login: "需要登录", needs_setup: "需要配置", unreachable: "服务不可达", rate_limited: "上游限流", upstream_error: "上游服务异常", invalid_response: "接口响应异常" };
  return `${labels[connection.state] || "采集异常"}${connection.at ? ` · ${dateText(connection.at)} · ${connection.itemCount} 条` : ""}`;
}

function contentText(content) {
  if (content.text) return content.text;
  if (!content.html) return "";
  const template = document.createElement("template");
  template.innerHTML = content.html;
  template.content.querySelectorAll("script,style,noscript").forEach(node => node.remove());
  template.content.querySelectorAll("p,div,br,li,h1,h2,h3").forEach(node => node.append(document.createTextNode("\n")));
  return template.content.textContent.trim();
}

let xhsLoginPoll = null;

function stopXhsLoginPoll() {
  if (xhsLoginPoll) {
    clearInterval(xhsLoginPoll);
    xhsLoginPoll = null;
  }
}

async function openXhsQrDialog(options = {}) {
  stopXhsLoginPoll();
  $("#xhsQrImage").hidden = true;
  $("#xhsQrSpinner").classList.remove("hidden");
  $("#xhsQrRetry").classList.add("hidden");
  $("#xhsQrMessage").textContent = options.reason || "正在请求登录二维码…（首次可能需等待浏览器启动）";
  $("#xhsQrDialog").showModal();
  try {
    const status = await fetchJson("/api/xiaohongshu/login-status");
    if (status.loggedIn) {
      $("#xhsQrSpinner").classList.add("hidden");
      $("#xhsQrMessage").textContent = "小红书已登录，可以直接采集。";
      await loadState();
      return;
    }
  } catch {
    /* continue to fetch QR */
  }
  await fetchXhsQr();
  xhsLoginPoll = setInterval(async () => {
    try {
      const status = await fetchJson("/api/xiaohongshu/login-status");
      if (!status.loggedIn) return;
      stopXhsLoginPoll();
      $("#xhsQrSpinner").classList.add("hidden");
      $("#xhsQrImage").hidden = true;
      $("#xhsQrRetry").classList.add("hidden");
      $("#xhsQrMessage").textContent = "登录成功！可以关闭窗口并点击「采集新数据」。";
      toast("小红书登录成功");
      await loadState();
    } catch {
      /* keep polling */
    }
  }, 2000);
}

async function fetchXhsQr() {
  $("#xhsQrSpinner").classList.remove("hidden");
  $("#xhsQrImage").hidden = true;
  $("#xhsQrRetry").classList.add("hidden");
  try {
    const data = await fetchJson("/api/xiaohongshu/qrcode", { method: "POST" });
    $("#xhsQrSpinner").classList.add("hidden");
    if (data.isLoggedIn) {
      $("#xhsQrMessage").textContent = "小红书已登录，可以直接采集。";
      await loadState();
      return;
    }
    if (data.mode === "browser") {
      $("#xhsQrMessage").textContent = data.message;
      return;
    }
    $("#xhsQrMessage").textContent = "请用小红书 App 扫描下方二维码。过期后点「重新获取」。";
    $("#xhsQrImage").src = data.image;
    $("#xhsQrImage").hidden = false;
    $("#xhsQrRetry").classList.remove("hidden");
  } catch (error) {
    $("#xhsQrSpinner").classList.add("hidden");
    $("#xhsQrMessage").textContent = `二维码获取失败：${error.message}。请确认 xiaohongshu-mcp 已启动，或稍后重试。`;
    $("#xhsQrRetry").classList.remove("hidden");
  }
}

let wechatLoginPoll = null;

function stopWechatLoginPoll() {
  if (wechatLoginPoll) {
    clearInterval(wechatLoginPoll);
    wechatLoginPoll = null;
  }
}

async function openWechatQrDialog(options = {}) {
  stopWechatLoginPoll();
  $("#wechatQrImage").hidden = true;
  $("#wechatQrSpinner").classList.remove("hidden");
  $("#wechatQrRetry").classList.add("hidden");
  $("#wechatQrMessage").textContent = options.reason || "正在生成登录二维码…（上游打开公众平台可能需要几十秒）";
  $("#wechatQrDialog").showModal();
  try {
    const status = await fetchJson("/api/wechat/login-status");
    if (status.loggedIn) {
      $("#wechatQrSpinner").classList.add("hidden");
      $("#wechatQrMessage").textContent = "微信公众号已授权，可以直接采集。";
      await loadState();
      return;
    }
  } catch {
    /* continue */
  }
  await fetchWechatQr();
  wechatLoginPoll = setInterval(async () => {
    try {
      const status = await fetchJson("/api/wechat/login-status");
      if (!status.loggedIn) return;
      stopWechatLoginPoll();
      $("#wechatQrSpinner").classList.add("hidden");
      $("#wechatQrImage").hidden = true;
      $("#wechatQrRetry").classList.add("hidden");
      $("#wechatQrMessage").textContent = "登录成功！可以关闭窗口并点击「采集新数据」。";
      toast("微信公众号登录成功");
      await loadState();
    } catch {
      /* keep polling */
    }
  }, 2000);
}

async function fetchWechatQr() {
  $("#wechatQrSpinner").classList.remove("hidden");
  $("#wechatQrImage").hidden = true;
  $("#wechatQrRetry").classList.add("hidden");
  try {
    const data = await fetchJson("/api/wechat/qrcode", { method: "POST" });
    $("#wechatQrSpinner").classList.add("hidden");
    if (data.isLoggedIn) {
      $("#wechatQrMessage").textContent = "微信公众号已授权，可以直接采集。";
      await loadState();
      return;
    }
    $("#wechatQrMessage").textContent = data.message || "请用微信扫描下方二维码。过期后点「重新获取」。";
    $("#wechatQrImage").src = data.image;
    $("#wechatQrImage").hidden = false;
    $("#wechatQrRetry").classList.remove("hidden");
  } catch (error) {
    $("#wechatQrSpinner").classList.add("hidden");
    $("#wechatQrMessage").textContent = `二维码获取失败：${error.message}`;
    $("#wechatQrRetry").classList.remove("hidden");
  }
}

try {
  await loadState();
} catch (error) {
  toast(`加载失败：${error.message}`);
}
bindEvents();
applySidebarCollapsed();
registerModelContextTools();
renderAllComboboxes();
const configuredSource = new URLSearchParams(location.search).get("configure");
if (configuredSource) location.replace(`/collection.html?edit=${encodeURIComponent(configuredSource)}`);
