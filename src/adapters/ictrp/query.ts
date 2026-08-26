import type { NormalizedQuery } from '../../core/query.js';
import type { StudyType, TrialPhase, TrialStatus } from '../../core/vocab.js';
import { FIELD } from './form.js';

/**
 * 공통 어휘 → ICTRP 의 `ListBoxPhase` 값.
 *
 * `na` 는 없다 — ICTRP 목록이 Phase 0~4 뿐이다. `early_phase_1` 을 `Phase 0` 에
 * 잇는 것은 CT.gov 의 Early Phase 1 이 Phase 0 의 후신이기 때문이다.
 */
export const PHASE_OUT: Partial<Record<TrialPhase, string>> = {
  early_phase_1: 'Phase 0',
  phase_1: 'Phase 1',
  phase_2: 'Phase 2',
  phase_3: 'Phase 3',
  phase_4: 'Phase 4',
};

/**
 * 이 레지스트리가 **받는** 값. capability 의 `values` 가 이것을 그대로 신고한다.
 *
 * `status` 가 하나뿐인 것은 `ddlRecruitingStatus` 가 상태 어휘가 아니라
 * "모집중만 / 전부" 토글이기 때문이다. `studyType` 은 폼에 자리가 없다.
 */
export const ICTRP_FILTERABLE: {
  status: TrialStatus[];
  phase: TrialPhase[];
  studyType: StudyType[];
} = {
  status: ['recruiting'],
  phase: Object.keys(PHASE_OUT) as TrialPhase[],
  studyType: [],
};

/**
 * `NormalizedQuery` 를 폼 본문으로 옮긴다. ViewState 는 여기서 다루지 않는다 —
 * 그것은 전송의 몫이고(`client.ts`) 이 함수는 순수하게 유지한다.
 *
 * **`ddlRecruitingStatus` 를 언제나 명시하는 것이 이 함수의 가장 중요한 일이다.**
 * 그 컨트롤에는 `selected` 속성이 없어 기본 선택이 첫 항목(`1` = Recruiting)이고,
 * 필드를 보내지 않으면 서버가 그 값을 쓴다. 실측(2026-08-26): `condition=diabetes` 가
 * 보내지 않으면 6,844건, `ALL` 이면 36,264건이다. 명시하지 않으면 **모든 질의가
 * 조용히 모집중만으로 좁혀지고 경고도 붙지 않는다.**
 *
 * 쓰지 않은 축은 키를 만들지 않는다. 빈 문자열도 서버에는 입력이다.
 */
export function buildForm(q: NormalizedQuery, pageSize: number): Record<string, string> {
  const f: Record<string, string> = {};
  const put = (name: string, v: string | undefined) => {
    if (v !== undefined && v !== '') f[name] = v;
  };

  put(FIELD.title, q.title);
  put(FIELD.condition, q.condition);
  put(FIELD.intervention, q.intervention);
  put(FIELD.sponsor, q.lead);
  put(FIELD.secondaryId, q.id);
  put(FIELD.country, q.location);

  const phases = (q.phase ?? []).map((p) => PHASE_OUT[p]).filter((v): v is string => v !== undefined);
  if (phases.length > 0) f[FIELD.phase] = phases.join(',');

  // 위 주석 참고 — 이 줄이 빠지면 모든 결과가 조용히 모집중만이 된다.
  f[FIELD.status] = (q.status ?? []).includes('recruiting') ? '1' : 'ALL';

  // `ddlPageSize` 는 **싣지 않는다.** 그 컨트롤은 결과 페이지에만 렌더되므로 검색 POST 에
  // 담으면 ASP.NET 이 __EVENTVALIDATION 으로 거절해 결과가 0건이 된다(실측 2026-08-26:
  // 안 보내면 10행, 50/100 을 보내면 각각 0행). 첫 페이지는 언제나 10행이고, 더 받으려면
  // 페이저 postback 으로 넘긴다. `pageSize` 인자는 이 함수의 시그니처에 남지만 폼에는 안 간다 —
  // 지우면 호출자가 `limits.maxPageSize` 와의 관계를 잃는다.
  void pageSize;
  f[FIELD.search] = 'Search';
  return f;
}
