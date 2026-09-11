import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCrisMirrorAdapter } from '../../../src/adapters/cris/mirror.js';
import { createAdapters } from '../../../src/adapters/index.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../../src/core/query.js';
import { loadConfig } from '../../../src/runtime/config.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off',
  raw: false,
};

const MIRROR = 'https://kctis.example.test';
const cfg = () => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-cris-mirror-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
  crisBaseUrl: 'https://cris.example.test',
  ctisBaseUrl: 'https://ctis.example.test',
  ictrpAcknowledged: true,
  crisMirrorUrl: MIRROR,
});

function stub(handler: (url: string) => { status?: number; body: unknown }, urls: string[] = []) {
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const r = handler(String(url));
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls, sleep: async () => {} };
}

/** KCTIS `/api/cris/search` 한 항목 — 공식 API 상세와 같은 필드 이름. */
const study = (id: string, over: Record<string, unknown> = {}) => ({
  trial_id: id,
  scientific_title_kr: '건강한 성인에서 비타민 C 약동학',
  scientific_title_en: 'Vitamin C PK in healthy adults',
  study_type_kr: '중재연구',
  date_registration: '2025/08/01',
  recruitment_status_kr: '연구종결',
  recruitment_status_en: 'Completed',
  scientific_name_kr: '김민걸',
  scientific_name_en: 'Min-Gul Kim',
  affiliation_kr: '전북대학교병원',
  target_size: 18,
  type_enrolment_kr: '실제등록',
  sponsor_items: [{ primary_sponsor_kr: '전북대학교병원', primary_sponsor_en: 'JBUH' }],
  research_items: [{ site_name_kr: '전북대학교병원', site_name_en: 'JBUH' }],
  ...over,
});
const meta = { source: 'CRIS official API, mirrored by KCTIS', collected_at: '2026-09-10T15:32:46+00:00', studies: 12585 };

/**
 * CRIS 미러 — 사용자가 KCTIS 에 만든 CRIS 전체 사본. **연구책임자가 목록 축이 된다.**
 * 공식 API 로는 후보를 하나씩 열어야 했던 것(1~3분, 검색어 범위에 갇힘)이 조회 하나가 된다.
 * 대신 사본이다 — 그 사실을 레코드마다가 아니라 응답마다 경고 하나로 말한다.
 */
