/**
 * ISRCTN 질의 문자열 조립.
 *
 * 이 파일의 모든 선택은 실측에서 나왔다(docs/registry-field-survey-2026-08-22.md 와
 * 그 뒤의 추가 실측). 문서만 읽고 쓰면 안 되는 이유는 하나다 — **ISRCTN 은 틀린 질의에
 * 오류를 내지 않는다.** 필드명이 틀리면 0건, 값이 틀려도 0건, 따옴표를 빠뜨리면 다른
 * 건수, 죽은 필드에 범위 비교를 걸면 그 절이 통째로 사라져 **전체** 가 나온다. 어느
 * 경우에도 exit 는 0 이고 경고도 없다. CT.gov 는 모르는 파라미터에 400 을 내므로 이
 * 실패 양식 자체가 없다.
 *
 * 그래서 여기 있는 필드명은 전부 "쳐 봤더니 좁혀지더라" 로 확인된 것만이다. 문서에
 * 있으나 죽은 것(`trialStatus`, `recruitmentStatus`, `overallStartDate`)은 capability 에서
 * false 로 신고하고 이 파일에 아예 등장하지 않는다 — 여기 없는 것이 곧 신고와 일치한다.
 */

import type { Warning } from '../../core/capability.js';
import { CAPS, type NormalizedQuery } from '../../core/query.js';
import type { TrialPhase } from '../../core/vocab.js';
import { usageError } from '../../runtime/errors.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 값은 항상 따옴표로 싼다. 공백이 있으면 필수고(`condition:lung cancer` 는
 * `condition:lung` + 자유텍스트 `cancer` 로 쪼개져 다른 답이 나온다), 없으면 결과가
 * 같다. 조건부로 감싸면 규칙을 어겼을 때 오류가 아니라 다른 답이 나오므로 조건을 없앴다.
 *
 * 사용자 값에 든 `"` 는 질의의 구조를 바꾼다. 이스케이프 세 표기(`""`, `\"`, `&quot;`)를
 * 전부 실측했지만 셋 다 0건이 나와서 **먹혔는데 안 맞은 것인지 질의가 깨진 것인지
 * 구별할 수 없었다.** 구별할 수 없는 것을 통과시키면 그 0 이 "그런 시험이 없다" 로
 * 배달된다 — 이 CLI 가 없애려는 실패 그 자체다. 증명할 수 없으므로 거부한다.
 */
function quote(value: string, axis: string): string {
  if (value.includes('"')) {
    throw usageError(
      `ISRCTN 검색값에는 따옴표(")를 쓸 수 없습니다 — '${axis}' 값: ${value}`,
      'ISRCTN 은 깨진 질의에 오류가 아니라 0건을 돌려주므로, 이스케이프가 실제로 통하는지 확인할 방법이 없습니다. 따옴표를 빼고 다시 시도하세요.',
    );
  }
  return `"${value}"`;
}

/**
 * 폐쇄 어휘 → ISRCTN `phase` 질의 값. vocab.ts 의 역방향이 아니라 **별개 테이블** 이다:
 * vocab.ts 는 WHO 포맷이 내려주는 값을 읽고, 이쪽은 default 포맷에 질의로 보내는 값이다.
 * 지금은 두 어휘의 문자열이 같지만 그건 우연이고, 한쪽이 바뀌어도 다른 쪽이 조용히
 * 따라가면 안 된다.
 */
const PHASE_OUT: Partial<Record<TrialPhase, string>> = {
  phase_1: 'Phase I',
  phase_2: 'Phase II',
  phase_3: 'Phase III',
  phase_4: 'Phase IV',
  na: 'Not Applicable',
};

const STUDY_TYPE_OUT: Record<string, string> = {
  interventional: 'Interventional',
  observational: 'Observational',
};

/** 날짜는 콜론이 아니라 공백 + 비교 연산자이고, 시각까지 있어야 한다(문서 3.2 예시). */
function dateClause(field: string, op: 'GE' | 'LE', value: string): string {
  if (!DATE.test(value)) {
    throw usageError(`날짜 '${value}' 는 YYYY-MM-DD 형식이 아닙니다`, '예: 2025-01-01');
  }
  return `${field} ${op} ${value}T00:00:00`;
}

