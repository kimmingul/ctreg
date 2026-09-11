import { describe, expect, it } from 'vitest';
import { aggregateRecords } from '../../src/core/aggregate.js';
import type { TrialRecord } from '../../src/core/record.js';

const rec = (id: string, over: Partial<TrialRecord> = {}): TrialRecord => ({
  id: `CTGOV:${id}`, registry: 'ctgov', registryId: id, url: '', title: 't', status: 'completed', phase: [], studyType: 'interventional',
  conditions: [], fetchedAt: '2026-01-01T00:00:00Z', ...over,
} as TrialRecord);

/**
 * 레코드 집계 — 집계 API 가 없는 레지스트리(ctgov 등)를 위해 **검색 결과를 받아 서버가 센다.**
 * 사본이 SQL 로 하는 것과 같은 축, 같은 결과 모양. 차이는 상한이다: 레코드를 다 받아야 하므로
 * 모수가 크면 잘리고, 그것을 provenance 로 말한다. 정규화 마스터가 없으므로 이름은 원문(공백·대소문자만
 * 정리)이다 — 의뢰사 "Pfizer" 와 "Pfizer Inc." 는 갈린다.
 */
describe('aggregateRecords', () => {
  const rs = [
    rec('1', { sponsor: { lead: 'Pfizer' }, conditions: ['Diabetes Mellitus, Type 2'], interventions: [{ type: 'Drug', name: 'Metformin' }], dates: { start: '2021-03-01' }, locations: [{ facility: 'Seoul Nat Univ Hosp', country: 'Korea' }], contacts: [{ name: 'A Kim', role: 'PRINCIPAL_INVESTIGATOR' }] }),
    rec('2', { sponsor: { lead: 'pfizer ' }, conditions: ['Diabetes Mellitus, Type 2', 'Obesity'], interventions: [{ type: 'Drug', name: 'metformin' }, { type: 'Drug', name: 'Empagliflozin' }], dates: { start: '2021-11-01' }, locations: [{ facility: 'Seoul Nat Univ Hosp', country: 'Korea' }, { facility: 'Asan', country: 'Korea' }] }),
    rec('3', { sponsor: { lead: 'Novo Nordisk' }, conditions: ['Obesity'], interventions: [{ type: 'Biological', name: 'Semaglutide' }], dates: { start: '2022-01-01' }, contacts: [{ name: 'B Lee', role: 'CONTACT' }, { name: 'A Kim', role: 'PRINCIPAL_INVESTIGATOR' }] }),
  ];

  it('의뢰사 — 공백·대소문자만 정리해 묶는다, 건수순', () => {
    const r = aggregateRecords(rs, 'sponsor');
    expect(r.items.map((x) => [x.name, x.trials])).toEqual([['Pfizer', 2], ['Novo Nordisk', 1]]);
    expect(r.matched).toBe(3);
  });
  it('질환·의약품 — 한 시험이 여럿에 속하면 각각 센다', () => {
    expect(aggregateRecords(rs, 'condition').items.map((x) => [x.name, x.trials])).toEqual([['Diabetes Mellitus, Type 2', 2], ['Obesity', 2]]);
    const d = aggregateRecords(rs, 'drug');
    expect(d.items[0]).toMatchObject({ name: 'Metformin', trials: 2 });
    expect(d.items.map((x) => x.name)).toContain('Semaglutide');
  });
  it('중재 종류·연도·실시기관·연구책임자', () => {
    expect(aggregateRecords(rs, 'intervention_type').items.map((x) => [x.name, x.trials])).toEqual([['Drug', 2], ['Biological', 1]]);
    expect(aggregateRecords(rs, 'year').items.map((x) => [x.name, x.trials])).toEqual([['2021', 2], ['2022', 1]]);
    expect(aggregateRecords(rs, 'site').items[0]).toMatchObject({ name: 'Seoul Nat Univ Hosp', trials: 2 });
    // 연구책임자만 — CONTACT 역할은 세지 않는다
    expect(aggregateRecords(rs, 'investigator').items).toEqual([expect.objectContaining({ name: 'A Kim', trials: 2 })]);
  });
  it('limit 을 지키고 provenance 가 원문 기준임을 말한다', () => {
    const r = aggregateRecords(rs, 'condition', 1);
    expect(r.items).toHaveLength(1);
    expect(r.provenance).toMatch(/원문|정규화 마스터 없음/);
    expect(r.mapped).toBe(0);
  });
});
