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
    geo: z.boolean(),
    geoNeedsCoords: z.boolean(),
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

/** 비치명적 사실. 치명적 실패는 CtregError 로 던진다. */
export type Warning = { code: string; message: string; id?: string; at?: number };
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
