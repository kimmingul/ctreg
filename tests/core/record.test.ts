import { describe, expect, it } from 'vitest';
import { TrialRecordSchema } from '../../src/core/record.js';

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
});
