import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapStudy, haversineKm } from '../../../src/adapters/ctgov/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';

const fixture = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov', `${n}.json`), 'utf8'));

const opts = (over: Partial<FetchOpts> = {}): FetchOpts => ({
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
  ...over,
});

const AT = '2026-08-22T00:00:00.000Z';

describe('CT.gov → TrialRecord 매핑', () => {
  it('실제 응답이 계약 스키마를 통과한다', () => {
    const { record } = mapStudy(fixture('study-full'), opts(), AT);
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
    expect(record.registry).toBe('ctgov');
    expect(record.id).toMatch(/^CTGOV:NCT\d{8}$/);
    expect(record.url).toContain(record.registryId);
  });

  it('검색 페이지의 모든 항목이 계약을 통과한다', () => {
    const page = fixture('search-page') as { studies: unknown[] };
    for (const s of page.studies) {
      expect(() => TrialRecordSchema.parse(mapStudy(s, opts(), AT).record)).not.toThrow();
    }
  });

  it('희소 응답에서 없는 필드는 생략한다 — null 이나 빈 값으로 채우지 않는다', () => {
    const { record } = mapStudy(fixture('study-sparse'), opts(), AT);
    expect(record.title).toBe('Sparse Study');
    expect(record.status).toBe('unknown');
    expect(record).not.toHaveProperty('statusRaw');
    expect(record.sponsor).toBeUndefined();
    expect(record.dates).toBeUndefined();
    expect(record.phase).toBeUndefined();
    expect(record.enrollment).toBeUndefined();
    expect(record.locations).toBeUndefined();
    expect(record.locationsTotal).toBeUndefined();
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  it('장소는 캡을 넘으면 잘리되 총 개수와 경고를 남긴다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000002', briefTitle: 'Many Sites' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const { record, warnings } = mapStudy(many, opts(), AT);
    expect(record.locations).toHaveLength(CAPS.locations.default);
    expect(record.locationsTotal).toBe(37);
    expect(warnings.map((w) => w.code)).toContain('locations_truncated');
  });

  it('--include locations 이면 캡이 최대치로 늘어난다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000009', briefTitle: 'Many Sites 2' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const { record, warnings } = mapStudy(many, opts({ include: ['core', 'locations'] }), AT);
    expect(record.locations).toHaveLength(37);
    expect(record.locationsTotal).toBe(37);
    expect(warnings.map((w) => w.code)).not.toContain('locations_truncated');
  });

  it('--include eligibility 없이는 적격 기준문을 담지 않는다', () => {
    const withElig = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000003', briefTitle: 'E' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'Inclusion Criteria: ...', minimumAge: '18 Years', sex: 'ALL' },
      },
    };
    expect(mapStudy(withElig, opts(), AT).record.eligibility).toBeUndefined();
    const on = mapStudy(withElig, opts({ include: ['core', 'eligibility'] }), AT).record;
    expect(on.eligibility?.criteriaText).toContain('Inclusion Criteria');
    expect(on.eligibility?.minAge).toBe('18 Years');
    expect(on.eligibility?.sex).toBe('all');
  });

  it('적격 기준문이 캡을 넘으면 자르고 플래그와 경고를 남긴다', () => {
    const long = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000004', briefTitle: 'L' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'x'.repeat(20000) },
      },
    };
    const o = opts({ include: ['core', 'eligibility'], caps: { locations: 10, eligibilityChars: 100, outcomes: 20 } });
    const { record, warnings } = mapStudy(long, o, AT);
    expect(record.eligibility?.criteriaText).toHaveLength(100);
    expect(record.eligibility?.criteriaTruncated).toBe(true);
    expect(warnings.map((w) => w.code)).toContain('eligibility_truncated');
  });

  it('--include outcomes 없이는 결과 지표를 담지 않고, 있으면 캡이 최대치로 늘어난다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000008', briefTitle: 'O' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        outcomesModule: {
          primaryOutcomes: Array.from({ length: 25 }, (_, i) => ({ measure: `Outcome ${i}` })),
        },
      },
    };
    expect(mapStudy(many, opts(), AT).record.outcomes).toBeUndefined();
    const { record, warnings } = mapStudy(many, opts({ include: ['core', 'outcomes'] }), AT);
    expect(record.outcomes).toHaveLength(25);
    expect(warnings.map((w) => w.code)).not.toContain('outcomes_truncated');
  });

  it('--near 가 있으면 각 장소에 거리를 붙이고 가까운 순으로 정렬한다', () => {
    const geo = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000005', briefTitle: 'G' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: [
            { city: 'Busan', geoPoint: { lat: 35.1796, lon: 129.0756 } },
            { city: 'Seoul', geoPoint: { lat: 37.5665, lon: 126.978 } },
          ],
        },
      },
    };
    const { record } = mapStudy(geo, { ...opts(), near: { lat: 37.5665, lon: 126.978 } }, AT);
    expect(record.locations?.[0]?.city).toBe('Seoul');
    expect(record.locations?.[0]?.distanceKm).toBeCloseTo(0, 1);
    expect(record.locations?.[1]?.distanceKm).toBeGreaterThan(300);
  });

  it('--raw 일 때만 원문을 동봉한다', () => {
    const s = fixture('study-sparse');
    expect(mapStudy(s, opts(), AT).record.source).toBeUndefined();
    expect(mapStudy(s, opts({ raw: true }), AT).record.source).toEqual(s);
  });

  it('haversineKm 은 서울–부산을 약 325km 로 계산한다', () => {
    const d = haversineKm({ lat: 37.5665, lon: 126.978 }, { lat: 35.1796, lon: 129.0756 });
    expect(d).toBeGreaterThan(310);
    expect(d).toBeLessThan(340);
  });
});
