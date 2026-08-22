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
  get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>>;
  results(id: string, o: ResultsOpts): Promise<AdapterResult<TrialResults>>;
  count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>>;
}
