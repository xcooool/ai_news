import { getSource } from "./sources.mjs";

export const openSourceDimensions = [
  {
    id: "real_adoption",
    label: "真实采用 / 下游集成",
    weight: 34,
    definition: "项目被开发者持续使用、复用、集成或讨论的证据。star 只算低置信关注线索。",
  },
  {
    id: "maintenance_delivery",
    label: "维护与交付",
    weight: 26,
    definition: "近期提交、发布、issue 处理、文档与安装路径体现的可交付程度。",
  },
  {
    id: "growth_persistence",
    label: "增长持续性",
    weight: 22,
    definition: "跨时间窗口的新增关注、使用或社区互动。没有历史就保持未知。",
  },
  {
    id: "ecosystem_expansion",
    label: "生态扩展",
    weight: 18,
    definition: "插件、模板、模型、fork、依赖方和下游项目扩展情况。",
  },
];

export const startupDimensions = [
  {
    id: "demand_validated",
    label: "需求成立",
    weight: 30,
    definition: "明确痛点、可识别买方、反复出现的搜索/讨论/试用请求，而不是单次曝光。",
  },
  {
    id: "value_realized",
    label: "价值兑现",
    weight: 28,
    definition: "用户或客户已获得可验证结果、替代旧流程、愿意付费或深度使用。",
  },
  {
    id: "adoption_persistence",
    label: "采用持续性",
    weight: 24,
    definition: "复用、留存、活跃讨论、迭代反馈和非一次性试用。",
  },
  {
    id: "scale_conditions",
    label: "规模化条件",
    weight: 18,
    definition: "分发渠道、集成难度、合规/部署路径、团队招聘与 GTM 准备度。",
  },
];

export const kimiDimensions = [
  {
    id: "model_api_need",
    label: "模型调用需求",
    weight: 42,
    definition: "产品是否天然消耗模型 token、上下文、工具调用或多模态 API。",
  },
  {
    id: "technical_fit",
    label: "技术匹配",
    weight: 34,
    definition: "长上下文、中文/代码能力、Agent/API 集成、企业部署与 Moonshot 能力的贴合度。",
  },
  {
    id: "partnership_timing",
    label: "合作时机",
    weight: 24,
    definition: "是否处在可被 GTM 触达、替换供应商、共创方案或放量试用的窗口。",
  },
];

export const defaultWeights = {
  open_source: Object.fromEntries(openSourceDimensions.map((d) => [d.id, d.weight])),
  startup: Object.fromEntries(startupDimensions.map((d) => [d.id, d.weight])),
  kimi_fit: Object.fromEntries(kimiDimensions.map((d) => [d.id, d.weight])),
};

const credibilityFactor = {
  fact: 1,
  third_party_estimate: 0.78,
  self_reported: 0.58,
  model_inference: 0.42,
};

export function clamp(value, min = 0, max = 100) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function logNormalize(value, { start = 1, excellent = 10000 } = {}) {
  if (!Number.isFinite(value) || value <= start) return 0;
  const top = Math.log10(excellent + start);
  const current = Math.log10(value + start);
  return clamp((current / top) * 100);
}

export function recencyScore(dateLike, now = new Date()) {
  if (!dateLike) return null;
  const ts = new Date(dateLike).getTime();
  if (Number.isNaN(ts)) return null;
  const days = Math.max(0, (now.getTime() - ts) / 86400000);
  if (days <= 3) return 100;
  if (days <= 14) return 82;
  if (days <= 45) return 62;
  if (days <= 120) return 36;
  return 14;
}

export function anchoredLevel(level) {
  const map = {
    none: 0,
    weak: 25,
    plausible: 45,
    good: 68,
    strong: 84,
    proven: 96,
  };
  return map[level] ?? null;
}

export function normalizeMetric(metric) {
  if (typeof metric?.score === "number") return clamp(metric.score);
  if (metric?.method === "log") return logNormalize(metric.value, metric);
  if (metric?.method === "recency") return recencyScore(metric.value);
  if (metric?.method === "anchored_level") return anchoredLevel(metric.value);
  if (metric?.method === "ratio") return clamp((metric.value ?? 0) * 100);
  return null;
}

export function scoreItems(items, options = {}) {
  return items
    .map((item) => ({
      ...item,
      scoring: scoreItem(item, options),
      kimiFit: scoreKimiFit(item, options),
    }))
    .sort((a, b) => b.scoring.rankScore - a.scoring.rankScore);
}

