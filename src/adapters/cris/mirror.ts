import { AGGREGATE_AXES, type AdapterResult, type AggregateData, type AggregateQuery, type Capability, type RegistryAdapter, type SearchAxis, type Warning } from '../../core/capability.js';
import { resolvePageSize, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { parseTrialId } from '../../core/registry.js';
import { TRIAL_STATUS, type TrialStatus } from '../../core/vocab.js';
import type { Config } from '../../runtime/config.js';
import { CtregError, unsupportedError } from '../../runtime/errors.js';
import { getJson, type HttpDeps } from '../../runtime/http.js';
import { mapDetail } from './map.js';

/**
 * CRIS — **사본으로 들어가는 문.**
 *
 * 공식 API(`adapter.ts`)는 목록 16항목에 사람 이름이 없어 연구자로 찾으려면 후보를 하나씩
 * 열어야 했다(1~3분, 후보는 검색어 범위에 갇힘). 사용자가 CRIS 전체(12,585건, 상세 포함)를
 * KCTIS(`kctis-web`)에 사본으로 만들었고, 그쪽 `/api/cris/search` 는 `scientific_name_kr/en`
 * 을 목록 축으로 받는다. 실측(2026-09-11): 김민걸 → 43건, 표기 11가지, 수 ms.
 *
 * **같은 레지스트리, 다른 문이다.** 키는 `cris` 그대로이고 `createAdapters` 가 설정
 * (`CTREG_CRIS_MIRROR_URL`)을 보고 고른다. 사본의 원천은 공식 API 로 받은 것뿐이다
 * (웹 수집분은 쓰지 않는다) — 밖으로 나가는 데이터의 출처를 하나로 유지한다.
 *
 * **사본은 사본이라고 말한다.** 응답마다 `cris_mirror_copy` 경고에 수집 시각을 싣는다.
 * 실시간 레지스트리보다 늦을 수 있고, 그 사실을 사용자가 알아야 "최신 등록이 없다" 를
 * "아직 사본에 안 들어왔다" 와 구별한다.
 */

const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });
const closedOff = (scope: string): SearchAxis => ({ supported: false, values: [], exhaustive: null, scope });

/** 공통 어휘 → 사본의 `recruitment_status_en`. 사본 전수에서 본 일곱 값이 전부다. */
const STATUS_EN: Partial<Record<TrialStatus, string>> = {
  recruiting: 'Recruiting',
  not_yet_recruiting: 'Not yet recruiting',
  active_not_recruiting: 'Active, not recruiting',
  suspended: 'Suspended',
  terminated: 'Terminated',
  completed: 'Completed',
  withdrawn: 'Withdrawn',
};
const STATUS_VALUES = TRIAL_STATUS.filter((s) => s in STATUS_EN);

export const CRIS_MIRROR_MAX_PAGE_SIZE = 100;

