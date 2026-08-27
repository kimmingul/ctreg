import { z } from 'zod';
import type { NormalizedQuery, FetchOpts, ResultsOpts } from './query.js';
import type { TrialRecord, TrialResults } from './record.js';
import { REGISTRY_KEYS, type RegistryKey } from './registry.js';

/**
 * 검색 축 하나의 신고. 불리언이었을 때는 "축이 있다" 만 말했고, 그래서 0건이 "없음"
 * 인지 "안 봄" 인지 판별할 근거가 도구 안에 없었다(F2). 세 가지를 더 말한다 —
 * 무엇을 받는지(`values`), 데이터를 덮는지(`exhaustive`), 무엇을 보는지(`scope`).
 */
const SearchAxisSchema = z.strictObject({
  supported: z.boolean(),
  /**
   * 이 레지스트리가 **필터로 받을 수 있는** 공통 어휘 값.
   * - 배열  — 닫힌 어휘 축. 여기 없는 값은 exit 3/2 로 거부된다.
   * - null  — 자유 텍스트 축(닫힌 어휘가 없다).
   * 지원하지 않는 축(`supported: false`)은 닫힌 어휘면 `[]`, 자유 텍스트면 `null` 이다.
   * 둘을 같은 값으로 두면 "아무 값이나 받는다" 와 "아무 값도 못 받는다" 가 같아진다.
   */
  values: z.array(z.string()).nullable(),
  /**
   * 이 축의 **필터 가능한 값들이 레지스트리를 남김없이 덮는가.** 닫힌 어휘 축에만
   * 의미가 있고 자유 텍스트 축은 `null`.
   * `false` 면 값별 건수의 합이 전체 총계보다 작다 — 그 차이가 F8 이 이름 붙이지
   * 못했던 부분이다.
   *
   * **원인은 둘이고 이 신고는 둘을 구분하지 않는다:** 그 필드를 기재하지 않은 레코드와,
   * 기재했으나 그 값이 공통 어휘에 **필터 자리가 없는** 레코드다. 후자가 실제로 더 크다 —
   * ctgov 의 status 미달분 97,667건은 전부 후자이고(UNKNOWN 95,620 + 확대접근 1,066 +
   * WITHHELD 981, 산술이 정확히 맞는다), **상태가 없는 레코드는 0건이다.** 사용자에게
   * 중요한 것은 어느 쪽이든 "값별로 세면 총계가 안 맞는다" 는 사실이므로 하나로 신고하되,
   * 경고 문구가 원인을 단정해서는 안 된다.
   *
   * `supported: false` 인 축도 `null` 이다 — 검색할 수 없는 축에 "덮는다/못 덮는다" 는
   * 물음 자체가 성립하지 않는다. 여기에 `true`/`false` 를 적으면 읽는 쪽이 그 축으로
   * 무언가 셀 수 있다고 오해한다.
   */
  exhaustive: z.boolean().nullable(),
  /** 이 축이 실제로 **무엇을 보는지** 한 문장. 불리언이 말하지 못하는 것. */
  scope: z.string().min(1),
});

/**
 * 축이 아닌 기능(`results`·`count`·detail 섹션)의 신고. F14 가 요구한 것이 `scope` 다 —
 * `results: true` 가 "결과 유무로 검색할 수 있다" 로 읽혔는데, 불리언에는 그것이
 * 무엇에 대한 참인지 적을 자리가 없었다.
 */
const FeatureSchema = z.strictObject({
  supported: z.boolean(),
  scope: z.string().min(1),
});

