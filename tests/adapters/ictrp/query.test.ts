import { describe, expect, it } from 'vitest';
import { buildForm, ICTRP_FILTERABLE } from '../../../src/adapters/ictrp/query.js';
import { FIELD } from '../../../src/adapters/ictrp/form.js';

describe('ICTRP 질의 조립', () => {
  /**
   * **이 저장소에서 가장 중요한 한 줄이다.** `ddlRecruitingStatus` 에는 selected 속성이
   * 없어 기본 선택이 첫 항목(`1` = Recruiting)이고, 필드를 안 보내면 서버가 그것을
   * 쓴다. 실측: diabetes 가 6,844(모집중만) vs 36,264(ALL). 명시하지 않으면 모든
   * 질의가 조용히 좁혀지고 경고도 안 붙는다.
   */
  it('상태를 안 걸면 ALL 을 명시한다 — 안 보내면 모집중만 나온다', () => {
    const f = buildForm({ condition: 'diabetes' }, 20);
    expect(f[FIELD.status]).toBe('ALL');
  });

  it('--status recruiting 이면 1 을 보낸다', () => {
    const f = buildForm({ condition: 'diabetes', status: ['recruiting'] }, 20);
    expect(f[FIELD.status]).toBe('1');
  });

  it('자유 텍스트 축을 제자리에 넣는다', () => {
    const f = buildForm(
      { condition: 'c', intervention: 'i', title: 't', lead: 's', id: 'x', location: 'Korea' },
      20,
    );
    expect(f[FIELD.condition]).toBe('c');
    expect(f[FIELD.intervention]).toBe('i');
    expect(f[FIELD.title]).toBe('t');
    expect(f[FIELD.sponsor]).toBe('s');
    expect(f[FIELD.secondaryId]).toBe('x');
    expect(f[FIELD.country]).toBe('Korea');
  });

  it('쓰지 않은 축은 키를 만들지 않는다 — 빈 문자열도 서버에는 입력이다', () => {
    const f = buildForm({ condition: 'c' }, 20);
    expect(FIELD.title in f).toBe(false);
    expect(FIELD.intervention in f).toBe(false);
  });

  it('phase 를 ICTRP 값으로 옮긴다', () => {
    expect(buildForm({ phase: ['phase_3'] }, 20)[FIELD.phase]).toBe('Phase 3');
    // Phase 0 은 CT.gov 의 Early Phase 1 에 해당한다.
    expect(buildForm({ phase: ['early_phase_1'] }, 20)[FIELD.phase]).toBe('Phase 0');
  });

  /**
   * **페이지 크기를 검색 POST 에 실으면 안 된다(실측 2026-08-26).** `ddlPageSize` 는 결과
   * 페이지에만 렌더되므로, 그 이름을 검색 POST 에 담으면 ASP.NET 이 `__EVENTVALIDATION`
   * 으로 POST 를 거절해 **결과가 0건**이 된다(안 보내면 10행, 50/100 을 보내면 0행).
   * 조용히 틀린 답이 나가는 자리라 이 검사가 그것을 막는다.
   */
  it('페이지 크기를 검색 POST 에 싣지 않는다 — 실으면 결과가 0건이 된다', () => {
    expect(FIELD.pageSize in buildForm({ condition: 'c' }, 100)).toBe(false);
  });

  it('검색 버튼 이름을 함께 보낸다 — 없으면 서버가 검색으로 보지 않는다', () => {
    expect(buildForm({ condition: 'c' }, 20)[FIELD.search]).toBe('Search');
  });

  /** 신고하는 값은 CLI 가 받는 값이어야 한다. 계약 스위트도 같은 것을 검사한다. */
  it('신고 어휘는 na 를 담지 않는다 — ICTRP 목록에 자리가 없다', () => {
    expect(ICTRP_FILTERABLE.phase).not.toContain('na');
    expect(ICTRP_FILTERABLE.status).toEqual(['recruiting']);
    expect(ICTRP_FILTERABLE.studyType).toEqual([]);
  });
});
