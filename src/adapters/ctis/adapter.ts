import type { AdapterResult, Capability, RegistryAdapter, SearchAxis, Warning } from '../../core/capability.js';
import { resolvePageSize, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError } from '../../runtime/errors.js';
import { postJson, type HttpDeps } from '../../runtime/http.js';
import { CTIS_COUNTRY_NAMES, toMscCode } from './countries.js';
import { mapItem, type CtisItem } from './map.js';

const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });
const closedOff = (scope: string): SearchAxis => ({ supported: false, values: [], exhaustive: null, scope });

/** 실측 2026-08-30: `size` 를 크게 줘도 받아 준다. 보수적으로 50 으로 둔다. */
export const CTIS_MAX_PAGE_SIZE = 50;

/**
 * **신고의 절반은 "조용히 무시된다" 를 막는 것이다.**
 *
 * 이 API 는 **모르는 검색 키를 조용히 버린다** — 실측 2026-08-30: 있지도 않은
 * `zzNoSuchKey` 를 보내도 전체 12,317건이 그대로 온다. 그래서 `trialPhase`·`ctStatus`·
 * `ageGroup`·`country`·`product`·`therapeuticArea`·`ctNumber` 도 **보내 봤자 필터가
 * 증발한다**(헛소리 값을 줘도 전체가 온다). 그것을 지원한다고 신고하면 좁혀지지 않은
 * 결과가 좁혀진 것처럼 나간다 — 이 CLI 가 없애려는 실패 그 자체다.
 *
 * 실제로 거르는 것만 신고한다(실측 건수):
 * `containAll` 341 · `title` 193 · `medicalCondition` 201 · `sponsor` 233 · `msc` 5,004.
 */
export const CTIS_CAPABILITY: Capability = {
  key: 'ctis',
  name: 'EU CTIS',
  region: 'EU / EEA',
  search: {
    term: free('제목·질환·의뢰기관·번호를 아우르는 자유 텍스트(containAll). 등록번호를 그대로 넣으면 그 한 건이 나온다'),
    title: free('시험 제목만 본다'),
    condition: free('의학적 상태(medicalCondition)로 거른다'),
    sponsor: free('의뢰기관 이름으로 거른다'),
    /**
     * `msc`(Member State Concerned)는 **ISO 3166-1 숫자 코드** 를 받는다. 이름이나 알파벳
     * 코드는 **0건** 이므로(실측), 코드가 틀리면 "그런 시험이 없다" 로 보인다. 그래서 표를
     * 기억으로 적지 않고 코드마다 보내 본 뒤 돌아온 나라로 확정했다(`countries.ts`).
     * 표에 없는 이름은 조용히 넘기지 않고 **거절하고 아는 이름을 제안한다.**
     */
    location: free('EU·EEA 회원국 이름으로 거른다(28개국, 실측 확정). 도시나 기관 이름은 받지 않는다'),
    lead: off('주 스폰서를 따로 거는 자리가 없다 — sponsor 가 하나뿐이다'),
    intervention: off('제품명으로 거는 자리가 응답에는 있으나 검색에서는 조용히 무시된다(실측)'),
    id: off('ctNumber 로 거는 자리가 조용히 무시된다 — get 은 자유 텍스트로 찾고 번호를 대조한다'),
    patient: off('환자 서술로 묻는 자리가 없다'),
    outcomeQuery: off('결과변수로 거는 자리가 없다'),
    investigator: off('검색에도 응답에도 연구자 이름이 없다'),
    geo: off('좌표 검색이 없다'),
    status: closedOff('상태 코드가 숫자인데 그 표를 재지 못했다 — 거를 수도, 읽을 수도 없다'),
    phase: closedOff('상 필터가 조용히 무시된다(실측). 값은 응답에서 읽어 신고한다'),
    studyType: closedOff('의약품 임상시험만 담는 등록부라 가릴 것이 없다'),
    updatedRange: off('갱신일로 거는 자리가 없다 — 값은 읽어 온다'),
    startRange: off('결정일로 거는 자리가 없다 — 값은 읽어 온다'),
    completionRange: off('종료일이 검색 응답에 없다'),
  },
  detail: {
    eligibilityText: { supported: false, scope: '검색 응답에 선정·제외 기준이 없다' },
    outcomes: { supported: false, scope: '주요 결과변수가 문자열로 오지만 구조가 없다' },
    contacts: { supported: false, scope: '검색 응답에 연락처가 없다' },
  },
  results: { supported: false, scope: '결과 데이터는 상세 조회에만 있고 이 어댑터는 아직 그쪽을 쓰지 않는다' },
  count: { supported: true, scope: '검색 조건에 걸린 시험 수(totalRecords)' },
  sort: { supported: false, scope: '정렬 키를 재지 않았다 — 응답 순서 그대로다' },
  limits: { maxPageSize: CTIS_MAX_PAGE_SIZE, ratePerSec: 2, maxBatchIds: 1 },
};