describe('CRIS 미러 어댑터', () => {
  it('연구자 이름이 목록 축이다 — 상세를 하나씩 열지 않고, term 없이도 된다', async () => {
    const { fetchImpl, urls, sleep } = stub(() => ({ body: { total: 2, page: 1, limit: 100, items: [study('KCT0000001'), study('KCT0000002', { scientific_name_en: 'Mingul Kim' })], meta } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    const r = await a.search({ investigator: '김민걸', pageSize: 100 } as NormalizedQuery, fetchOpts);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/cris/search?');
    expect(decodeURIComponent(urls[0]!)).toContain('investigator=김민걸');
    expect(r.total).toBe(2);
    expect(r.data.map((x) => x.id)).toEqual(['CRIS:KCT0000001', 'CRIS:KCT0000002']);
    // 연구책임자 국문·영문이 연락처로 실린다 — names 가 이것으로 표기를 센다.
    expect(r.data[0]!.contacts).toEqual(expect.arrayContaining([{ name: '김민걸', role: '연구책임자' }, { name: 'Min-Gul Kim', role: '연구책임자' }]));
    expect(r.data[0]!.status).toBe('completed');
    expect(r.warnings.map((w) => w.code)).not.toContain('investigator_checked_by_detail');
  });

  it('사본임을 응답마다 한 번 말한다 — 수집 시각과 함께', async () => {
    const { fetchImpl, sleep } = stub(() => ({ body: { total: 0, page: 1, limit: 20, items: [], meta } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    const r = await a.search({ term: 'x', pageSize: 20 } as NormalizedQuery, fetchOpts);
    const w = r.warnings.find((x) => x.code === 'cris_mirror_copy');
    expect(w?.message).toContain('2026-09-10');
    expect(w?.message).toMatch(/사본|KCTIS/);
  });

  it('status 는 공통 어휘 → 미러의 영문 값으로, page-token 은 쪽 번호로', async () => {
    const { fetchImpl, urls, sleep } = stub(() => ({ body: { total: 0, page: 3, limit: 20, items: [], meta } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    await a.search({ term: '당뇨', status: ['recruiting', 'active_not_recruiting'], pageToken: '3', pageSize: 20 } as NormalizedQuery, fetchOpts);
    const u = decodeURIComponent(urls[0]!).replace(/\+/g, ' ');
    expect(u).toContain('status=Recruiting,Active, not recruiting');
    expect(u).toContain('page=3');
    expect(u).toContain('q=당뇨');
  });

  it('능력 선언이 다르다 — investigator 는 목록 축, status 로 거를 수 있다', () => {
    const a = createCrisMirrorAdapter(cfg(), stub(() => ({ body: {} })));
    const c = a.capability();
    expect(c.key).toBe('cris');
    expect(c.search.investigator.supported).toBe(true);
    expect(c.search.investigator.scope).not.toMatch(/하나씩/);
    expect(c.search.status.supported).toBe(true);
    expect(c.search.status.values).toEqual(expect.arrayContaining(['recruiting', 'completed']));
  });

  it('get 은 /api/cris/<id> 를 부르고, 404 는 not_found 다 — 실패가 아니다', async () => {
    const { fetchImpl, sleep } = stub((u) => (u.endsWith('/KCT0000001') ? { body: { ...study('KCT0000001'), meta } } : { status: 404, body: { error: 'not found' } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    const r = await a.get(['CRIS:KCT0000001', 'CRIS:KCT9999999'], fetchOpts);
    expect(r.data.map((x) => x.id)).toEqual(['CRIS:KCT0000001']);
    expect(r.warnings.find((w) => w.code === 'not_found')?.id).toBe('CRIS:KCT9999999');
  });

  it('count 는 total 이다', async () => {
    const { fetchImpl, sleep } = stub(() => ({ body: { total: 43, page: 1, limit: 1, items: [], meta } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    expect((await a.count({ investigator: '김민걸' } as NormalizedQuery, fetchOpts)).data).toBe(43);
  });

  it('CRIS 의 모집상태 일곱 값이 전부 공통 어휘로 간다 — other 로 뭉개지 않는다', async () => {
    const statuses: [string, string][] = [
      ['모집 중', 'recruiting'], ['대상자 모집 전', 'not_yet_recruiting'], ['모집추가없이 진행중', 'active_not_recruiting'],
      ['일시중지', 'suspended'], ['모집중단', 'terminated'], ['연구종결', 'completed'], ['연구철회', 'withdrawn'],
    ];
    const { fetchImpl, sleep } = stub(() => ({ body: { total: 7, page: 1, limit: 20, items: statuses.map(([kr], i) => study(`KCT000000${i}`, { recruitment_status_kr: kr })), meta } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    const r = await a.search({ term: 'x', pageSize: 20 } as NormalizedQuery, fetchOpts);
    expect(r.data.map((x) => x.status)).toEqual(statuses.map(([, en]) => en));
  });
});

describe('어댑터 선택', () => {
  it('CTREG_CRIS_MIRROR_URL 이 있으면 미러를, 없으면 공식 API 를 쓴다 — 같은 cris 키', () => {
    const withMirror = createAdapters(loadConfig({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'c-')), CTREG_CRIS_MIRROR_URL: `${MIRROR}/` }));
    expect(withMirror.cris!.capability().search.investigator.scope).not.toMatch(/하나씩/);
    const without = createAdapters(loadConfig({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'c-')) }));
    expect(without.cris!.capability().search.investigator.scope).toMatch(/하나씩/);
  });
});

describe('CRIS 미러 — 연구책임자 집계', () => {
  it('/api/cris/investigators 를 부르고 순위·모수·사본 경고를 낸다', async () => {
    const { fetchImpl, urls, sleep } = stub(() => ({ body: { matched: 276, q: ['당뇨', 'diabetes'], items: [
      { name_kr: '김난희', name_en: 'Nan Hee Kim', affiliations: ['고려대'], trials: 10, latest: '2025/11/01', sample_ids: ['KCT0011737'] },
    ], meta: { ...meta, basis: '등록 건수' } } }));
    const a = createCrisMirrorAdapter(cfg(), { fetchImpl, sleep });
    const r = await a.investigators!({ terms: ['당뇨', 'diabetes'], status: ['recruiting'], limit: 10 }, fetchOpts);
    const u = decodeURIComponent(urls[0]!).replace(/\+/g, ' ');
    expect(u).toContain('/api/cris/investigators?');
    expect(u).toContain('q=당뇨,diabetes');
    expect(u).toContain('status=Recruiting');
    expect(u).toContain('limit=10');
    expect(r.data.matched).toBe(276);
    expect(r.data.items[0]).toMatchObject({ name: '김난희', nameEn: 'Nan Hee Kim', trials: 10, sampleIds: ['CRIS:KCT0011737'] });
    expect(r.warnings.map((w) => w.code)).toContain('cris_mirror_copy');
    expect(a.capability().investigators?.supported).toBe(true);
  });

  it('공식 API 문은 이 축을 신고하지 않는다 — 없거나 false', async () => {
    const { CRIS_CAPABILITY } = await import('../../../src/adapters/cris/adapter.js');
    expect(CRIS_CAPABILITY.investigators?.supported ?? false).toBe(false);
  });
});
