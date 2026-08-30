import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CTIS_ATTRIBUTION, mapItem, toPhase } from '../../../src/adapters/ctis/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';

const AT = '2026-08-30T00:00:00.000Z';
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/ctis/search.json'), 'utf8'),
) as { data: Record<string, unknown>[] };
const items = fixture.data;

describe('CTIS 레코드 매핑', () => {
  it('계약을 지키는 레코드를 만든다', () => {
    for (const it of items) expect(() => TrialRecordSchema.parse(mapItem(it, AT))).not.toThrow();
  });

  /**
   * **약관이 요구하는 것이다.** EMA 법적 고지: *"EMA is always acknowledged as the source
   * of the material. Such acknowledgement must be included in **each copy** of the material."*
   *
   * 봉투 한 곳에만 적으면 레코드를 하나씩 꺼내 쓰는 소비자에게 표시가 따라가지 않는다.
   * 사보타주로 확인했다: 이 줄을 지워도 스위트가 통과했다 — 약관 위반이 무방비였다.
   */
  it('레코드마다 EMA 출처 표시를 싣는다', () => {
    for (const it of items) {
      const r = mapItem(it, AT);
      expect(r.attribution).toBe(CTIS_ATTRIBUTION);
      expect(r.attribution).toContain('EMA');
    }
  });

  /**
   * 상 문자열이 `Human Pharmacology (Phase I)-  Other` 처럼 결합·자유 형식이라 낱말로 찾는다.
   * 모르는 값을 아는 값으로 접으면 조용히 틀린 상이 된다.
   */
  it('상을 낱말로 읽고, 모르면 other 로 신고한다', () => {
    expect(toPhase('Human Pharmacology (Phase I)-  Other')).toEqual(['phase_1']);
    expect(toPhase('Therapeutic confirmatory  (Phase III)')).toEqual(['phase_3']);
    expect(toPhase('처음 보는 표기')).toEqual(['other']);
    expect(toPhase(undefined)).toBeUndefined();
  });

  /** `"Spain:11"` 처럼 나라와 기관 수가 붙어 온다(실측). 수까지 나라 이름에 섞이면 안 된다. */
  it('참여국에서 나라 이름만 뽑는다', () => {
    const r = mapItem({ ctNumber: 'X', ctTitle: 'T', trialCountries: ['Spain:11', 'Hungary:4'] }, AT);
    expect(r.locations).toEqual([{ country: 'Spain' }, { country: 'Hungary' }]);
    expect(r.locationsTotal).toBe(2);
  });

  it('캡을 넘으면 자르되 전체 수는 남긴다', () => {
    const r = mapItem({ ctNumber: 'X', ctTitle: 'T', trialCountries: ['A:1', 'B:2', 'C:3'] }, AT, 2);
    expect(r.locations).toHaveLength(2);
    expect(r.locationsTotal).toBe(3);
  });

  /** `07/05/2024` 는 dd/mm/yyyy 다(실측). 월·일을 뒤집으면 조용히 다른 날이 된다. */
  it('dd/mm/yyyy 날짜를 뒤집지 않는다', () => {
    const r = mapItem({ ctNumber: 'X', ctTitle: 'T', decisionDateOverall: '07/05/2024' }, AT);
    expect(r.dates?.start).toBe('2024-05-07');
  });

  it('상태를 지어내지 않는다 — 코드표를 재지 못했다', () => {
    expect(mapItem({ ctNumber: 'X', ctTitle: 'T', ctStatus: 11 }, AT).status).toBe('unknown');
  });
});