export const CapabilitySchema = z.strictObject({
  key: z.enum(REGISTRY_KEYS),
  name: z.string(),
  region: z.string(),
  /** 모든 축을 명시적으로 신고한다. 빠뜨리면 "미지원"인지 "선언 누락"인지 알 수 없다. */
  search: z.strictObject({
    condition: SearchAxisSchema,
    intervention: SearchAxisSchema,
    term: SearchAxisSchema,
    title: SearchAxisSchema,
    sponsor: SearchAxisSchema,
    lead: SearchAxisSchema,
    /**
     * **사람 이름으로 묻는 축.** 자유 텍스트 축과 나눠 두는 이유는 레지스트리마다 이것을
     * 할 수 있느냐가 갈리기 때문이다 — ctgov 는 필드를 지정할 수 있고(`AREA[...]`),
     * ISRCTN 은 필드 이름을 **조용히 무시** 하며(실측: 없는 필드명도 같은 건수를 낸다),
     * ICTRP 화면에는 그런 칸이 아예 없다.
     */
    investigator: SearchAxisSchema,
    location: SearchAxisSchema,
    id: SearchAxisSchema,
    patient: SearchAxisSchema,
    outcomeQuery: SearchAxisSchema,
    /**
     * 이전엔 여기 `geoNeedsCoords: z.boolean()` 이 있었다 — 좌표 없이 지명만으로 지오
     * 검색을 받는 레지스트리가 생기면 다시 의미가 생긴다. 그런 레지스트리가 아직 없어
     * 지웠다. 되살릴 조건과 경위는 docs/slice-2-prerequisites.md 참고.
     * (지금은 그 사실이 이 축의 `scope` 한 문장에 들어간다.)
     */
    geo: SearchAxisSchema,
    status: SearchAxisSchema,
    phase: SearchAxisSchema,
    studyType: SearchAxisSchema,
    /**
     * 날짜 축은 셋으로 나뉜다. 하나로 묶으면 "일부 날짜만 되는" 레지스트리를 표현할 수
     * 없고, 그런 레지스트리가 실재한다 — ISRCTN 은 `lastEdited`(갱신)와
     * `overallEndDate`(종료)로는 걸러지지만 `overallStartDate`(시작)는 문서에 있는데도
     * 조용히 무시되어 필터가 없던 것처럼 전체를 돌려준다. 축이 하나라면 그 어댑터는
     * 시작일 필터가 증발한 결과를 필터된 것처럼 내보내거나, 실제로 되는 두 축까지
     * 포기해야 한다. 둘 다 이 CLI 가 없애려는 실패다.
     */
    updatedRange: SearchAxisSchema,
    startRange: SearchAxisSchema,
    completionRange: SearchAxisSchema,
  }),
  detail: z.strictObject({
    eligibilityText: FeatureSchema,
    outcomes: FeatureSchema,
    contacts: FeatureSchema,
  }),
  results: FeatureSchema,
  count: FeatureSchema,
  /**
   * `--sort` 를 **업스트림까지 실어 보내는가.**
   *
   * 왜 신고가 필요한가(실측 2026-08-28) — 셋 중 ctgov 만 정렬 키를 보내고 나머지 둘은
   * 조용히 무시했다. exit 0, 경고 없음, 결과는 업스트림 기본 순서. 정렬된 줄 알고 앞
   * 몇 건만 보고 판단하면 그 판단이 조용히 틀린다. 검색 축 미지원과 같은 부류다.
   *
   * `values` 를 두지 않는 것은 **받는 키 목록을 실측하지 못했기 때문이다.** ctgov 는
   * `LastUpdatePostDate` · `EnrollmentCount:desc` · `@relevance` 처럼 접미사까지 받고,
   * 전체 목록은 문서에도 확정적으로 나와 있지 않다. 모르는 것을 닫힌 어휘로 적으면
   * 실제로 되는 정렬을 ctreg 가 막는다 — 그래서 값은 그대로 보내고, 틀린 키는 업스트림이
   * 400 으로 되돌린다(exit 4, "Unknown sort field"). **소리는 나므로 조용한 실패가 아니다.**
   */
  sort: FeatureSchema,
  limits: z.strictObject({
    maxPageSize: z.number(),
    ratePerSec: z.number(),
    maxBatchIds: z.number(),
  }),
});
export type Capability = z.infer<typeof CapabilitySchema>;
export type SearchAxis = z.infer<typeof SearchAxisSchema>;
export type Feature = z.infer<typeof FeatureSchema>;

/**
 * 비치명적 사실. 치명적 실패는 CtregError 로 던진다.
 * `registry` 는 레지스트리 단위 경고(예: `page_size_clamped`)에만 채운다 — `id` 가
 * 있는 시험 단위 경고와 달리, 어느 트라이얼이 아니라 어느 레지스트리가 원인인지를
 * 밝혀야 연합 조회에서 "누가 깎았는지" 를 사용자가 찾을 수 있다.
 */
export type Warning = { code: string; message: string; id?: string; at?: number; registry?: RegistryKey };
export type AdapterResult<T> = { data: T; warnings: Warning[] };

export interface RegistryAdapter {
  readonly key: RegistryKey;
  capability(): Capability;
  search(
    q: NormalizedQuery,
    o: FetchOpts,
  ): Promise<AdapterResult<TrialRecord[]> & { total?: number; nextPageToken?: string }>;
  /**
   * `ids` 는 **접두사가 붙은 형태**로 온다 — `CTGOV:NCT03831932`, `ISRCTN:ISRCTN12345678`.
   * 어댑터가 `parseTrialId` 로 스스로 벗겨서 원문 ID 만 업스트림에 보내야 한다.
   * CLI 는 벗겨 주지 않는다: 연합 조회에서 어느 레지스트리로 라우팅할지를 접두사가
   * 정하므로, 라우팅이 끝난 뒤에도 접두사가 남아 있는 것이 정상 경로다.
   *
   * 이 규약을 안 지켜도 스텁 트랜스포트는 무엇을 물어보든 응답하므로 테스트가 초록일 수
   * 있다 — 실물 레지스트리에서만 조용히 0건이 된다. 계약 스위트의 "접두사가 업스트림에
   * 새면 안 된다" 검사가 이 자리를 지킨다.
   */
  get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>>;
  /** `id` 는 `get` 과 같은 접두사 포함 형태다. 위 주석 참고. */
  results(id: string, o: ResultsOpts): Promise<AdapterResult<TrialResults>>;
  count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>>;
}
