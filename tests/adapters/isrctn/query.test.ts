import { describe, expect, it } from 'vitest';
import { buildIdsQuery, buildQuery } from '../../../src/adapters/isrctn/query.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';
import type { NormalizedQuery } from '../../../src/core/query.js';

const q = (over: NormalizedQuery = {}) => buildQuery(over).q;

const expectUsage = (fn: () => unknown, fragment: string) => {
  try {
    fn();
    expect.unreachable('던져야 한다');
  } catch (e) {
    expect((e as CtregError).exit).toBe(EXIT.USAGE);
    expect((e as CtregError).message).toContain(fragment);
  }
};

describe('ISRCTN 질의 조립', () => {
  it('축마다 실측으로 확인된 필드명을 쓴다', () => {
    expect(q({ condition: 'diabetes' })).toBe('condition:"diabetes"');
    expect(q({ intervention: 'aspirin' })).toBe('intervention:"aspirin"');
    expect(q({ title: 'covid' })).toBe('title:"covid"');
    expect(q({ sponsor: 'University of Oxford' })).toBe('sponsorOrganisation:"University of Oxford"');
    expect(q({ outcomeQuery: 'mortality' })).toBe('outcomeMeasures:"mortality"');
    expect(q({ studyType: 'interventional' })).toBe('primaryStudyDesign:"Interventional"');
  });

  /**
   * 값을 항상 따옴표로 싼다. 공백이 있으면 필수이고(`condition:lung cancer` 는 277건,
   * `condition:"lung cancer"` 는 203건 — 앞의 것은 `condition:lung` 과 자유텍스트
   * `cancer` 로 쪼개진다), 없어도 결과가 같다(`condition:diabetes` = `condition:"diabetes"`
   * = 1118). 조건부로 감싸면 "공백이 있을 때만" 이라는 규칙을 지키는지 매번 확인해야
   * 하는데, 어기면 오류가 아니라 **다른 답** 이 나온다.
   */
  it('값은 공백 유무와 무관하게 항상 따옴표로 싼다', () => {
    expect(q({ condition: 'lung cancer' })).toBe('condition:"lung cancer"');
    expect(q({ term: 'diabetes' })).toBe('"diabetes"');
  });

  it('자유 텍스트는 필드명 없이 나간다', () => {
    expect(q({ term: 'bill and melinda gates' })).toBe('"bill and melinda gates"');
  });

  it('여러 축은 AND 로 잇는다', () => {
    expect(q({ condition: 'cancer', intervention: 'aspirin' })).toBe(
      'condition:"cancer" AND intervention:"aspirin"',
    );
  });

  /**
   * 단계 여러 개는 OR 인데, **괄호가 없으면 답이 달라진다**:
   * `condition:"cancer" AND phase:"Phase II" OR phase:"Phase III"` 는 1291건이고
   * 괄호를 씌운 것은 692건이다. 오류가 아니라 조용히 다른 결과라 눈으로는 안 걸린다.
   */
  it('단계 여러 개는 괄호로 묶어 OR 한다 — 괄호가 없으면 우선순위가 달라진다', () => {
    expect(q({ phase: ['phase_2', 'phase_3'] })).toBe('(phase:"Phase II" OR phase:"Phase III")');
    expect(q({ condition: 'cancer', phase: ['phase_2', 'phase_3'] })).toBe(
      'condition:"cancer" AND (phase:"Phase II" OR phase:"Phase III")',
    );
  });

  it('단계가 하나면 괄호를 씌우지 않는다', () => {
    expect(q({ phase: ['phase_3'] })).toBe('phase:"Phase III"');
  });

  /** ISRCTN 의 phase 어휘에 early phase 1 에 해당하는 값이 없다(문서 3.2.1.12). */
  it('ISRCTN 어휘에 없는 단계는 조용히 빠지지 않고 exit 2 다', () => {
    expectUsage(() => buildQuery({ phase: ['early_phase_1'] }), 'early_phase_1');
  });

  /**
   * 날짜는 콜론이 아니라 **공백** 이고 시각까지 필요하다. `overallEndDate:GE 2020-01-01`
   * 은 0건, `overallEndDate GE 2020-01-01T00:00:00` 은 11429건이다.
   */
  it('날짜는 콜론이 아니라 공백에 비교 연산자, 그리고 시각까지 붙인다', () => {
    expect(q({ updatedSince: '2025-01-01' })).toBe('lastEdited GE 2025-01-01T00:00:00');
    expect(q({ updatedBefore: '2025-01-01' })).toBe('lastEdited LE 2025-01-01T00:00:00');
    expect(q({ completionAfter: '2025-01-01' })).toBe('overallEndDate GE 2025-01-01T00:00:00');
    expect(q({ updatedSince: '2024-01-01', updatedBefore: '2025-01-01' })).toBe(
      'lastEdited GE 2024-01-01T00:00:00 AND lastEdited LE 2025-01-01T00:00:00',
    );
  });

  it('날짜 형식이 YYYY-MM-DD 가 아니면 exit 2 다', () => {
    expectUsage(() => buildQuery({ updatedSince: '2025/01/01' }), '2025/01/01');
  });

  it('날짜 필터를 걸면 날짜를 기재하지 않은 시험이 빠진다고 경고한다', () => {
    expect(buildQuery({ updatedSince: '2025-01-01' }).warnings).toEqual([
      expect.objectContaining({ code: 'date_filter_excludes_missing' }),
    ]);
    expect(buildQuery({ condition: 'x' }).warnings).toEqual([]);
  });

  /**
   * ISRCTN 은 문법이 깨져도 오류가 아니라 0건이나 전체를 낸다. 사용자 값에 든 따옴표는
   * 질의의 구조를 바꾼다 — `condition:"lung" cancer"` 는 0건이고, 이스케이프를 시도한
   * 세 가지 표기(`""`, `\"`, `&quot;`)는 전부 0건이 나와 **이스케이프가 먹혔는데
   * 안 맞은 것인지 질의가 깨진 것인지 구별할 수 없었다.** 구별할 수 없는 것을 통과시키면
   * 그 0 이 "그런 시험이 없다" 로 배달된다. 증명할 수 없으므로 거부한다.
   */
  it('값에 든 따옴표는 조용히 통과시키지 않고 exit 2 로 거부한다', () => {
    expectUsage(() => buildQuery({ condition: 'say "hi"' }), '따옴표');
    expectUsage(() => buildQuery({ term: 'a"b' }), '따옴표');
  });

  it('아무 축도 없으면 빈 질의가 아니라 exit 2 다 — 빈 질의는 전체 레지스트리를 낸다', () => {
    expectUsage(() => buildQuery({}), '검색 조건');
  });
});

describe('ISRCTN ID 배치 질의', () => {
  /** 실측: `96189403 OR 13423698 OR 16053507` 은 3건을 낸다. */
  it('원문 ID 를 OR 로 잇는다', () => {
    expect(buildIdsQuery(['ISRCTN96189403', 'ISRCTN13423698'])).toBe('ISRCTN96189403 OR ISRCTN13423698');
  });

  it('하나면 OR 없이 그것만', () => {
    expect(buildIdsQuery(['ISRCTN96189403'])).toBe('ISRCTN96189403');
  });
});
