import test from 'node:test';
import assert from 'node:assert/strict';
import { researchConfig, enrichResearch, validateResearch } from '../lib/research-llm.mjs';
import { gatherGithubTeam } from '../lib/team-research.mjs';
import { teamView, researchPanels } from '../public/research-panels.js';

test('model extraction rejects unsupported quotes, identity URLs, funding, and high scores', () => {
  const docs = [{ url: 'https://example.org', text: 'Alice built a working product. Customers pay monthly.' }];
  const r = validateResearch({
    people: [
      { name: 'Alice', profileUrl: 'https://github.com/invented', source: docs[0].url, quote: 'Alice built a working product.' },
      { name: 'Bob', source: docs[0].url, quote: 'Bob founded Microsoft.' },
    ],
    funding: [{ amount: '100M', source: docs[0].url, quote: 'Raised 100 million.' }],
    productDimensions: [{ name: '需求强度', score: 99, source: docs[0].url, quote: 'Enterprise unicorn.' }],
    teamDimensions: [{ name: '过往交付', score: 60, source: docs[0].url, quote: 'Alice built a working product.' }],
  }, docs);
  assert.equal(r.people.length, 1);
  assert.equal(r.people[0].profileUrl, null);
  assert.equal(r.funding.length, 0);
  assert.equal(r.productDimensions[0].score, null);
  assert.equal(r.score, 60);
});

test('transient model fetch failed is retried once and surfaces connection cause', async () => {
  let called = 0;
  const result = await enrichResearch({ name: 'Test' }, [], {
    env: { RESEARCH_LLM_API_KEY: 'test-only' },
    fetcher: async () => {
      called++;
      if (called === 1) {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'ECONNRESET', message: 'read ECONNRESET' };
        throw error;
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }) };
    },
  });
  assert.equal(called, 2);
  assert.equal(result.llm.status, 'done');
  try {
    await enrichResearch({ name: 'Test' }, [], {
      env: { RESEARCH_LLM_API_KEY: 'test-only' },
      fetcher: async () => {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' };
        throw error;
      },
    });
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /DeepSeek/);
    assert.match(error.message, /UND_ERR_CONNECT_TIMEOUT|fetch failed/);
  }
});

test('DeepSeek contract uses public endpoint, reasoning payload, and bearer key', async () => {
  let called = 0;
  const result = await enrichResearch({ name: 'Test' }, [], {
    env: { RESEARCH_LLM_API_KEY: 'test-only' },
    fetcher: async (url, options) => {
      called++;
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      assert.equal(options.headers['SOFA-TraceId'], undefined);
      assert.equal(options.headers['SOFA-RpcId'], undefined);
      const b = JSON.parse(options.body);
      assert.equal(b.model, 'deepseek-v4-pro');
      assert.equal(b.reasoning_effort, 'high');
      assert.deepEqual(b.thinking, { type: 'enabled' });
      assert.equal(b.stream, false);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"summary":"no evidence"}' } }] }) };
    },
  });
  assert.equal(called, 1);
  assert.equal(result.llm.status, 'done');
  assert.equal(result.score, null);
  const c = researchConfig({ RESEARCH_LLM_PROVIDER: 'public', RESEARCH_LLM_URL: 'https://example.org/v1/chat/completions', RESEARCH_LLM_API_KEY: 'test', RESEARCH_LLM_MODEL: 'other' });
  assert.equal(c.model, 'other');
  assert.equal(c.configured, true);
  assert.equal(c.provider, 'public');
});

