import { describe, expect, it } from 'vitest';
import { mapItem } from '../../../src/adapters/cris/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';

const AT = '2026-08-28T00:00:00.000Z';

/** 실제 응답에서 가져온 항목(2026-08-28). 손으로 지어낸 것이 아니다. */
const REAL = {
  trial_id: 'KCT0012458',
  date_updated: '2026-08-11',
  date_registration: '2026-08-14',
  source_name_kr: '(주)아이센스',
  i_freetext_kr: '의료기구행동요인',
  study_type_kr: '중재연구',
  date_enrolment: '2026-06-26',
  results_type_date_completed_kr: '예정',
  type_enrolment_kr: '실제등록',
  results_date_completed: '2027-04-30',
  primary_sponsor_kr: '중앙대학교 광명병원',
  scientific_title_kr: '전당뇨 또는 약물치료 경험이 없는 제2형 당뇨병 환자에서 간헐적 실시간 연속혈당측정의 유효성 평가',
  scientific_title_en: 'Efficacy of intermittent use of Real-Time Continuous Glucose Monitoring',
  primary_outcome_1_kr: '기저 시점 대비 12–14주 시점의 목표 범위 내 시간 비율의 변화',
  phase_kr: '해당사항없음',
};

describe('CRIS 레코드 매핑', () => {
  it('계약을 지키는 레코드를 만든다', () => {
    expect(() => TrialRecordSchema.parse(mapItem(REAL, AT))).not.toThrow();
  });

  /**
   * **`unknown` 은 지어낸 값이 아니라 사실이다.** 공식 목록 API 16항목에 모집상태가 없다.
   * 공통 어휘의 `unknown` 이 뜻하는 "레지스트리가 모른다" 가 정확히 이 상태이고,
   * `other`(매핑이 없다)와 다르다. 원문이 없으므로 statusRaw 도 없어야 한다.
   */
  it('모집상태를 모른다고 신고한다 — 지어내지 않는다', () => {
    const r = mapItem(REAL, AT);
    expect(r.status).toBe('unknown');
    expect(r.statusRaw).toBeUndefined();
  });

  /**
   * 실측: CRIS 제목 안에 줄바꿈이 들어 있다("면역 항암\n화학요법"). 제목은 한 줄짜리
   * 값이라 그대로 내보내면 text 출력이 어긋나고 ndjson 소비자가 한 레코드를 두 줄로 본다.
   */
  it('제목 안의 줄바꿈을 접는다', () => {
    const r = mapItem({ ...REAL, scientific_title_kr: '면역 항암\n화학요법과  혈당' }, AT);
    expect(r.title).toBe('면역 항암 화학요법과 혈당');
  });

  it('없는 것을 지어내지 않는다 — 질환·연락처·결과는 비어 있다', () => {
    const r = mapItem(REAL, AT);
    expect(r.conditions).toEqual([]);
    expect(r.eligibility).toBeUndefined();
    expect(r.outcomes).toBeUndefined();
    expect(r.locations).toBeUndefined();
  });

  it('빈 날짜 문자열을 날짜로 싣지 않는다', () => {
    const r = mapItem({ ...REAL, results_date_completed: '', date_enrolment: '기타' }, AT);
    expect(r.dates?.completion).toBeUndefined();
    expect(r.dates?.start).toBeUndefined();
    expect(r.dates?.firstPosted).toBe('2026-08-14');
  });

  it('모르는 어휘 값은 other 로 신고하고 원문을 함께 싣는다', () => {
    const r = mapItem({ ...REAL, study_type_kr: '처음보는연구종류' }, AT);
    expect(r.studyType).toBe('other');
    expect(r.studyTypeRaw).toBe('처음보는연구종류');
  });
});
