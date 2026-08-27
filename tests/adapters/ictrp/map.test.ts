import { describe, expect, it } from 'vitest';
import { mapRecord, mapRow } from '../../../src/adapters/ictrp/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';

const AT = '2026-08-26T00:00:00.000Z';
const row = (over: Partial<Parameters<typeof mapRow>[0]> = {}) => ({
  trialId: 'NCT07749586', statusRaw: 'Recruiting', title: '어떤 시험', registeredOn: '2026-07-17', ...over,
});

describe('ICTRP 행 매핑', () => {
  it('스키마를 만족하는 레코드를 만든다', () => {
    expect(() => TrialRecordSchema.parse(mapRow(row(), AT))).not.toThrow();
  });

  it('ID 는 ICTRP 접두사를 단다 — 원 레지스트리의 것이 아니다', () => {
    const r = mapRow(row(), AT);
    expect(r.id).toBe('ICTRP:NCT07749586');
    expect(r.registry).toBe('ictrp');
    expect(r.registryId).toBe('NCT07749586');
  });

  it('슬래시가 든 ID 도 그대로 담는다', () => {
    expect(mapRow(row({ trialId: 'CTRI/2026/07/113311' }), AT).registryId).toBe('CTRI/2026/07/113311');
  });

  it('Recruiting 은 공통 어휘의 recruiting 이다', () => {
    const r = mapRow(row({ statusRaw: 'Recruiting' }), AT);
    expect(r.status).toBe('recruiting');
    expect(r.statusRaw).toBe('Recruiting');
  });

  /**
   * `Not Recruiting` 은 ICTRP 가 아는 값이지만 완료·중단·모집종료를 한데 묶은 굵은
   * 통이라 여덟 개 중 어느 것과도 같지 않다. `completed` 로 접으면 거짓이 된다.
   * 어휘의 정의대로 `other`(매핑 없음)이고, `unknown`(레지스트리가 모른다)이 아니다.
   */
  it('Not Recruiting 은 other 로 접고 원문을 남긴다', () => {
    const r = mapRow(row({ statusRaw: 'Not Recruiting' }), AT);
    expect(r.status).toBe('other');
    expect(r.statusRaw).toBe('Not Recruiting');
  });

  it('모르는 상태 문자열도 other 로 접고 원문을 남긴다', () => {
    const r = mapRow(row({ statusRaw: '뭔가 새 값' }), AT);
    expect(r.status).toBe('other');
    expect(r.statusRaw).toBe('뭔가 새 값');
  });

  /**
   * 등록일은 **시험의 시작일이 아니다.** `dates.start` 에 넣으면 다른 것을 같은
   * 이름으로 신고하는 것이 된다 — 세 날짜 축을 전부 끈 것과 같은 이유다.
   */
  it('등록일을 dates.start 에 넣지 않는다', () => {
    const r = mapRow(row({ registeredOn: '2026-07-17' }), AT);
    expect(r.dates?.start).toBeUndefined();
  });

  it('URL 은 그 레코드를 실제로 여는 주소다', () => {
    expect(mapRow(row(), AT).url).toBe('https://trialsearch.who.int/Trial2.aspx?TrialID=NCT07749586');
  });

  it('행이 싣지 않는 것은 만들어 내지 않는다', () => {
    const r = mapRow(row(), AT);
    expect(r.conditions).toEqual([]);
    expect(r.phase).toBeUndefined();
    expect(r.enrollment).toBeUndefined();
    // 결과 행에는 수확일이 없다. get 이 열릴 때 채운다.
    expect(r.sourceRefreshedAt).toBeUndefined();
  });
});

/**
 * 레코드 페이지에서 온 것은 결과 행보다 충실하다. 매핑에서 조심할 것 둘:
 *
 * 1. **표본이 다섯 건뿐이다.** 잰 값만 매핑하고 나머지는 원문을 `statusRaw`/`phaseRaw`/
 *    `studyTypeRaw` 에 남긴 채 `other` 로 접는다 — 못 본 값을 추측해 접으면 그 시험이
 *    조용히 다른 것으로 신고된다.
 * 2. **`Pending` 은 공통 어휘에 자리가 없다.** `not_yet_recruiting` 으로 접고 싶어지지만
 *    그 둘이 같다는 근거가 없다(포털이 뜻을 적어 두지 않는다). `other` + 원문이다.
 */
