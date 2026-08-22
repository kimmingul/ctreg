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

  it('phase 는 filter.advanced 의 AREA[Phase] 로 간다 — 단일 표현식은 괄호 없이 나간다', () => {
    const { params } = buildSearchParams({ phase: ['phase_2', 'phase_3'] }, opts);
    expect(params['filter.advanced']).toBe('AREA[Phase]PHASE2 OR AREA[Phase]PHASE3');
  });

  it('표현식이 둘 이상이면 각각 괄호로 싸 AND 로 잇는다', () => {
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

  it('--near 만 있고 --radius 가 없으면 기본 반경을 적용하고 경고를 남긴다', () => {
    const { params, warnings } = buildSearchParams({ near: { lat: 37.5665, lon: 126.978 } }, opts);
    expect(params['filter.geo']).toBe('distance(37.5665,126.978,50km)');
    expect(warnings.map((w) => w.code)).toContain('geo_radius_defaulted');
    expect(warnings.find((w) => w.code === 'geo_radius_defaulted')?.message).toContain('50km');
  });

  it('날짜 범위는 AREA[...]RANGE[...] 이고, 누락 시험을 배제한다는 경고를 남긴다', () => {
    const { params, warnings } = buildSearchParams({ updatedSince: '2025-01-01' }, opts);
    expect(params['filter.advanced']).toBe('AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX]');
    expect(warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('양쪽 경계가 있으면 RANGE 의 두 자리를 모두 채우고 경고를 남긴다', () => {
    const { params, warnings } = buildSearchParams({ startAfter: '2024-01-01', startBefore: '2024-12-31' }, opts);
    expect(params['filter.advanced']).toBe('AREA[StartDate]RANGE[2024-01-01, 2024-12-31]');
    expect(warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('completion 날짜 범위도 같은 경고를 남긴다', () => {
    const { params, warnings } = buildSearchParams(
      { completionAfter: '2024-01-01', completionBefore: '2024-12-31' },
      opts,
    );
    expect(params['filter.advanced']).toBe('AREA[PrimaryCompletionDate]RANGE[2024-01-01, 2024-12-31]');
    expect(warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('날짜 형식이 YYYY-MM-DD 가 아니면 exit 2 다', () => {
    try {
      buildSearchParams({ updatedSince: '2025/01/01' }, opts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).hint).toBeDefined();
    }
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

  /**
   * `--raw` 는 설계에 있는 유일한 탈출구다 (스펙 §2.1: 정규화 스키마가 담지 못하는
   * 레지스트리별 값은 `--raw` 의 `source` 로 보존한다). fields 를 실어 보내면 그
   * source 는 정규화기가 이미 요청한 것 이상을 절대 담을 수 없어, 구조적으로 빈
   * 탈출구가 된다 — "레지스트리가 실제로 뭐라고 했는데 스키마가 못 담았나" 라는
   * 질문에 영영 답할 수 없다. 게다가 호출자가 명시적으로 전체를 달라고 한 요청에
   * 대한 무경고 축소라, 경고 없는 축소를 금지하는 이 프로젝트의 규칙 정면 위반이다.
   */
  it('--raw 면 fields 투영을 걸지 않는다 — source 가 진짜 원문이어야 한다', () => {
    const raw = { ...opts, raw: true };
    expect(buildSearchParams({ condition: 'NSCLC' }, raw).params.fields).toBeUndefined();
    expect(buildIdsParams(['NCT01234567'], raw).fields).toBeUndefined();
    // raw 가 아니면 그대로 투영한다 — 기본 경로의 페이로드 절감은 유지된다.
    expect(buildSearchParams({ condition: 'NSCLC' }, opts).params.fields).toBeDefined();
    expect(buildIdsParams(['NCT01234567'], opts).fields).toBeDefined();
  });
});
