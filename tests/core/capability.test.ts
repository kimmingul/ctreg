import { describe, expect, it } from 'vitest';
import { CapabilitySchema } from '../../src/core/capability.js';

const cap = {
  key: 'ctgov',
  name: 'ClinicalTrials.gov',
  region: 'US / global',
  search: {
    condition: true, intervention: true, term: true, title: true,
    sponsor: true, lead: true, location: true, id: true, patient: true,
    outcomeQuery: true,
    geo: true,
    status: true, phase: true, studyType: true, dateRange: true,
  },
  detail: { eligibilityText: true, outcomes: true, contacts: true },
  results: true,
  count: true,
  limits: { maxPageSize: 200, ratePerSec: 1, maxBatchIds: 50 },
};

describe('Capability 계약', () => {
  it('완전한 선언을 받는다', () => {
    expect(CapabilitySchema.parse(cap).key).toBe('ctgov');
  });

  it('search 축을 하나라도 빠뜨리면 거부한다 — 미신고는 곧 미지원 판단 불가', () => {
    const { geo: _drop, ...rest } = cap.search;
    expect(() => CapabilitySchema.parse({ ...cap, search: rest })).toThrow();
  });

  it('등록되지 않은 레지스트리 키는 거부한다', () => {
    expect(() => CapabilitySchema.parse({ ...cap, key: 'ictrp' })).toThrow();
  });
});
