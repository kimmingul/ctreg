import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRIS_PI_ROLE, mapDetail, mapItem } from '../../../src/adapters/cris/map.js';
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

/**
 * 상세 조회는 목록과 **다른 것을 내준다** — 연구책임자 성명, 모집현황, 목표대상자 수,
 * 참여기관, 결과변수까지. `get` 이 이것을 쓰는 이유이고, `search`(목록)와 `get`(상세)의
 * 레코드가 다른 이유이기도 하다.
 */
describe('CRIS 상세 매핑', () => {
  const detail = JSON.parse(
    readFileSync(join(__dirname, '../../fixtures/cris/detail.json'), 'utf8'),
  ) as Record<string, unknown>;

  it('계약을 지키는 레코드를 만든다', () => {
    expect(() => TrialRecordSchema.parse(mapDetail(detail, AT))).not.toThrow();
  });

  /**
   * **목록에서는 모를 수밖에 없던 것을 상세에서는 안다.** 목록 레코드의 `unknown` 은
   * 사실이었고, 상세 레코드에서까지 `unknown` 이면 그건 우리가 안 읽은 것이다.
   */
  it('모집현황을 실제로 읽는다', () => {
    const r = mapDetail(detail, AT);
    expect(r.status).toBe('completed');
    expect(r.statusRaw).toBe('연구종결');
  });

  /**
   * **같은 필드인데 오퍼레이션마다 구분자가 다르다**(실측 2026-08-28):
   * 상세 `2011/07/18`, 목록 `2011-07-18`. 목록 기준으로만 검사하면 상세의 날짜가
   * 통째로 사라진다 — 조용히 빈 필드가 되는 부류다.
   */
  it('슬래시로 오는 날짜도 읽는다', () => {
    const r = mapDetail(detail, AT);
    expect(r.dates?.firstPosted).toBe('2011-07-18');
    expect(r.dates?.lastUpdated).toBe('2013-12-04');
    expect(r.dates?.start).toBe('2011-08-03');
  });

  /**
   * 역할 문자열은 **만드는 쪽(map)과 대조하는 쪽(adapter)이 같은 상수를 봐야** 한다.
   * 갈리면 `--investigator` 가 조용히 아무것도 못 거른다 — 사보타주로 확인했다:
   * 문자열 하나만 바꿔도 스위트가 통과했다.
   */
  it('연구책임자 연락처에 약속된 역할 이름을 붙인다', () => {
    const pi = (mapDetail(detail, AT).contacts ?? []).filter((c) => c.role === CRIS_PI_ROLE);
    expect(pi.map((c) => c.name)).toContain('김민걸');
    // 실무담당자는 그 역할이 아니다 — 이것이 갈리는 지점이다.
    const others = (mapDetail(detail, AT).contacts ?? []).filter((c) => c.role !== CRIS_PI_ROLE);
    expect(others.map((c) => c.name)).toContain('한수미');
  });

  it('연구책임자와 기관을 싣는다', () => {
    const r = mapDetail(detail, AT);
    expect(JSON.stringify(r)).toContain('김민걸');
    expect(r.sponsor?.lead).toBe('동화약품(주)');
  });

  it('목표대상자 수를 싣는다', () => {
    // 실측: target_size 12, type_enrolment_kr '실제등록'. 스키마의 어휘는 actual 이다.
    expect(mapDetail(detail, AT).enrollment).toEqual({ count: 12, basis: 'actual' });
  });
});