export function buildQuery(q: NormalizedQuery): { q: string; warnings: Warning[] } {
  const clauses: string[] = [];
  const warnings: Warning[] = [];

  // 자유 텍스트는 필드명 없이 나간다 — 문서 3.2.2 의 첫 예시(`q=covid`)와 같다.
  if (q.term !== undefined) clauses.push(quote(q.term, 'term'));

  const keyword: [string, string | undefined, string][] = [
    ['condition', q.condition, 'condition'],
    ['intervention', q.intervention, 'intervention'],
    ['title', q.title, 'title'],
    ['sponsorOrganisation', q.sponsor, 'sponsor'],
    ['outcomeMeasures', q.outcomeQuery, 'outcomeQuery'],
  ];
  for (const [field, value, axis] of keyword) {
    if (value !== undefined) clauses.push(`${field}:${quote(value, axis)}`);
  }

  if (q.studyType !== undefined) {
    const out = STUDY_TYPE_OUT[q.studyType];
    if (!out) {
      throw usageError(
        `ISRCTN 에는 '${q.studyType}' 에 해당하는 연구유형 값이 없습니다`,
        'interventional 또는 observational 을 쓰세요.',
      );
    }
    clauses.push(`primaryStudyDesign:${quote(out, 'studyType')}`);
  }

  if (q.phase?.length) {
    const values = q.phase.map((p) => {
      const out = PHASE_OUT[p];
      if (!out) {
        // 조용히 빼면 요청한 것보다 넓은 결과가 요청대로인 양 나간다. ISRCTN 의 phase
        // 어휘(문서 3.2.1.12)에 자리가 없다는 것은 "결과가 없다" 가 아니라 "그렇게
        // 물어볼 수 없다" 이므로 exit 2 다.
        throw usageError(
          `ISRCTN 에는 '${p}' 에 해당하는 단계 값이 없습니다`,
          'ISRCTN 이 쓰는 단계는 Phase I~IV 와 그 결합, 그리고 Not Applicable 뿐입니다.',
        );
      }
      return `phase:${quote(out, 'phase')}`;
    });
    // 괄호가 없으면 AND 가 OR 보다 강하게 묶여 답이 달라진다(실측: 692 vs 1291).
    clauses.push(values.length === 1 ? values[0]! : `(${values.join(' OR ')})`);
  }

  // 시작일(`overallStartDate`)은 여기 없다 — 문서에는 있지만 실측에서 필터가 통째로
  // 무시되어 전체를 돌려준다. capability 의 `startRange: false` 가 그 사실을 신고하고,
  // 가드가 exit 3 으로 막으므로 이 함수는 그 필드를 볼 일이 없다.
  const dates: (string | undefined)[] = [
    q.updatedSince !== undefined ? dateClause('lastEdited', 'GE', q.updatedSince) : undefined,
    q.updatedBefore !== undefined ? dateClause('lastEdited', 'LE', q.updatedBefore) : undefined,
    q.completionAfter !== undefined ? dateClause('overallEndDate', 'GE', q.completionAfter) : undefined,
    q.completionBefore !== undefined ? dateClause('overallEndDate', 'LE', q.completionBefore) : undefined,
  ];
  const dateClauses = dates.filter((v): v is string => v !== undefined);
  if (dateClauses.length > 0) {
    clauses.push(...dateClauses);
    warnings.push({
      code: 'date_filter_excludes_missing',
      message: '날짜 필터는 해당 날짜를 게시한 시험만 매칭합니다. 날짜를 기재하지 않은 시험은 결과에서 빠집니다.',
    });
  }

  if (clauses.length === 0) {
    // 빈 `q` 는 오류가 아니라 **레지스트리 전체**(실측 28592건)를 낸다. 조건 없는 조회를
    // 우연히 보내면 그게 검색 결과인 양 돌아온다.
    throw usageError(
      'ISRCTN 검색에는 검색 조건이 적어도 하나 필요합니다',
      '빈 질의는 ISRCTN 레지스트리 전체를 돌려줍니다. --condition 등으로 좁히세요.',
    );
  }

  return { q: clauses.join(' AND '), warnings };
}

/**
 * 배치 조회. ISRCTN 에는 ID 전용 질의 필드가 없다 — `isrctn:`·`isrctnNumber:`·
 * `secondaryNumber:` 전부 실측에서 0건이다. 자유 텍스트로 번호를 던지는 것만 통하고
 * (`ISRCTN96189403` → 1건), `OR` 로 이으면 배치가 된다(실측 3건).
 *
 * 자유 텍스트 검색이므로 **엉뚱한 시험이 딸려올 수 있다** — 본문 어딘가에 그 번호를
 * 인용한 시험이 걸린다. 어댑터가 받은 결과를 요청한 ID 로 다시 거르는 이유다.
 */
export function buildIdsQuery(registryIds: string[]): string {
  return registryIds.join(' OR ');
}

/** 이 레지스트리에는 페이지네이션이 없다 — `limit` 하나가 전부다(문서 3.2). */
export function pageLimit(q: NormalizedQuery): number {
  return Math.min(q.pageSize ?? CAPS.pageSize.default, CAPS.pageSize.max);
}
