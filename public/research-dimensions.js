const STARTUP_OVERVIEW = [
  { group: 'team', name: '领域经验' },
  { group: 'team', name: '过往交付' },
  { group: 'team', name: '职能互补' },
  { group: 'product', name: '需求强度' },
  { group: 'product', name: '价值兑现' },
];

const ENGINEERING_NAMES = ['协作广度', '贡献分散程度', '公开交付积累'];
const PRODUCT_PICKS = ['需求强度', '价值兑现'];

const byName = (list = []) => new Map(list.map((d) => [d.name, d]));

export function researchOverviewDimensions(report = {}) {
  const team = byName(report.teamDimensions);
  const product = byName(report.productDimensions);
  const engineering = byName(report.dimensions);

  if (report.teamDimensions?.length || report.productDimensions?.length) {
    return STARTUP_OVERVIEW.map(({ group, name }) => {
      const hit = group === 'team' ? team.get(name) : product.get(name);
      return hit || { name, score: null, reason: '缺少证据', status: 'missing' };
    });
  }

  if (report.dimensions?.length) {
    const dims = ENGINEERING_NAMES.map((name) => engineering.get(name) || { name, score: null, reason: '缺少证据', status: 'missing' });
    for (const name of PRODUCT_PICKS) {
      if (product.has(name)) dims.push(product.get(name));
    }
    return dims.slice(0, 5);
  }

  return [];
}

export function researchCompositeScore(dimensions = []) {
  const known = dimensions.filter((d) => Number.isFinite(d.score));
  return known.length ? Math.round(known.reduce((sum, d) => sum + d.score, 0) / known.length) : null;
}
