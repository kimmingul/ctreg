import { describe, expect, it } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { applyLimits, assertSupported } from '../../src/cli/guard.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../src/core/query.js';
import type { Capability } from '../../src/core/capability.js';
import type { CtregError } from '../../src/runtime/errors.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use', raw: false,
};

const limited: Capability = {
  ...CTGOV_CAPABILITY,
  search: { ...CTGOV_CAPABILITY.search, geo: false, patient: false, dateRange: false, outcomeQuery: false },
  detail: { ...CTGOV_CAPABILITY.detail, eligibilityText: false },
};

/**
 * `Capability.search` 의 모든 키에 대응하는 최소 프로브.
 * `never` 소진 검사 덕분에, 스키마에 축이 추가되고 이 스위치가 갱신되지 않으면
 * `bunx tsc --noEmit` 단계에서 즉시 컴파일 에러가 난다 — 리뷰어가 눈치채길 기다리지 않는다.
 */
function probeFor(axis: keyof Capability['search']): NormalizedQuery {
  switch (axis) {
    case 'condition': return { condition: 'x' };
    case 'intervention': return { intervention: 'x' };
    case 'term': return { term: 'x' };
    case 'title': return { title: 'x' };
    case 'location': return { location: 'x' };
    case 'sponsor': return { sponsor: 'x' };
    case 'lead': return { lead: 'x' };
    case 'id': return { id: 'x' };
    case 'patient': return { patient: 'x' };
    case 'outcomeQuery': return { outcomeQuery: 'x' };
    case 'status': return { status: ['recruiting'] };
    case 'phase': return { phase: ['phase_1'] };
    case 'studyType': return { studyType: 'interventional' };
    case 'geo': return { near: { lat: 0, lon: 0 } };
    case 'dateRange': return { updatedSince: '2025-01-01' };
    default: {
      const exhaustive: never = axis;
      throw new Error(`'${exhaustive}' 축의 프로브가 guard.test.ts 에 없다 — probeFor 에 추가하라`);
    }
  }
}

const expectUnsupported = (fn: () => unknown, fragment: string) => {
  try {
    fn();
    expect.unreachable('던져야 한다');
  } catch (e) {
    expect((e as CtregError).exit).toBe(EXIT.UNSUPPORTED);
    expect((e as CtregError).message).toContain(fragment);
  }
};

describe('capability 가드', () => {
  it('지원되는 축은 통과시킨다', () => {
    expect(() => assertSupported(CTGOV_CAPABILITY, { condition: 'NSCLC', patient: 'x' }, fetchOpts)).not.toThrow();
  });

  it('미지원 검색 축은 빈 결과가 아니라 exit 3 이다', () => {
    expectUnsupported(() => assertSupported(limited, { patient: '62 year old' }, fetchOpts), 'patient');
    expectUnsupported(() => assertSupported(limited, { near: { lat: 37, lon: 127 } }, fetchOpts), 'geo');
    expectUnsupported(() => assertSupported(limited, { updatedSince: '2025-01-01' }, fetchOpts), 'dateRange');
    expectUnsupported(() => assertSupported(limited, { outcomeQuery: 'PFS' }, fetchOpts), 'outcomeQuery');
  });

  it('Capability.search 의 모든 검색 축을 가드가 개별적으로 다룬다', () => {
    const axes = Object.keys(CTGOV_CAPABILITY.search) as (keyof Capability['search'])[];
    for (const axis of axes) {
      const capOff: Capability = { ...CTGOV_CAPABILITY, search: { ...CTGOV_CAPABILITY.search, [axis]: false } };
      expectUnsupported(() => assertSupported(capOff, probeFor(axis), fetchOpts), axis);
    }
  });

  it('미지원 detail 섹션도 exit 3 이다', () => {
    expectUnsupported(
      () => assertSupported(limited, {}, { ...fetchOpts, include: ['core', 'eligibility'] }),
      'eligibilityText',
    );
  });

  // `search.geoNeedsCoords` 는 capability 선언에서 지웠다(core/capability.ts) — 좌표를
  // 요구하는 것은 이미 args.ts 의 `--near` 파싱이 무조건 막고(tests/cli/args.test.ts),
  // 좌표 없이 지명을 받는 레지스트리가 아직 없어 가드가 따로 소비할 대상이 없었다.
  // 그런 레지스트리가 생기면 여기서도 되살린다 — docs/slice-2-prerequisites.md 참고.
});

describe('레지스트리별 페이지 크기 상한', () => {
  it('상한 이하면 그대로 통과시키고 경고를 남기지 않는다', () => {
    const r = applyLimits(CTGOV_CAPABILITY, { pageSize: CTGOV_CAPABILITY.limits.maxPageSize });
    expect(r.query.pageSize).toBe(CTGOV_CAPABILITY.limits.maxPageSize);
    expect(r.warnings).toEqual([]);
  });

  it('pageSize 를 아예 안 줬으면 손대지 않는다', () => {
    const r = applyLimits(CTGOV_CAPABILITY, { condition: 'x' });
    expect(r.query.pageSize).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('상한을 넘으면 exit 2/3 이 아니라 조용히 낮추고 page_size_clamped 경고를 남긴다', () => {
    const strict: Capability = { ...CTGOV_CAPABILITY, limits: { ...CTGOV_CAPABILITY.limits, maxPageSize: 50 } };
    const r = applyLimits(strict, { condition: 'x', pageSize: 200 });
    expect(r.query.pageSize).toBe(50);
    expect(r.query.condition).toBe('x'); // 나머지 쿼리는 그대로 보존된다
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: 'page_size_clamped', at: 50, registry: 'ctgov' }),
    ]);
  });

  it('원본 쿼리 객체를 mutate 하지 않는다 — 연합 조회에서 다음 레지스트리가 낮아진 값을 물려받으면 안 된다', () => {
    const strict: Capability = { ...CTGOV_CAPABILITY, limits: { ...CTGOV_CAPABILITY.limits, maxPageSize: 50 } };
    const original: NormalizedQuery = { pageSize: 200 };
    const r = applyLimits(strict, original);
    expect(original.pageSize).toBe(200);
    expect(r.query).not.toBe(original);
  });
});
