import { z } from 'zod';
import type { NormalizedQuery, FetchOpts, ResultsOpts } from './query.js';
import type { TrialRecord, TrialResults } from './record.js';
import { REGISTRY_KEYS, type RegistryKey } from './registry.js';

export const CapabilitySchema = z.strictObject({
  key: z.enum(REGISTRY_KEYS),
  name: z.string(),
  region: z.string(),
  /** 모든 축을 명시적으로 신고한다. 빠뜨리면 "미지원"인지 "선언 누락"인지 알 수 없다. */
  search: z.strictObject({
    condition: z.boolean(),
    intervention: z.boolean(),
    term: z.boolean(),
    title: z.boolean(),
    sponsor: z.boolean(),
    lead: z.boolean(),
    location: z.boolean(),
    id: z.boolean(),
    patient: z.boolean(),
    outcomeQuery: z.boolean(),
    /**
     * 이전엔 여기 `geoNeedsCoords: z.boolean()` 이 있었다 — 좌표 없이 지명만으로 지오
     * 검색을 받는 레지스트리가 생기면 다시 의미가 생긴다. 그런 레지스트리가 아직 없어
     * 지웠다. 되살릴 조건과 경위는 docs/slice-2-prerequisites.md 참고.
     */
    geo: z.boolean(),
    status: z.boolean(),
    phase: z.boolean(),
    studyType: z.boolean(),
    dateRange: z.boolean(),
  }),
  detail: z.strictObject({
    eligibilityText: z.boolean(),
    outcomes: z.boolean(),
    contacts: z.boolean(),
  }),
  results: z.boolean(),
  count: z.boolean(),
  limits: z.strictObject({
    maxPageSize: z.number(),
    ratePerSec: z.number(),
    maxBatchIds: z.number(),
  }),
});
export type Capability = z.infer<typeof CapabilitySchema>;

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
