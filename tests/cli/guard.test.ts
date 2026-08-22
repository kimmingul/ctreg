import { describe, expect, it } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { assertSupported } from '../../src/cli/guard.js';
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
 * `Capability.search` 의 모든 키(geoNeedsCoords 제외)에 대응하는 최소 프로브.
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
    case 'geoNeedsCoords':
      throw new Error('geoNeedsCoords 는 가드 축이 아니다 — 호출 전에 걸러야 한다');
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

  it('Capability.search 의 모든 검색 축을(geoNeedsCoords 제외) 가드가 개별적으로 다룬다', () => {
    const axes = (Object.keys(CTGOV_CAPABILITY.search) as (keyof Capability['search'])[])
      .filter((k) => k !== 'geoNeedsCoords');
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

  it('좌표를 요구하는 어댑터에 지명을 넘길 수 없다는 사실은 인자 파싱이 이미 막는다', () => {
    expect(CTGOV_CAPABILITY.search.geoNeedsCoords).toBe(true);
  });
});