type CtisResponse = {
  data?: CtisItem[];
  pagination?: { totalRecords?: number; currentPage?: number; totalPages?: number; nextPage?: boolean };
};

/**
 * 질의를 만든다. **실제로 거르는 키만 싣는다** — 나머지는 가드가 exit 3 으로 막으므로
 * 여기까지 오지 않지만, 만약 오더라도 조용히 버려지는 키를 보내지는 않는다.
 */
export function buildCriteria(q: NormalizedQuery): Record<string, string | string[]> {
  const crit: Record<string, string | string[]> = {};
  const put = (k: string, v: string | undefined): void => {
    const s = v?.trim();
    if (s !== undefined && s !== '') crit[k] = s;
  };
  put('containAll', q.term);
  if (q.location !== undefined && q.location.trim() !== '') crit.msc = [mscFor(q.location)];
  put('title', q.title);
  put('medicalCondition', q.condition);
  put('sponsor', q.sponsor);
  return crit;
}

/**
 * 나라 이름 → `msc` 코드. **모르는 이름은 조용히 넘기지 않는다** — 그대로 보내면 0건이
 * 오고, 사용자는 "그 나라에 시험이 없다" 로 읽는다. ICTRP 의 나라 축에서 배운 것과 같다.
 */
export function mscFor(name: string): string {
  const code = toMscCode(name);
  if (code !== undefined) return code;
  throw unsupportedError(
    `EU CTIS 는 '${name}' 를 회원국 이름으로 알지 못합니다`,
    `이 레지스트리가 받는 이름: ${CTIS_COUNTRY_NAMES.join(', ')}. ` +
      '다른 표기를 보내면 오류가 아니라 0건이 나오므로(실측) 여기서 막습니다. ' +
      '도시나 기관 이름은 이 레지스트리가 아예 받지 않습니다.',
  );
}

