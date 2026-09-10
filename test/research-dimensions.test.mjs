import test from 'node:test';
import assert from 'node:assert/strict';
import { researchCompositeScore, researchOverviewDimensions } from '../public/research-dimensions.js';
import { researchDimensionOverview, researchPanels } from '../public/research-panels.js';

test('startup overview defines five dimensions but only scored ones render', () => {
  const dims = researchOverviewDimensions({
    teamDimensions: [{ name: '领域经验', score: 70 }, { name: '过往交付', score: 55 }],
    productDimensions: [{ name: '需求强度', score: 80 }, { name: '价值兑现', score: null }],
  });
  assert.equal(dims.length, 5);
  assert.equal(researchCompositeScore(dims.filter((d) => d.score != null)), 68);
  const html = researchDimensionOverview({
    status: 'partial',
    teamDimensions: [{ name: '领域经验', score: 70 }],
    productDimensions: [{ name: '需求强度', score: 80 }],
  });
  assert.match(html, /领域经验/);
  assert.doesNotMatch(html, /职能互补/);
  assert.equal(researchDimensionOverview({ status: 'partial', teamDimensions: [{ name: '领域经验', score: null }] }), '');
});

test('completed research renders dimension overview and hides empty sections', () => {
  const html = researchPanels({
    status: 'partial',
    summary: '有缺口',
    teamDimensions: [{ name: '领域经验', score: 60, reason: 'ok' }],
    productDimensions: [{ name: '需求强度', score: 40, reason: 'ok' }],
  });
  assert.match(html, /调研五维/);
  assert.match(html, /团队分析/);
  assert.match(html, /产品判断/);
  assert.doesNotMatch(html, /团队组成/);
  assert.doesNotMatch(html, /尚未识别/);
  assert.equal(researchDimensionOverview({ status: 'running' }), '');
});