test('DeepSeek accepts a base URL and antchat remains an explicit legacy provider', async () => {
  const deepseek = researchConfig({ RESEARCH_LLM_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_API_KEY: 'test' });
  assert.equal(deepseek.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(deepseek.model, 'deepseek-v4-pro');
  assert.equal(deepseek.configured, true);
  const antchat = researchConfig({ RESEARCH_LLM_PROVIDER: 'antchat', ANTCHAT_API_KEY: 'test-only' });
  assert.equal(antchat.endpoint, 'https://antchat.alipay.com/v1/chat/completions');
  assert.equal(antchat.model, 'Kimi-K2.5');
  assert.equal(antchat.configured, true);
});

test('research deadlines are configurable and a full timeout is not submitted twice', async t => {
  assert.equal(researchConfig({}).timeoutMs, 600000);
  assert.equal(researchConfig({RESEARCH_LLM_TIMEOUT_MS:'invalid'}).timeoutMs, 600000);
  assert.equal(researchConfig({RESEARCH_LLM_TIMEOUT_MS:'-1'}).timeoutMs, 600000);
  assert.equal(researchConfig({RESEARCH_LLM_PROVIDER:'antchat'}).timeoutMs, 120000);
  const deadlines=[];
  t.mock.method(AbortSignal, 'timeout', ms => { deadlines.push(ms); return new AbortController().signal; });
  let calls=0;
  await assert.rejects(enrichResearch({name:'Test'}, [], {
    env:{RESEARCH_LLM_API_KEY:'test-only',RESEARCH_LLM_TIMEOUT_MS:'420000'},
    fetcher:async()=>{calls++;throw new DOMException('timed out','TimeoutError');},
  }), error=>error.message.includes('420 秒')&&error.cause.name==='TimeoutError');
  assert.equal(calls,1);
  assert.deepEqual(deadlines,[420000]);
});

test('member research resumes after thirty profiles instead of permanently excluding later contributors', async () => {
  const cache = { contributors: [], people: [], nextPage: 1, listingComplete: false };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => url.includes('/contributors')
        ? Array.from({ length: 35 }, (_, i) => ({ login: 'member' + i, type: 'User', contributions: 36 - i }))
        : { name: url.split('/').at(-1), public_repos: 1 },
    };
  };
  const opts = { fetcher, env: {}, cache, persistCache: async () => {} };
  const a = await gatherGithubTeam({ key: 'github:test/repo' }, opts);
  assert.equal(a.people.length, 30);
  assert.equal(a.coverage.remaining, true);
  const before = calls.length;
  const b = await gatherGithubTeam({ key: 'github:test/repo' }, opts);
  assert.equal(b.people.length, 35);
  assert.equal(b.coverage.remaining, false);
  assert.equal(calls.length - before, 5);
  assert.equal(b.people[34].handle, 'member34');
});

test('coverage distinguishes named people, fetched profiles, unknown funding and truncated model context', async () => {
  const { researchCoverage } = await import('../lib/research-progress.mjs');
  const c = researchCoverage({
    engineering: { roster: [{ name: 'one' }, { name: 'two' }], people: [{ handle: 'one' }], coverage: { listingComplete: false, remaining: true } },
    findings: { people: [], sourceCount: 2, contextTruncated: true },
    documents: [1, 2, 3],
  });
  assert.equal(c.pendingProfiles, 1);
  assert.equal(c.teamComplete, false);
  assert.equal(c.fundingStatus, 'unknown');
  assert.equal(c.contextTruncated, true);
  assert.equal(c.people[1].status, 'pending');
});

test('GitHub public location and company surface as Base, merged with extracted team members', async () => {
  const r = await gatherGithubTeam({ key: 'github:a/b' }, {
    env: {},
    fetcher: async (u) => ({
      ok: true,
      status: 200,
      json: async () => u.includes('contributors')
        ? [{ type: 'User', login: 'one', contributions: 10 }]
        : { name: 'One', public_repos: 5, bio: 'Developer', location: 'Berlin', company: '@Acme' },
    }),
  });
  assert.equal(r.people[0].base.city, 'Berlin');
  assert.equal(r.people[0].company, '@Acme');
  const view = teamView({
    status: 'partial',
    people: r.people,
    extractedPeople: [{
      name: 'One',
      url: 'https://github.com/one',
      role: '创始人',
      education: [{ institution: 'Test University', source: 'https://github.com/one', quote: 'studied at Test University' }],
    }],
    funding: [{ round: 'Seed', amount: '$2M', source: 'https://github.com/one', quote: 'raised seed' }],
  });
  assert.equal(view.members.length, 1);
  assert.equal(view.members[0].role, '创始人');
  assert.equal(view.locations[0].city, 'Berlin');
  assert.equal(view.companies[0].name, '@Acme');
  assert.equal(view.education[0].institution, 'Test University');
  const html = researchPanels({ status: 'partial', people: r.people, extractedPeople: view.members, funding: view.funding });
  assert.match(html, /Base 调研/);
  assert.match(html, /Berlin/);
  assert.match(html, /团队组成/);
  assert.match(html, /\$2M/);
});

test('running research renders a progress card instead of empty team sections', () => {
  const html = researchPanels({
    status: 'running',
    progress: { phase: 'member_profiles', completed: 20, pending: 43, listed: 63 },
  });
  assert.match(html, /research-progress/);
  assert.match(html, /正在读取公开资料/);
  assert.match(html, /20 \/ 63/);
  assert.doesNotMatch(html, /尚未识别出可展示的成员/);
  assert.doesNotMatch(html, /member_profiles/);
});

test('failed research coverage counts collected documents, not only GitHub profiles', () => {
  const html = researchPanels({
    status: 'error',
    message: 'fetch failed',
    researchCoverage: { knownPeople: 0, profilesFetched: 0, pendingProfiles: 0, documentsAvailable: 17, documentsUsed: 0, people: [] },
  });
  assert.match(html, /已读 17 份材料/);
});
