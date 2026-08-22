import { describe, expect, it } from 'vitest';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';
import { buildFields, buildIdsParams, buildSearchParams } from '../../../src/adapters/ctgov/query.js';

const opts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
};

describe('CT.gov 쿼리 조립', () => {
  it('검색 축을 전용 query.* 파라미터로 옮긴다', () => {
    const { params } = buildSearchParams(
      { condition: 'NSCLC', intervention: 'osimertinib', term: 'EGFR', title: 'phase 3', location: 'Seoul', outcomeQuery: 'PFS', sponsor: 'AstraZeneca' },
      opts,
    );
    expect(params['query.cond']).toBe('NSCLC');
    expect(params['query.intr']).toBe('osimertinib');
    expect(params['query.term']).toBe('EGFR');
    expect(params['query.titles']).toBe('phase 3');
    expect(params['query.locn']).toBe('Seoul');
    expect(params['query.outc']).toBe('PFS');
    expect(params['query.spons']).toBe('AstraZeneca');
  });

  it('참조 구현이 쓰지 않던 lead/id/patient 축을 채운다', () => {
    const { params } = buildSearchParams({ lead: 'Merck', id: 'NCT01234567', patient: '62 year old female' }, opts);
    expect(params['query.lead']).toBe('Merck');
    expect(params['query.id']).toBe('NCT01234567');
    expect(params['query.patient']).toBe('62 year old female');
  });

  it('상태 목록은 파이프로 잇는다', () => {
    const { params } = buildSearchParams({ status: ['recruiting', 'completed'] }, opts);
    expect(params['filter.overallStatus']).toBe('RECRUITING|COMPLETED');
  });

  it('phase 는 filter.advanced 의 AREA[Phase] 로 간다', () => {
    const { params } = buildSearchParams({ phase: ['phase_2', 'phase_3'] }, opts);
    expect(params['filter.advanced']).toBe('(AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)');
  });

  it('표현식이 둘 이상이면 괄호로 싸 AND 로 잇는다', () => {
    const { params } = buildSearchParams({ phase: ['phase_3'], studyType: 'interventional' }, opts);
    expect(params['filter.advanced']).toBe('(AREA[Phase]PHASE3) AND (AREA[StudyType]INTERVENTIONAL)');
  });

  it('지오는 좌표와 단위 있는 반경을 distance() 로 만든다', () => {
    const { params } = buildSearchParams(
      { near: { lat: 37.5665, lon: 126.978 }, radius: { value: 100, unit: 'km' } },
      opts,
    );
    expect(params['filter.geo']).toBe('distance(37.5665,126.978,100km)');
  });

  it('--radius 만 있고 --near 가 없으면 exit 2 다', () => {
    try {
      buildSearchParams({ radius: { value: 100, unit: 'km' } }, opts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).hint).toContain('--near');
    }
  });

  it('날짜 범위는 AREA[...]RANGE[...] 이고, 누락 시험을 배제한다는 경고를 남긴다', () => {
    const { params, warnings } = buildSearchParams({ updatedSince: '2025-01-01' }, opts);
    expect(params['filter.advanced']).toBe('(AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX])');
    expect(warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('양쪽 경계가 있으면 RANGE 의 두 자리를 모두 채운다', () => {
    const { params } = buildSearchParams({ startAfter: '2024-01-01', startBefore: '2024-12-31' }, opts);
    expect(params['filter.advanced']).toBe('(AREA[StartDate]RANGE[2024-01-01, 2024-12-31])');
  });

  it('날짜 형식이 YYYY-MM-DD 가 아니면 exit 2 다', () => {
    expect(() => buildSearchParams({ updatedSince: '2025/01/01' }, opts)).toThrow();
  });

  it('pageSize 를 캡에 묶고 countTotal 을 켠다', () => {
    const { params } = buildSearchParams({ pageSize: 9999 }, opts);
    expect(params.pageSize).toBe(CAPS.pageSize.max);
    expect(params.countTotal).toBe('true');
  });

  it('pageToken 을 그대로 통과시킨다 — 페이지 번호가 아니다', () => {
    const { params } = buildSearchParams({}, opts);
    expect(params.pageToken).toBeUndefined();
    expect(buildSearchParams({ pageToken: 'abc' }, opts).params.pageToken).toBe('abc');
  });

  it('include 에 따라 fields 투영이 늘어난다', () => {
    const core = buildFields(['core']);
    const withElig = buildFields(['core', 'eligibility']);
    expect(core).toContain('protocolSection.identificationModule.nctId');
    expect(core.some((f) => f.includes('eligibilityModule.eligibilityCriteria'))).toBe(false);
    expect(withElig.some((f) => f.includes('eligibilityModule.eligibilityCriteria'))).toBe(true);
    expect(buildFields(['all']).length).toBeGreaterThan(withElig.length);
  });

  it('get 배치는 filter.ids 를 파이프로 잇는다', () => {
    const p = buildIdsParams(['NCT01234567', 'NCT07654321'], opts);
    expect(p['filter.ids']).toBe('NCT01234567|NCT07654321');
  });
});
