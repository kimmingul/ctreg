import { describe, expect, it } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { assertSupported } from '../../src/cli/guard.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { CAPS, type FetchOpts } from '../../src/core/query.js';
import type { Capability } from '../../src/core/capability.js';
import type { CtregError } from '../../src/runtime/errors.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use', raw: false,
};

const limited: Capability = {
  ...CTGOV_CAPABILITY,
  search: { ...CTGOV_CAPABILITY.search, geo: false, patient: false, dateRange: false },
  detail: { ...CTGOV_CAPABILITY.detail, eligibilityText: false },
};

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