export function scoreItem(item, options = {}) {
  const selectedSourceIds = options.selectedSourceIds ?? [];
  const weights = resolvedWeights(item.type, options.weights ?? {});
  const dimensions = dimensionsForType(item.type);
  const evidence = selectedEvidence(item, selectedSourceIds);
  const totalConfiguredWeight = dimensions.reduce(
    (sum, dimension) => sum + Math.max(0, Number(weights[dimension.id] ?? 0)),
    0,
  );

  if (selectedSourceIds.length === 0) {
    return unavailable("no_sources", "未选择任何来源，无法计算有效权重。", dimensions, weights);
  }
  if (totalConfiguredWeight === 0) {
    return unavailable("zero_weight", "当前维度权重合计为 0，无法计算指数。", dimensions, weights);
  }
  if (evidence.length === 0) {
    return unavailable("no_evidence", "已选来源下没有可用证据；未知不会按 0 分处理。", dimensions, weights);
  }

  const dimensionScores = dimensions.map((dimension) => {
    const traces = evidence
      .filter((entry) => entry.dimensionId === dimension.id)
      .map((entry) => evidenceTrace(entry))
      .filter((entry) => entry.normalizedScore !== null);
    const evidenceCoverage = clamp(
      traces.reduce((sum, trace) => sum + trace.effectiveConfidence, 0),
      0,
      1,
    );
    const configuredWeight = Math.max(0, Number(weights[dimension.id] ?? 0));
    const effectiveWeight = configuredWeight * evidenceCoverage;
    const confidenceSum = traces.reduce((sum, trace) => sum + trace.effectiveConfidence, 0);
    const dimensionScore =
      confidenceSum > 0
        ? traces.reduce((sum, trace) => sum + trace.normalizedScore * trace.effectiveConfidence, 0) /
          confidenceSum
        : null;
    return {
      id: dimension.id,
      label: dimension.label,
      definition: dimension.definition,
      configuredWeight,
      evidenceCoverage,
      effectiveWeight,
      dimensionScore,
      state: dimensionScore === null ? "unknown" : evidenceCoverage < 0.45 ? "partial" : "scored",
      traces,
    };
  });

  const effectiveWeightTotal = dimensionScores.reduce((sum, d) => sum + d.effectiveWeight, 0);
  if (effectiveWeightTotal === 0) {
    return {
      potentialIndex: null,
      rankScore: -1,
      state: "no_evidence",
      coverage: 0,
      confidence: 0,
      reason: "证据存在但没有可归一化指标，保持未知。",
      dimensions: dimensionScores,
    };
  }

  const weightedAverage =
    dimensionScores.reduce((sum, d) => sum + (d.dimensionScore ?? 0) * d.effectiveWeight, 0) /
    effectiveWeightTotal;
  const coverage = clamp(effectiveWeightTotal / totalConfiguredWeight, 0, 1);
  const confidence = clamp(
    dimensionScores.reduce((sum, d) => sum + d.evidenceCoverage, 0) / dimensions.length,
    0,
    1,
  );
  const coveragePenalty = 0.45 + coverage * 0.55;
  const potentialIndex = clamp(weightedAverage * coveragePenalty);

  return {
    potentialIndex,
    rankScore: potentialIndex,
    state: coverage < 0.45 ? "partial_evidence" : "scored",
    coverage,
    confidence,
    reason:
      coverage < 0.45
        ? "证据覆盖不足，指数已按覆盖率折减；不与完整证据对象无条件比较。"
        : "指数基于当前选中来源证据与有效权重计算。",
    dimensions: dimensionScores,
  };
}