describe('ICTRP 레코드 매핑', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    publicTitle: '어떤 시험', countries: [], conditions: [], interventions: [], ...over,
  }) as Parameters<typeof mapRecord>[0];

  const AT2 = '2026-08-27T00:00:00.000Z';

  it('스키마를 만족하는 레코드를 만든다', () => {
    expect(() => TrialRecordSchema.parse(mapRecord(rec(), 'NCT04280705', AT2, 10))).not.toThrow();
  });

  it('실측한 모집 상태를 공통 어휘로 옮긴다', () => {
    expect(mapRecord(rec({ recruitmentStatus: 'Completed' }), 'X', AT2, 10).status).toBe('completed');
    expect(mapRecord(rec({ recruitmentStatus: 'Recruiting' }), 'X', AT2, 10).status).toBe('recruiting');
    expect(mapRecord(rec({ recruitmentStatus: 'Not yet recruiting' }), 'X', AT2, 10).status)
      .toBe('not_yet_recruiting');
  });

  it('자리가 없는 값은 other 로 접고 원문을 남긴다 — Pending 을 추측하지 않는다', () => {
    const r = mapRecord(rec({ recruitmentStatus: 'Pending' }), 'X', AT2, 10);
    expect(r.status).toBe('other');
    expect(r.statusRaw).toBe('Pending');
  });

  it('단계는 Phase N 과 맨 숫자를 함께 받는다 — 레지스트리마다 표기가 다르다', () => {
    expect(mapRecord(rec({ phase: 'Phase 3' }), 'X', AT2, 10).phase).toEqual(['phase_3']);
    // JPRN 은 맨 숫자로 낸다(실측).
    expect(mapRecord(rec({ phase: '3' }), 'X', AT2, 10).phase).toEqual(['phase_3']);
    // N/A 와 Not Applicable 둘 다 실측됐다.
    expect(mapRecord(rec({ phase: 'N/A' }), 'X', AT2, 10).phase).toEqual(['na']);
    expect(mapRecord(rec({ phase: 'Not Applicable' }), 'X', AT2, 10).phase).toEqual(['na']);
  });

  it('연구 유형을 옮긴다', () => {
    expect(mapRecord(rec({ studyType: 'Interventional' }), 'X', AT2, 10).studyType).toBe('interventional');
    expect(mapRecord(rec({ studyType: 'Observational study' }), 'X', AT2, 10).studyType).toBe('observational');
  });

  /** 약관이 요구하는 처리일. 이 경로에서만 채워진다 — 결과 행에는 없다. */
  it('수확일을 sourceRefreshedAt 에 싣는다 — dates.lastUpdated 가 아니다', () => {
    const r = mapRecord(rec({ lastRefreshedOn: '21 March 2022' }), 'X', AT2, 10);
    expect(r.sourceRefreshedAt).toBe('21 March 2022');
    expect(r.dates?.lastUpdated).toBeUndefined();
  });

  it('시작일은 first enrolment 이고 등록일은 넣지 않는다', () => {
    const r = mapRecord(rec({ firstEnrolment: 'February 21, 2020', dateOfRegistration: '20/02/2020' }), 'X', AT2, 10);
    expect(r.dates?.start).toBe('February 21, 2020');
    // 등록일은 이 스키마의 어느 날짜 축도 아니다.
    expect(JSON.stringify(r)).not.toContain('20/02/2020');
  });

  /**
   * `caps.locations` 는 CLI 가 정하는 정책이고 어댑터는 읽기만 한다(스펙 §5.2).
   * 이 어댑터의 첫 판이 그것을 무시해 계약 스위트에 걸렸다 — 그래서 여기에 핀을 박는다.
   */
  it('캡을 넘기면 그만큼만 담고 진짜 개수는 남긴다', () => {
    const r = mapRecord(rec({ countries: ['A', 'B', 'C'] }), 'X', AT2, 2);
    expect(r.locations?.map((l) => l.country)).toEqual(['A', 'B']);
    expect(r.locationsTotal).toBe(3);
  });

  it('캡 안이면 전부 담고 개수도 맞는다', () => {
    const r = mapRecord(rec({ countries: ['A', 'B'] }), 'X', AT2, 10);
    expect(r.locations).toHaveLength(2);
    expect(r.locationsTotal).toBe(2);
  });

  it('모집 국가를 나라 단위 장소로 싣는다', () => {
    const r = mapRecord(rec({ countries: ['Japan', 'Korea, Republic of'] }), 'X', AT2, 10);
    expect(r.locations?.map((l) => l.country)).toEqual(['Japan', 'Korea, Republic of']);
  });

  it('표본 크기는 target 이다 — actual 이 아니다', () => {
    const r = mapRecord(rec({ targetSampleSize: '1062' }), 'X', AT2, 10);
    expect(r.enrollment).toEqual({ count: 1062, basis: 'estimated' });
  });

  it('숫자가 아닌 표본 크기는 버린다 — 지어내지 않는다', () => {
    expect(mapRecord(rec({ targetSampleSize: '미정' }), 'X', AT2, 10).enrollment).toBeUndefined();
  });
});
