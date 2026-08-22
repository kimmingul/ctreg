import type { AdapterResult, Capability, RegistryAdapter, Warning } from '../../core/capability.js';
import type { FetchOpts, NormalizedQuery, ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { formatTrialId, parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError } from '../../runtime/errors.js';
import type { HttpDeps } from '../../runtime/http.js';
import { makeClient } from './client.js';
import { mapStudy } from './map.js';
import { buildIdsParams, buildSearchParams } from './query.js';
import { extractResults } from './results.js';

export const CTGOV_CAPABILITY: Capability = {
  key: 'ctgov',
  name: 'ClinicalTrials.gov',
  region: 'US / global',
  search: {
    condition: true,
    intervention: true,
    term: true,
    title: true,
    sponsor: true,
    lead: true,
    location: true,
    id: true,
    patient: true,
    outcomeQuery: true,
    geo: true,
    geoNeedsCoords: true,
    status: true,
    phase: true,
    studyType: true,
    dateRange: true,
  },
  detail: { eligibilityText: true, outcomes: true, contacts: true },
  results: true,
  count: true,
  limits: { maxPageSize: 200, ratePerSec: 1, maxBatchIds: 50 },
};

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * study 하나를 매핑한다. mapStudy 는 payload 가 nctId 를 담지 못하는 등 개별 study
 * 가 기대한 형태가 아니면 던진다(review 발견 — 예전에는 `id: "CTGOV:undefined"` 를
 * 조작해 냈다). 페이지 하나에 든 오염된 레코드 하나 때문에 나머지가 딸려 죽으면
 * 안 되므로, 여기서 study 단위로 잡아 경고로 격하한다.
 */
function mapStudySafely(
  study: unknown,
  o: FetchOpts,
  fetchedAt: string,
): { record?: TrialRecord; warnings: Warning[] } {
  try {
    const m = mapStudy(study, o, fetchedAt);
    return { record: m.record, warnings: m.warnings };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      warnings: [{ code: 'study_unmapped', message: `study 를 매핑하지 못해 건너뛰었습니다: ${message}` }],
    };
  }
}

export function createCtgovAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const client = makeClient(cfg, deps);

  const toRegistryIds = (ids: string[]) =>
    ids.map((raw) => {
      const parsed = parseTrialId(raw);
      if (parsed.registry !== 'ctgov') {
        throw unsupportedError(
          `'${raw}' 는 ctgov 어댑터가 처리할 수 없습니다`,
          'ctreg registries 로 사용 가능한 레지스트리를 확인하세요.',
        );
      }
      return parsed.registryId;
    });

  return {
    key: 'ctgov',
    capability: () => CTGOV_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const { params, warnings } = buildSearchParams(q, o);
      const res = await client.studies(params, o.cacheMode);
      warnings.push(...res.warnings);
      const studies = res.value.studies ?? [];
      const data: TrialRecord[] = [];
      for (const s of studies) {
        const m = mapStudySafely(s, o, res.fetchedAt);
        if (m.record) data.push(m.record);
        warnings.push(...m.warnings);
      }
      return {
        data,
        warnings,
        ...(res.value.totalCount !== undefined ? { total: res.value.totalCount } : {}),
        ...(res.value.nextPageToken ? { nextPageToken: res.value.nextPageToken } : {}),
      };
    },

    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const registryIds = toRegistryIds(ids);
      const warnings: Warning[] = [];
      const data: TrialRecord[] = [];
      const found = new Set<string>();

      for (const batch of chunk(registryIds, CTGOV_CAPABILITY.limits.maxBatchIds)) {
        const res = await client.studies(buildIdsParams(batch, o), o.cacheMode);
        warnings.push(...res.warnings);
        for (const s of res.value.studies ?? []) {
          const m = mapStudySafely(s, o, res.fetchedAt);
          if (m.record) {
            data.push(m.record);
            found.add(m.record.registryId);
          }
          warnings.push(...m.warnings);
        }
      }

      for (const rid of registryIds) {
        if (!found.has(rid)) {
          warnings.push({
            code: 'not_found',
            message: 'ClinicalTrials.gov 에서 찾지 못했습니다.',
            id: formatTrialId('ctgov', rid),
          });
        }
      }
      return { data, warnings };
    },

    async results(id: string, o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      const [registryId] = toRegistryIds([id]);
      const res = await client.study(registryId!, {}, o.cacheMode);
      const out = extractResults(res.value, formatTrialId('ctgov', registryId!), o, res.fetchedAt);
      return { data: out.results, warnings: [...res.warnings, ...out.warnings] };
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const { params, warnings } = buildSearchParams(q, o);
      // 페이로드를 받지 않는다. 개수만.
      const res = await client.studies({ ...params, pageSize: 0, fields: undefined, countTotal: 'true' }, o.cacheMode);
      return { data: res.value.totalCount ?? 0, warnings: [...warnings, ...res.warnings] };
    },
  };
}
