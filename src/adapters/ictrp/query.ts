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
 * **반환 타입이 `Record<string, string>` 이 아니라 `[key, value][]` 인 이유**: 아래
 * phase 항목 참고 — 같은 키를 두 번 실어야 하는 경우가 있고 `Record` 는 그것을 표현할
 * 수 없다.
 *
 * **`ddlRecruitingStatus` 를 언제나 명시하는 것이 이 함수의 가장 중요한 일이다.**
 * 그 컨트롤에는 `selected` 속성이 없어 기본 선택이 첫 항목(`1` = Recruiting)이고,
 * 필드를 보내지 않으면 서버가 그 값을 쓴다. 실측(2026-08-26): `condition=diabetes` 가
 * 보내지 않으면 6,844건, `ALL` 이면 36,264건이다. 명시하지 않으면 **모든 질의가
 * 조용히 모집중만으로 좁혀지고 경고도 붙지 않는다.**
 *
 * 쓰지 않은 축은 키를 만들지 않는다. 빈 문자열도 서버에는 입력이다.
 */
export function buildForm(q: NormalizedQuery, pageSize: number): [string, string][] {
  const f: [string, string][] = [];
  const put = (name: string, v: string | undefined) => {
    if (v !== undefined && v !== '') f.push([name, v]);
  };

  put(FIELD.title, q.title);
  put(FIELD.condition, q.condition);
  put(FIELD.intervention, q.intervention);
  put(FIELD.sponsor, q.lead);
  put(FIELD.secondaryId, q.id);
  /**
   * **이 줄은 아무 효과가 없다.** `txtFreeCountry` 는 입력칸일 뿐이고, 그 값이 실제 필터인
   * `lstCountriesSelected` 로 옮겨지려면 `butAdd` postback 이 따로 필요한데 이 어댑터는
   * 그것을 하지 않는다. 실측(2026-08-26): 나라 셋을 각각 걸어도 세 번 다 필터를 안 건
   * 기준선(1,148,325건)과 같은 수가 나왔다. 그래서 `location` 축은 `supported: false` 다
   * (adapter.ts) — 즉 여기까지 값이 내려올 일 자체가 없다.
   *
   * 그래도 줄을 남기는 것은 `butAdd` 왕복을 구현할 때 필드 이름을 다시 찾지 않기 위해서다.
   * 축을 다시 켜려면 **먼저 필터가 실제로 좁히게 만들고 실측으로 증명해야 한다** — 이 줄만
   * 있으면 되는 것처럼 보이지만, 이 줄만으로는 조용히 전 세계를 돌려주는 축이 된다.
   */
  put(FIELD.country, q.location);

  /**
   * `ListBoxPhase` 는 다중 선택 컨트롤이다. 두 개 이상을 고르려면 **같은 키를
   * 여러 번** 실어야 한다 — HTML 다중 선택이 폼 인코딩되는 방식 그대로다.
   *
   * **콤마로 이으면 안 된다(실측 2026-08-26).** `condition=diabetes` +
   * `ddlRecruitingStatus=ALL` 기준: phase 없음 36,264건, `Phase 3` 단독 4,027건,
   * `Phase 2` 단독 2,749건인데 `ListBoxPhase="Phase 2,Phase 3"` 로 한 번에 실으면
   * **`N records for M trials found` 문구 자체가 없는 깨진 페이지**가 돌아온다.
   * 반면 `ListBoxPhase` 를 두 번 실으면 6,775건(≈ 2,749 + 4,027 − 겹침)으로 맞다.
   *
   * 이게 "작동 안 함"보다 위험한 이유: `parse.ts` 는 그 문구가 없으면
   * `records = 0` 으로 읽고, 자기 고장 감지는 `records > 0` 일 때만 걸린다. 즉
   * `--phase phase_2 --phase phase_3 --registry ictrp` 를 콤마로 합쳐 보내면
   * **경고 하나 없이 0건이 나간다** — 이 CLI 가 없애려는 실패 그 자체다.
   */
  for (const p of q.phase ?? []) {
    const out = PHASE_OUT[p];
    if (out !== undefined) f.push([FIELD.phase, out]);
  }

  // 위 주석 참고 — 이 줄이 빠지면 모든 결과가 조용히 모집중만이 된다.
  f.push([FIELD.status, (q.status ?? []).includes('recruiting') ? '1' : 'ALL']);

  // `ddlPageSize` 는 **싣지 않는다.** 그 컨트롤은 결과 페이지에만 렌더되므로 검색 POST 에
  // 담으면 ASP.NET 이 __EVENTVALIDATION 으로 거절해 결과가 0건이 된다(실측 2026-08-26:
  // 안 보내면 10행, 50/100 을 보내면 각각 0행). 첫 페이지는 언제나 10행이고, 더 받으려면
  // 페이저 postback 으로 넘긴다. `pageSize` 인자는 이 함수의 시그니처에 남지만 폼에는 안 간다 —
  // 지우면 호출자가 `limits.maxPageSize` 와의 관계를 잃는다.
  void pageSize;
  f.push([FIELD.search, 'Search']);
  return f;
}