export const CRIS_MIRROR_CAPABILITY: Capability = {
  key: 'cris',
  name: 'CRIS (한국 임상연구정보서비스)',
  region: 'KR',
  search: {
    term: free('국문·영문 제목, 의뢰기관, 등록번호를 훑는다 — 공식 API 의 srchWord 와 같은 범위. 쉼표로 여럿이면 OR("당뇨,diabetes")'),
    condition: off('사본에 질환 축이 따로 없다 — 질환명을 --term 에 담으면 제목에 걸리는 만큼 걸린다'),
    intervention: off('중재 축이 없다'),
    title: off('제목만 따로 거는 자리가 없다 — --term 이 제목도 함께 훑는다'),
    sponsor: free('의뢰기관 이름 부분 일치 — 국문·영문'),
    lead: off('주 스폰서를 따로 거는 자리가 없다 — --sponsor 를 써라'),
    location: free('실시기관 또는 연구책임자 소속 이름 부분 일치'),
    id: off('등록번호는 get 으로 — 사본은 번호로 한 건을 집는다'),
    patient: off('환자 서술로 묻는 자리가 없다'),
    outcomeQuery: off('결과변수로 거는 자리가 없다'),
    /** 이것이 이 문을 쓰는 이유다. */
    investigator: free(
      '연구책임자 국문·영문 이름을 목록에서 바로 거른다(사본). 표기는 정규화해 맞춘다 — ' +
        'Min-Gul Kim = MinGul Kim = MIN GUL KIM. --term 없이도 된다. 실무담당자는 세지 않는다',
    ),
    geo: off('좌표 검색이 없다'),
    status: { supported: true, values: [...STATUS_VALUES], exhaustive: true, scope: '사본의 모집상태(일곱 값) — 공식 API 목록에는 없던 축' },
    phase: closedOff('사본의 상 필드는 절반이 비어 있고 나머지는 "해당사항없음" 이다 — 거를 값이 없다'),
    studyType: closedOff('연구종류로 거는 자리가 없다 — 값은 읽어 신고한다'),
    updatedRange: off('최종갱신일로 거는 자리가 없다'),
    startRange: off('첫 대상자 등록일로 거는 자리가 없다'),
    completionRange: off('연구종료일로 거는 자리가 없다'),
  },
  detail: {
    eligibilityText: { supported: false, scope: '나이·성별 범위는 오지만 선정·제외 기준문은 없다' },
    outcomes: { supported: false, scope: '결과변수가 사본에 있지만 ctreg 의 구조로 옮기지 않았다' },
    contacts: { supported: true, scope: '연구책임자 성명(국문·영문)과 연구실무담당자 — search 에서도 온다(사본은 상세를 다 갖고 있다)' },
  },
  results: { supported: false, scope: '구조화된 결과 데이터를 내주지 않는다' },
  count: { supported: true, scope: '조건에 걸린 사본의 등록 수' },
  sort: { supported: false, scope: '등록일 내림차순 고정' },
  /** 순위·현황 질문은 도구가 센다 — 사본 전체를 한 축으로 묶는다. 이 문만 할 수 있다. */
  aggregate: { supported: true, scope: '검색어(OR)에 걸린 시험 전체를 한 축으로 묶어 등록 건수순. 의뢰사·기관은 KCTIS 마스터로, 의약품·질환은 사전 문자열 매칭', axes: [...AGGREGATE_AXES] },
  /** 우리 서버다 — 공공데이터포털의 한도와 무관하다. 그래도 같은 org 의 작은 머신이라 예의를 지킨다. */
  limits: { maxPageSize: CRIS_MIRROR_MAX_PAGE_SIZE, ratePerSec: 20, maxBatchIds: 50 },
};

type MirrorSearch = {
  total: number;
  page: number;
  limit: number;
  items: Record<string, unknown>[];
  meta?: { collected_at?: string; studies?: number };
};
type MirrorStudy = Record<string, unknown> & { meta?: { collected_at?: string } };

const copyWarning = (collectedAt: string | undefined): Warning => ({
  code: 'cris_mirror_copy',
  message:
    `CRIS 사본(KCTIS)에서 조회했습니다 — 수집 ${collectedAt ?? '(시각 미상)'}. ` +
    '공식 레지스트리보다 늦을 수 있습니다: 그 뒤 등록·갱신된 것은 여기 없습니다.',
  registry: 'cris',
});