export function scoreKimiFit(item, options = {}) {
  const selectedSourceIds = options.selectedSourceIds ?? [];
  const weights = resolvedWeights("kimi_fit", options.weights ?? {});
  const selected = selectedEvidence(item, selectedSourceIds);
  const totalConfiguredWeight = kimiDimensions.reduce(
    (sum, dimension) => sum + Math.max(0, Number(weights[dimension.id] ?? 0)),
    0,
  );
  if (selectedSourceIds.length === 0 || totalConfiguredWeight === 0) {
    return { index: null, coverage: 0, state: "unavailable", dimensions: [] };
  }
  const dimensionScores = kimiDimensions.map((dimension) => {
    const traces = selected
      .filter((entry) => entry.kimiDimensionId === dimension.id)
      .map((entry) => evidenceTrace(entry))
      .filter((entry) => entry.normalizedScore !== null);
    const evidenceCoverage = clamp(
      traces.reduce((sum, trace) => sum + trace.effectiveConfidence, 0),
      0,
      1,
    );
    const configuredWeight = Math.max(0, Number(weights[dimension.id] ?? 0));
    const effectiveWeight = configuredWeight * evidenceCoverage;
    const confidenceSum = traces.reduce((sum, trace) => sum + trace.effectiveConfidence, 0);
    const dimensionScore =
      confidenceSum > 0
        ? traces.reduce((sum, trace) => sum + trace.normalizedScore * trace.effectiveConfidence, 0) /
          confidenceSum
        : null;
    return {
      id: dimension.id,
      label: dimension.label,
      definition: dimension.definition,
      configuredWeight,
      evidenceCoverage,
      effectiveWeight,
      dimensionScore,
      traces,
    };
  });
  const effectiveWeightTotal = dimensionScores.reduce((sum, d) => sum + d.effectiveWeight, 0);
  if (effectiveWeightTotal === 0) {
    return { index: null, coverage: 0, state: "no_evidence", dimensions: dimensionScores };
  }
  const weightedAverage =
    dimensionScores.reduce((sum, d) => sum + (d.dimensionScore ?? 0) * d.effectiveWeight, 0) /
    effectiveWeightTotal;
  const coverage = clamp(effectiveWeightTotal / totalConfiguredWeight, 0, 1);
  return {
    index: clamp(weightedAverage * (0.5 + coverage * 0.5)),
    coverage,
    state: coverage < 0.45 ? "partial_evidence" : "scored",
    dimensions: dimensionScores,
  };
}

export function evidenceTrace(entry) {
  const source = getSource(entry.sourceId);
  const normalizedScore = normalizeMetric(entry.metric);
  const credibility = credibilityFactor[entry.credibility] ?? 0.5;
  const trust = source?.trust ?? 0.5;
  const confidence = clamp(entry.confidence ?? 0.4, 0, 1);
  return {
    id: entry.id,
    sourceId: entry.sourceId,
    sourceName: source?.name ?? entry.sourceId,
    collectedAt: entry.collectedAt,
    credibility: entry.credibility,
    rawMetric: entry.metric,
    normalization: describeNormalization(entry.metric),
    normalizedScore,
    confidence,
    sourceTrust: trust,
    credibilityFactor: credibility,
    effectiveConfidence: normalizedScore === null ? 0 : clamp(confidence * trust * credibility, 0, 1),
    note: entry.note,
    url: entry.url,
  };
}

function selectedEvidence(item, selectedSourceIds) {
  const selected = new Set(selectedSourceIds);
  return (item.evidence ?? []).filter((evidence) => selected.has(evidence.sourceId));
}

function dimensionsForType(type) {
  return type === "open_source" ? openSourceDimensions : startupDimensions;
}

function resolvedWeights(type, weights = {}) {
  const base = defaultWeights[type] ?? {};
  return { ...base, ...(weights[type] ?? weights) };
}

function unavailable(state, reason, dimensions, weights) {
  return {
    potentialIndex: null,
    rankScore: -1,
    state,
    coverage: 0,
    confidence: 0,
    reason,
    dimensions: dimensions.map((dimension) => emptyDimension(dimension, weights)),
  };
}

function emptyDimension(dimension, weights) {
  return {
    id: dimension.id,
    label: dimension.label,
    definition: dimension.definition,
    configuredWeight: Math.max(0, Number(weights[dimension.id] ?? 0)),
    evidenceCoverage: 0,
    effectiveWeight: 0,
    dimensionScore: null,
    state: "unknown",
    traces: [],
  };
}

function describeNormalization(metric) {
  if (!metric) return "无可归一化指标";
  if (typeof metric.score === "number") return "已给定 0-100 结构化分，仍按来源置信度折算有效权重。";
  if (metric.method === "log") {
    return `对数归一化：log10(value + ${metric.start ?? 1}) / log10(${metric.excellent ?? 10000} + ${metric.start ?? 1}) * 100。`;
  }
  if (metric.method === "recency") {
    return "新近度分段：3天内100、14天内82、45天内62、120天内36、更早14。";
  }
  if (metric.method === "anchored_level") {
    return "锚点等级：none 0、weak 25、plausible 45、good 68、strong 84、proven 96。";
  }
  if (metric.method === "ratio") return "比例归一化：value * 100 后截断到 0-100。";
  return "未知归一化方法，保持未知。";
}
