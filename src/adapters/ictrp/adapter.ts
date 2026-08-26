import type { AdapterResult, Capability, RegistryAdapter, SearchAxis, Warning } from '../../core/capability.js';
import type { FetchOpts, NormalizedQuery, ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError } from '../../runtime/errors.js';
import type { HttpDeps } from '../../runtime/http.js';
import { makeClient } from './client.js';
import { mapRow } from './map.js';
import { ICTRP_FILTERABLE } from './query.js';

const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });

export const ICTRP_CAPABILITY: Capability = {
  key: 'ictrp',
  name: 'WHO ICTRP',
  region: 'global (집계)',
  search: {
    condition: free('TRDS 의 조건 문자열. 동의어 처리가 ctgov 와 다르다 — 어느 쪽이 넓은지는 재지 않았다'),
    intervention: free('중재 문자열'),
    title: free('공개 제목'),
    lead: free('주 스폰서만 본다 — 공동 스폰서 자리가 폼에 없다'),
    id: free('Secondary ID 를 포함 검색한다. ICTRP 사본이 원 레지스트리보다 이 필드를 덜 실은 사례가 있다(표본 1건)'),
    location: free('국가만 본다 — 도시·기관 자리가 없다'),
    status: {
      supported: true,
      values: ICTRP_FILTERABLE.status,
      exhaustive: false,
      scope: '모집중인지 아닌지 둘뿐이다 — 완료·중단·모집종료를 가려낼 수 없다',
    },
    phase: {
      supported: true,
      values: ICTRP_FILTERABLE.phase,
      exhaustive: false,
      scope: 'Phase 0~4. na 자리가 없어 단계를 신고하지 않은 시험은 어디에도 안 걸린다',
    },
    studyType: { supported: false, values: [], exhaustive: null, scope: '폼에 중재/관찰 구분이 없다' },
    sponsor: off('주 스폰서만 있다 — lead 로 신고한다'),
    term: off('본문 전반을 아우르는 자유 텍스트 축이 없다'),
    patient: off('없다'),
    outcomeQuery: off('없다'),
    geo: off('좌표를 받지 않는다 — 국가만 본다'),
    updatedRange: off('있는 날짜 범위는 등록일이다 — 갱신일이 아니라 다른 것을 같은 이름으로 신고하지 않는다'),
    startRange: off('있는 날짜 범위는 등록일이다 — 시험 시작일이 아니다'),
    completionRange: off('있는 날짜 범위는 등록일이다 — 완료일이 아니다'),
  },
  detail: {
    eligibilityText: { supported: false, scope: '검색 결과 화면에 없다' },
    outcomes: { supported: false, scope: '검색 결과 화면에 없다' },
    contacts: { supported: false, scope: '검색 결과 화면에 없다' },
  },
  count: { supported: true, scope: '결과 화면이 내는 시험 수(같은 시험의 여러 등록을 묶은 뒤의 수)' },
  results: { supported: false, scope: '구조화된 결과 데이터를 싣지 않는다' },
  limits: { maxPageSize: 10, ratePerSec: 1, maxBatchIds: 10 },
};

export function createIctrpAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const client = makeClient(cfg, ICTRP_CAPABILITY.limits.ratePerSec, deps);

  return {
    key: 'ictrp',
    capability: () => ICTRP_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const pageSize = ICTRP_CAPABILITY.limits.maxPageSize;
      const page = q.pageToken ? Number(q.pageToken) : 1;
      const res = await client.search(q, pageSize, page, o.cacheMode);
      // ICTRP 는 구조화된 응답이 없다 — `--raw` 의 유일한 탈출구는 결과 페이지 원문
      // 그 자체다. `mapRow` 는 행 단위 매핑만 맡으므로(o.raw 를 모른다) 여기서 덧붙인다.
      const data = res.page.rows.map((row) => {
        const rec = mapRow(row, res.fetchedAt);
        return o.raw ? { ...rec, source: res.raw } : rec;
      });
      const nextPageToken = page * pageSize >= res.page.records ? undefined : String(page + 1);

      const warnings: Warning[] = [...res.warnings];
      /**
       * `applyLimits`(guard.ts) 는 요청이 상한을 **넘을 때만** 경고한다(`page_size_clamped`)
       * — 상한보다 **작게** 요청했을 때는 그 함수의 소관 밖이고, 보통은 문제도 아니다
       * (그보다 적게 받으면 그만이다). 그런데 이 레지스트리는 pageSize 를 실제로 받지
       * 않고 언제나 고정 크기를 낸다(query.ts — `ddlPageSize` 를 실으면 0건이 된다).
       * 그래서 작게 요청했는데 실제로 더 많이 돌아오면, 사용자의 축소 요청이 조용히
       * 무시된 자리다. `page_size_clamped` 와 방향이 반대이므로 다른 코드를 쓴다 —
       * 그쪽은 guard.ts 가 이미 안다.
       */
      if (q.pageSize !== undefined && q.pageSize < pageSize && data.length > q.pageSize) {
        warnings.push({
          code: 'page_size_floor',
          message:
            `요청한 페이지 크기 ${q.pageSize} 보다 많은 ${data.length}건이 돌아왔습니다 — ` +
            `WHO ICTRP 의 결과 페이지는 언제나 ${pageSize}건입니다(더 작게는 받을 수 없습니다).`,
          at: pageSize,
          registry: 'ictrp',
        });
      }

      return { data, warnings, total: res.page.trials, ...(nextPageToken ? { nextPageToken } : {}) };
    },

    async get(_ids: string[], _o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      throw unsupportedError(
        'ICTRP 는 ID 로 개별 시험을 조회할 수 없습니다',
        'ctreg search --registry ictrp 로 검색해 원하는 시험을 찾으세요.',
      );
    },

    async results(_id: string, _o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      throw unsupportedError(
        'ICTRP 는 구조화된 결과 데이터를 제공하지 않습니다',
        'ICTRP 결과 화면에는 평가변수·이상반응 같은 구조화된 결과가 없습니다.',
      );
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const res = await client.search(q, 1, 1, o.cacheMode);
      return { data: res.page.trials, warnings: res.warnings };
    },
  };
}