export function createCrisMirrorAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const baseUrl = (cfg.crisMirrorUrl ?? '').replace(/\/+$/, '');

  const call = async <T>(path: string, params: Record<string, string | number>, o: { cacheMode: FetchOpts['cacheMode'] }) => {
    return getJson<T>(
      cfg,
      { registry: 'cris', baseUrl, path, params, cacheMode: o.cacheMode, ratePerSec: CRIS_MIRROR_CAPABILITY.limits.ratePerSec },
      deps,
    );
  };

  const toParams = (q: NormalizedQuery, limit: number, page: number): Record<string, string | number> => {
    const p: Record<string, string | number> = { limit, page };
    if (q.term) p.q = q.term;
    if (q.investigator) p.investigator = q.investigator;
    if (q.sponsor) p.sponsor = q.sponsor;
    if (q.location) p.site = q.location;
    if (q.status && q.status.length > 0) {
      const en = q.status.map((s) => STATUS_EN[s]).filter((s): s is string => s !== undefined);
      if (en.length !== q.status.length) {
        throw unsupportedError(
          `${CRIS_MIRROR_CAPABILITY.name}: 이 모집상태 값으로는 거를 수 없습니다`,
          `받는 값: ${STATUS_VALUES.join(', ')}`,
        );
      }
      p.status = en.join(',');
    }
    return p;
  };

  const toRecords = (items: Record<string, unknown>[], fetchedAt: string, raw: boolean): TrialRecord[] =>
    items
      .filter((it) => typeof it.trial_id === 'string' && (it.trial_id as string).trim() !== '')
      .map((it) => {
        const rec = mapDetail(it, fetchedAt);
        return raw ? { ...rec, source: it } : rec;
      })
      .filter((r) => r.title !== '');

  return {
    key: 'cris',
    capability: () => CRIS_MIRROR_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const pageSize = Math.min(resolvePageSize(q), CRIS_MIRROR_MAX_PAGE_SIZE);
      const page = q.pageToken === undefined ? 1 : Number(q.pageToken);
      if (!Number.isInteger(page) || page < 1) {
        throw unsupportedError(`CRIS 페이지 토큰을 읽지 못했습니다: '${q.pageToken}'`, 'ctreg 가 낸 nextPageToken 을 그대로 넘겨 주세요.');
      }
      const { value, fetchedAt, warnings: w } = await call<MirrorSearch>('/api/cris/search', toParams(q, pageSize, page), o);
      const warnings: Warning[] = [...w, copyWarning(value.meta?.collected_at)];
      const data = toRecords(value.items ?? [], fetchedAt, o.raw);
      const raw = (value.items ?? []).length;
      if (raw > data.length) {
        warnings.push({ code: 'records_dropped', message: `${raw}건 중 ${raw - data.length}건은 등록번호나 제목이 없어 레코드로 만들지 못했습니다.`, registry: 'cris' });
      }
      const total = value.total ?? 0;
      const seen = (page - 1) * pageSize + raw;
      return { data, warnings, total, ...(seen < total ? { nextPageToken: String(page + 1) } : {}) };
    },

    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const warnings: Warning[] = [];
      const data: TrialRecord[] = [];
      let collectedAt: string | undefined;
      for (const id of ids) {
        const { registryId } = parseTrialId(id);
        try {
          const { value, fetchedAt, warnings: w } = await call<MirrorStudy>(`/api/cris/${encodeURIComponent(registryId)}`, {}, o);
          warnings.push(...w);
          collectedAt ??= value.meta?.collected_at;
          const rec = mapDetail(value, fetchedAt);
          if (rec.registryId.toUpperCase() !== registryId.toUpperCase()) {
            warnings.push({ code: 'not_found', message: `${CRIS_MIRROR_CAPABILITY.name} 에서 찾지 못했습니다.`, id });
            continue;
          }
          data.push(o.raw ? ({ ...rec, source: value } as TrialRecord) : rec);
        } catch (e) {
          // 사본은 없는 번호를 404 로 낸다 — 오류가 아니라 **없다** 는 답이다.
          if (e instanceof CtregError && e.code === 'not_found') {
            warnings.push({ code: 'not_found', message: `${CRIS_MIRROR_CAPABILITY.name} 에서 찾지 못했습니다.`, id });
            continue;
          }
          throw e;
        }
      }
      warnings.push(copyWarning(collectedAt));
      return { data, warnings };
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const { value, warnings } = await call<MirrorSearch>('/api/cris/search', toParams(q, 1, 1), o);
      return { data: value.total ?? 0, warnings: [...warnings, copyWarning(value.meta?.collected_at)] };
    },

    async aggregate(q: AggregateQuery, o: FetchOpts): Promise<AdapterResult<AggregateData>> {
      const p: Record<string, string | number> = { by: q.by, q: q.terms.join(','), limit: q.limit };
      if (q.status && q.status.length > 0) {
        const en = q.status.map((s) => STATUS_EN[s]).filter((s): s is string => s !== undefined);
        if (en.length !== q.status.length) throw unsupportedError(`${CRIS_MIRROR_CAPABILITY.name}: 이 모집상태 값으로는 거를 수 없습니다`, `받는 값: ${STATUS_VALUES.join(', ')}`);
        p.status = en.join(',');
      }
      type Row = { key: string; name: string; name_en?: string | null; trials: number; mapped?: boolean; extra?: Record<string, string> };
      type Body = { by: string; matched: number; items: Row[]; meta?: { collected_at?: string; provenance?: string; mapped?: number } };
      const { value, warnings } = await call<Body>('/api/cris/aggregate', p, o);
      const items = (value.items ?? []).map((r) => ({
        key: r.key,
        name: r.name,
        ...(r.name_en ? { nameEn: r.name_en } : {}),
        trials: r.trials,
        mapped: r.mapped !== false,
        ...(r.extra ? { extra: r.extra } : {}),
      }));
      return {
        data: { by: q.by, matched: value.matched ?? 0, items, mapped: value.meta?.mapped ?? 1, provenance: value.meta?.provenance ?? '' },
        warnings: [...warnings, copyWarning(value.meta?.collected_at)],
      };
    },

    async results(_id: string, _o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      throw unsupportedError(
        `${CRIS_MIRROR_CAPABILITY.name}: 구조화된 결과 데이터를 제공하지 않습니다`,
        'ctreg registries 로 이 레지스트리가 지원하는 것을 확인하세요. 결과가 없는 것이 아니라 조회 자체가 불가능합니다.',
      );
    },
  };
}