export function createCtisAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const call = async (
    criteria: Record<string, string | string[]>,
    page: number,
    size: number,
    o: { cacheMode: FetchOpts['cacheMode'] },
  ): Promise<{ value: CtisResponse; fetchedAt: string; warnings: Warning[] }> =>
    postJson<CtisResponse>(
      cfg,
      {
        registry: 'ctis',
        baseUrl: cfg.ctisBaseUrl,
        path: '/search',
        body: { pagination: { page, size }, searchCriteria: criteria },
        cacheMode: o.cacheMode,
        ratePerSec: CTIS_CAPABILITY.limits.ratePerSec,
      },
      deps,
    );

  const toRecords = (res: CtisResponse, fetchedAt: string, o: FetchOpts): TrialRecord[] =>
    (res.data ?? [])
      .filter((it) => (it.ctNumber ?? '').trim() !== '')
      .map((it) => {
        const rec = mapItem(it, fetchedAt, o.caps.locations);
        return o.raw ? ({ ...rec, source: it } as TrialRecord) : rec;
      })
      .filter((r) => r.title !== '');

  /** 잘린 장소는 **반드시 말한다** — 조용히 자르면 그 목록이 전부로 읽힌다. */
  const truncationWarnings = (records: TrialRecord[]): Warning[] =>
    records
      .filter((r) => (r.locationsTotal ?? 0) > (r.locations?.length ?? 0))
      .map((r) => ({
        code: 'locations_truncated',
        message:
          `이 시험의 참여국 ${r.locationsTotal}곳 중 ${r.locations!.length}곳만 담았습니다. ` +
          '전부 받으려면 --include locations 로 캡을 올리세요.',
        id: r.id,
        at: r.locations!.length,
      }));

  return {
    key: 'ctis',
    capability: () => CTIS_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const criteria = buildCriteria(q);
      if (Object.keys(criteria).length === 0) {
        /**
         * 조건 없이 부르면 전체 12,317건의 첫 쪽이 온다. 그것을 검색 결과로 내보내면
         * 사용자는 자기 질의가 통한 줄 안다 — 조용히 틀린 답이다.
         */
        throw unsupportedError(
          'CTIS 검색에는 조건이 하나 이상 필요합니다',
          '이 레지스트리가 실제로 거르는 축은 --term · --title · --condition · --sponsor 입니다. ' +
            '나머지 축은 이 API 가 조용히 무시하므로 ctreg 가 미리 막습니다.',
        );
      }
      const size = Math.min(resolvePageSize(q), CTIS_MAX_PAGE_SIZE);
      const page = q.pageToken === undefined ? 1 : Number(q.pageToken);
      if (!Number.isInteger(page) || page < 1) {
        throw unsupportedError(`CTIS 페이지 토큰을 읽지 못했습니다: '${q.pageToken ?? ''}'`, 'ctreg 가 낸 토큰을 그대로 넘겨 주세요.');
      }

      const { value, fetchedAt, warnings } = await call(criteria, page, size, o);
      const data = toRecords(value, fetchedAt, o);
      warnings.push(...truncationWarnings(data));
      const total = value.pagination?.totalRecords ?? 0;
      const nextPageToken = value.pagination?.nextPage === true ? String(page + 1) : undefined;

      return { data, warnings, total, ...(nextPageToken ? { nextPageToken } : {}) };
    },

    /**
     * ID 로 한 건을 집는 검색 키가 없다(`ctNumber` 는 조용히 무시된다). 그러나 자유 텍스트에
     * 번호를 넣으면 그 한 건이 나온다(실측). **돌아온 번호를 대조한다** — 자유 텍스트는
     * 부분 일치도 물 수 있으므로, 대조 없이 첫 건을 내면 다른 시험을 그 시험이라고 내놓는다.
     */
    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const warnings: Warning[] = [];
      const data: TrialRecord[] = [];
      for (const id of ids) {
        const { registryId } = parseTrialId(id);
        const { value, fetchedAt, warnings: w } = await call({ containAll: registryId }, 1, CTIS_MAX_PAGE_SIZE, o);
        warnings.push(...w);
        const hit = toRecords(value, fetchedAt, o).find((r) => r.registryId === registryId);
        if (hit === undefined) {
          warnings.push({ code: 'not_found', message: `${CTIS_CAPABILITY.name} 에서 찾지 못했습니다.`, id });
          continue;
        }
        warnings.push(...truncationWarnings([hit]));
        data.push(hit);
      }
      return { data, warnings };
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const criteria = buildCriteria(q);
      if (Object.keys(criteria).length === 0) {
        throw unsupportedError(
          'CTIS 건수 조회에도 조건이 하나 이상 필요합니다',
          '조건 없이 세면 전체 등록 수가 나오는데, 그것은 이 질의의 답이 아닙니다.',
        );
      }
      const { value, warnings } = await call(criteria, 1, 1, o);
      return { data: value.pagination?.totalRecords ?? 0, warnings };
    },

    async results(_id: string, _o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      throw unsupportedError(
        `${CTIS_CAPABILITY.name}: 구조화된 결과 데이터를 제공하지 않습니다`,
        'ctreg registries 로 이 레지스트리가 지원하는 것을 확인하세요. 결과가 없는 것이 아니라 조회 자체가 불가능합니다.',
      );
    },
  };
}
