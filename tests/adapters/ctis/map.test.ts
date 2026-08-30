import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CTIS_ATTRIBUTION, mapDetail, mapItem, toPhase } from '../../../src/adapters/ctis/map.js';
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

  /**
   * 코드표를 **절반만** 확정했다(실측): 8→Ended, 11→Not authorised. 2·3·4·5 는 상세의
   * 최상위 상태가 넷을 모두 `Authorised` 로 뭉쳐서 갈리지 않았다. 재지 못한 것을 짐작해
   * 접으면 사용자가 모집 중이 아닌 시험을 모집 중으로 읽는다.
   */
  it('확정된 상태 코드만 접고 나머지는 unknown 이다', () => {
    const ended = mapItem({ ctNumber: 'X', ctTitle: 'T', ctStatus: 8 }, AT);
    expect(ended.status).toBe('completed');
    expect(ended.statusRaw).toBe('Ended');

    const refused = mapItem({ ctNumber: 'X', ctTitle: 'T', ctStatus: 11 }, AT);
    expect(refused.status).toBe('other');
    expect(refused.statusRaw).toBe('Not authorised');

    for (const c of [2, 3, 4, 5]) {
      const r = mapItem({ ctNumber: 'X', ctTitle: 'T', ctStatus: c }, AT);
      expect(r.status, `코드 ${c}`).toBe('unknown');
      // 숫자는 원문이 아니다 — 사람이 읽을 수 없는 값을 statusRaw 에 넣지 않는다.
      expect(r.statusRaw).toBeUndefined();
    }
  });
});

/**
 * 상세 조회(`retrieve/{id}`)는 검색 응답보다 훨씬 두껍고 **구조가 완전히 다르다** —
 * 필드가 `authorizedApplication.authorizedPartI...` 밑에 깊이 들어 있다. 그래서 검색용
 * 매핑을 재활용할 수 없고 따로 읽는다.
 *
 * 무엇이 더 오나(실측 2026-08-30, KCT 아닌 `2022-501417-31-00`):
 * 정식 제목·공개 제목, 구조화된 질환, 의뢰기관 조직명, 참여국(ISO 코드까지),
 * 대상자 수, 그리고 **문자열 상태**(`Not authorised`).
 */
describe('CTIS 상세 매핑', () => {
  const detail = JSON.parse(
    readFileSync(join(__dirname, '../../fixtures/ctis/retrieve.json'), 'utf8'),
  ) as Record<string, unknown>;

  it('계약을 지키는 레코드를 만든다', () => {
    expect(() => TrialRecordSchema.parse(mapDetail(detail, AT))).not.toThrow();
  });

  it('깊이 든 제목을 찾아낸다 — 검색 응답과 자리가 다르다', () => {
    const r = mapDetail(detail, AT);
    expect(r.title).toContain('MK-7648A');
    expect(r.officialTitle).toBeDefined();
  });

  /**
   * **상세에는 문자열 상태가 있다.** 숫자 코드만 오는 검색과 달리, 여기서는 원문을 실을 수
   * 있다 — 코드 2·3·4·5 처럼 우리가 접지 못하는 값도 사용자는 원문으로 읽을 수 있다.
   */
  it('문자열 상태를 원문으로 싣는다', () => {
    const r = mapDetail(detail, AT);
    expect(r.statusRaw).toBe('Not authorised');
    expect(r.status).toBe('other');
  });

  it('구조화된 질환과 의뢰기관을 읽는다', () => {
    const r = mapDetail(detail, AT);
    expect(r.conditions).toContain('High-risk Resected Melanoma');
    expect(r.sponsor?.lead).toContain('Merck');
  });

  it('참여국과 대상자 수를 읽는다', () => {
    const r = mapDetail(detail, AT);
    expect((r.locations ?? []).length).toBeGreaterThan(0);
    expect(r.enrollment?.count).toBe(1296);
  });

  it('출처 표시는 상세에서도 붙는다 — 약관이 each copy 를 요구한다', () => {
    expect(mapDetail(detail, AT).attribution).toBe(CTIS_ATTRIBUTION);
  });
});
