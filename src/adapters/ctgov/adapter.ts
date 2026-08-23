import type { AdapterResult, Capability, RegistryAdapter, SearchAxis, Warning } from '../../core/capability.js';
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
import { CTGOV_FILTERABLE } from './vocab.js';

/** 자유 텍스트 축. 닫힌 어휘가 없으니 `values` 는 `null` 이고 덮개 물음도 성립하지 않는다. */
const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });

export const CTGOV_CAPABILITY: Capability = {
  key: 'ctgov',
  name: 'ClinicalTrials.gov',
  region: 'US / global',
  search: {
    condition: free('질환·상태 이름. 동의어 확장이 업스트림에서 일어난다'),
    intervention: free('중재 모듈에 등록된 이름과 그 다른 이름(otherNames)까지 본다 — 상표명으로 걸린 시험이 정작 레코드에는 그 이름을 싣지 않고 나올 수 있다. 요약에만 등장하는 약물은 term 이 잡는다'),
    term: free('제목·조건·중재·요약을 아우르는 본문 전반의 자유 텍스트'),
    title: free('공식 제목과 간략 제목에만 걸린다 — 본문은 보지 않는다'),
    sponsor: free('주 스폰서와 공동 스폰서를 모두 본다'),
    lead: free('주 스폰서만 본다 — 공동 스폰서는 제외된다'),
    location: free('시험 사이트의 기관명·도시·주·국가'),
    id: free('NCT 번호와 업스트림이 기재한 보조 식별자'),
    patient: free('term 과는 다른 업스트림 검색 에어리어라 같은 단어를 넣어도 결과가 갈린다. "62세 EGFR 양성" 같은 긴 서술은 0건이고 단순 문구는 걸린다(실측) — 긴 서술이 0건인 것이 이 에어리어가 적격 기준을 해석하지 않아서인지 그 문구가 안 맞아서인지는 재지 못했다'),
    outcomeQuery: free('1차·2차 평가변수 문구'),
    geo: {
      supported: true, values: null, exhaustive: null,
      scope: '좌표와 반경. 좌표를 가진 사이트만 매칭한다 — 지명은 받지 않는다(--near 는 lat,lon)',
    },
    status: {
      supported: true, values: CTGOV_FILTERABLE.status, exhaustive: false,
      scope: '시험 전체의 대표 상태 하나 — 사이트별 모집 상태가 아니다',
    },
    phase: {
      supported: true, values: CTGOV_FILTERABLE.phase, exhaustive: false,
      scope: '시험이 신고한 단계. 여러 단계를 신고한 시험은 그 전부에 걸린다',
    },
    studyType: {
      supported: true, values: CTGOV_FILTERABLE.studyType, exhaustive: false,
      scope: '중재/관찰/확대접근 구분. 값별로 세면 981건이 어디에도 안 걸리는데, 이 수는 정보가 보류된(WITHHELD) 시험 수와 정확히 같다',
    },
    updatedRange: {
      supported: true, values: null, exhaustive: null,
      scope: '마지막 갱신 게시일(LastUpdatePostDate)',
    },
    startRange: {
      supported: true, values: null, exhaustive: null,
      scope: '시험 시작일(StartDate). 시작한 시험은 실제일(ACTUAL), 아직 시작 안 한 시험은 예정일(ESTIMATED)인데 필터가 둘을 구분하지 않아 예정일로 걸린 시험이 섞여 나온다',
    },
    completionRange: {
      supported: true, values: null, exhaustive: null,
      scope: '1차 완료일(PrimaryCompletionDate) — 최종 완료일이 아니다',
    },
  },
  detail: {
    eligibilityText: { supported: true, scope: '적격 기준 원문. --include eligibility 로 켠다' },
    outcomes: { supported: true, scope: '평가변수 목록(측정 항목·시점). 결과 수치가 아니다' },
    contacts: { supported: true, scope: '중앙 연락처. 사이트별 연락처는 locations 에 있다' },
  },
  results: {
    supported: true,
    scope: 'results 서브커맨드를 지원한다 — 결과 유무로 검색하는 것이 아니다',
  },
  count: { supported: true, scope: '같은 필터로 건수만 받는다. 페이로드를 받지 않는다' },
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
  const client = makeClient(cfg, CTGOV_CAPABILITY.limits.ratePerSec, deps);

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
