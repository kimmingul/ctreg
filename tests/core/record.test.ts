import { describe, expect, it } from 'vitest';
import { TrialRecordSchema, TrialResultsSchema } from '../../src/core/record.js';

const minimal = {
  id: 'CTGOV:NCT01234567',
  registry: 'ctgov',
  registryId: 'NCT01234567',
  url: 'https://clinicaltrials.gov/study/NCT01234567',
  title: 'A Study of Something',
  status: 'recruiting',
  conditions: ['Non-Small Cell Lung Cancer'],
  fetchedAt: '2026-08-22T00:00:00.000Z',
};

describe('TrialRecord 계약', () => {
  it('core 필수 필드만으로 유효하다', () => {
    expect(TrialRecordSchema.parse(minimal).id).toBe('CTGOV:NCT01234567');
  });

  it('폐쇄 어휘 밖의 status 는 거부한다', () => {
    expect(() => TrialRecordSchema.parse({ ...minimal, status: 'RECRUITING' })).toThrow();
  });

  it('phase 는 배열이며 결합 값을 쓰지 않는다', () => {
    const r = TrialRecordSchema.parse({ ...minimal, phase: ['phase_1', 'phase_2'] });
    expect(r.phase).toEqual(['phase_1', 'phase_2']);
  });

  it('null 로 채운 필드는 거부한다 — 없으면 생략해야 한다', () => {
    expect(() => TrialRecordSchema.parse({ ...minimal, officialTitle: null })).toThrow();
  });

  it('locationsTotal 은 캡 적용 이전 총 개수를 담는다', () => {
    const r = TrialRecordSchema.parse({
      ...minimal,
      locations: [{ city: 'Seoul', country: 'Korea, Republic of' }],
      locationsTotal: 42,
    });
    expect(r.locationsTotal).toBe(42);
    expect(r.locations).toHaveLength(1);
  });

  it('eligibility 절단은 플래그로 드러난다', () => {
    const r = TrialRecordSchema.parse({
      ...minimal,
      eligibility: { criteriaText: 'Inclusion...', criteriaTruncated: true },
    });
    expect(r.eligibility?.criteriaTruncated).toBe(true);
  });

  it('스키마에 없는 필드는 거부한다 — 오타가 조용히 사라지면 안 된다', () => {
    // locationsTotal 오타(locationTotal)를 흘려보내면, 필드가 optional 이라
    // 그냥 무시되고 "이 시험은 사이트가 없다"로 오독될 수 있다.
    expect(() => TrialRecordSchema.parse({ ...minimal, locationTotal: 42 })).toThrow();
  });

  it('중첩 객체(eligibility)도 오타를 거부한다 — criteriaTruncated 오타는 절단을 숨긴다', () => {
    // criteriaTruncated 를 criteriaTruncatd 로 잘못 쓰면, strict 가 아닌 스키마는
    // 그 필드를 조용히 버리고 나머지를 통과시킨다 — 잘린 criteriaText 가 완전한 것처럼 보인다.
    expect(() =>
      TrialRecordSchema.parse({
        ...minimal,
        eligibility: { criteriaText: 'abc', criteriaTruncatd: true },
      }),
    ).toThrow();
  });

  it('crossIds 는 registry 없이 id 만으로도 유효하다 — type 없는 보조 식별자를 버리지 않는다', () => {
    const r = TrialRecordSchema.parse({ ...minimal, crossIds: [{ id: 'OSU 19016' }] });
    expect(r.crossIds).toEqual([{ id: 'OSU 19016' }]);
  });

  it('crossIds 는 domain 으로 같은 id·다른 기관을 구분한다', () => {
    const r = TrialRecordSchema.parse({
      ...minimal,
      crossIds: [
        { id: '10216', registry: 'OTHER', domain: 'Ohio State University Comprehensive Cancer Center LAO' },
        { id: '10216', registry: 'OTHER', domain: 'CTEP' },
      ],
    });
    expect(r.crossIds?.[0]?.domain).toBe('Ohio State University Comprehensive Cancer Center LAO');
    expect(r.crossIds?.[1]?.domain).toBe('CTEP');
  });

  it('outcomesTotal 은 캡 적용 이전 총 개수를 담는다', () => {
    const r = TrialRecordSchema.parse({
      ...minimal,
      outcomes: [{ type: 'primary', measure: 'X' }],
      outcomesTotal: 25,
    });
    expect(r.outcomesTotal).toBe(25);
    expect(r.outcomes).toHaveLength(1);
  });

  it('eligibility.sexRaw 는 statusRaw 와 같은 규칙으로 원문을 보존한다', () => {
    const r = TrialRecordSchema.parse({ ...minimal, eligibility: { sex: 'unknown', sexRaw: 'SOMETHING_NEW' } });
    expect(r.eligibility?.sex).toBe('unknown');
    expect(r.eligibility?.sexRaw).toBe('SOMETHING_NEW');
  });

  it('중첩 객체(TrialResults.sections.outcomes)도 알 수 없는 필드를 거부한다', () => {
    // 필수 필드(total/expanded/items)는 전부 채우고 오타 필드 하나만 얹는다.
    // strict 가 아니라면 이 요청은 그냥 통과하고 오타 필드는 조용히 사라진다.
    expect(() =>
      TrialResultsSchema.parse({
        id: 'CTGOV:NCT01234567',
        registry: 'ctgov',
        hasResults: true,
        fetchedAt: '2026-08-22T00:00:00.000Z',
        sections: {
          outcomes: {
            total: 1,
            expanded: 1,
            items: [],
            itmes: [], // 오타
          },
        },
      }),
    ).toThrow();
  });
});
