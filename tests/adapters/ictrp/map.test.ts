import { describe, expect, it } from 'vitest';
import { mapRow } from '../../../src/adapters/ictrp/map.js';
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
