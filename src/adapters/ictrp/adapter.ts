import type { AdapterResult, Capability, RegistryAdapter, SearchAxis, Warning } from '../../core/capability.js';
import type { FetchOpts, NormalizedQuery, ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { formatTrialId, parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError, usageError } from '../../runtime/errors.js';
import type { HttpDeps } from '../../runtime/http.js';
import { makeClient } from './client.js';
import { mapRecord, mapRow } from './map.js';
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
    /**
     * 필드테스트 실측(2026-08-26): 국가 세 개로 각각 걸어도 세 번 다 걸지 않은
     * 기준선(1,148,325건)과 정확히 같은 수가 나왔다 — 조건절이 서버까지 가지 않았다는
     * 뜻이다. 원인: `txtFreeCountry` 는 입력칸일 뿐이고, 그 값이 실제 필터로 쓰이는
     * `lstCountriesSelected` 로 옮겨지려면 별도의 `butAdd` postback 이 필요하다
     * (`AdvSearch.aspx` 의 폼 구조). `buildForm` 은 텍스트칸만 채우고 그 postback 을
     * 하지 않으므로, 이 필드는 채워도 아무 효과가 없다 — ISRCTN 의 죽은 필드들과
     * 같은 모양이라 같은 이유로 끈다: 조용히 전체를 돌려주는 축을 지원한다고 신고할
     * 수 없다. 다시 켜려면 `butAdd` 왕복(폼에 국가를 채우고 그 버튼으로 postback 해
     * `lstCountriesSelected` 에 실제로 들어가는지 확인)을 구현하고 실측으로 증명해야
     * 한다 — 별도 작업으로 남겨 둔다.
     */
    location: free('나라만 본다 — 도시·기관 자리가 없다. 포털이 가진 표기(폼의 199개 목록)만 받고 ' +
      '그 밖의 이름은 exit 3 으로 거절한다: 비표준 표기는 오류도 0건도 아니라 조용히 좁혀진 수를 ' +
      '내기 때문이다(실측 2026-08-26: South Korea 94건 vs Korea, Republic of 713건). 목록은 요청 ' +
      '시점에 폼 페이지에서 읽으므로 포털이 나라를 더하면 따라간다. 나라를 쓰면 요청이 하나 는다 ' +
      '— butAdd 왕복으로 선택 목록에 옮겨야 필터가 실제로 걸린다(그 왕복이 없으면 죽는다: 실측 ' +
      '36,264건 → 왕복 후 Japan 2,981건)'),
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

/**
 * 이 레지스트리의 페이지 토큰은 불투명 커서가 아니라 **페이지 번호** 다(설계 §3.2 —
 * ViewState 는 11.7KB 이상이라 봉투에 실을 수 없어 번호를 토큰으로 쓴다). 토큰이 사람이
 * 읽고 쓸 수 있는 모양이라는 것은, 다른 레지스트리의 토큰이나 손으로 지어낸 값이 그대로
 * 들어올 수 있다는 뜻이기도 하다 — 그리고 `Number()` 는 그것들을 **조용히** 삼킨다:
 *
 * - ctgov 모양의 `'CAESBnNvbWV0'` → `NaN` → 1페이지가 나가고 `nextPageToken` 이 `"NaN"`.
 *   토큰을 따라가는 호출자는 1페이지를 영원히 되풀이한다.
 * - `'0'` → 1페이지, 다음 토큰 `"1"`. `'-3'` → 1페이지, 다음 토큰 `"-2"`.
 * - `'2.7'` → 2페이지 행들이 `2.7` 페이지인 양 나가고 다음 토큰은 `"3.7"`.
 *
 * 넷 다 경고 없이 exit 0 이었다. 인자 자체가 성립하지 않는 경우이므로 exit 2(usage)로
 * 낸다 — 요청 전에 멈춘다. 빈 값과 없는 값은 종전대로 1페이지다(토큰 없이 첫 페이지).
 */
function parsePageToken(token: string | undefined): number {
  if (token === undefined || token === '') return 1;
  const n = Number(token);
  // 정규식으로 모양부터 본다: `Number()` 는 `' 2 '`·`'2.0'`·`'0x2'` 를 전부 받아들인다.
  if (!/^\d+$/.test(token) || !Number.isSafeInteger(n) || n < 1) {
    throw usageError(
      `ICTRP 의 페이지 토큰은 1 이상의 정수여야 합니다: '${token}'`,
      'ICTRP 는 불투명 커서를 주지 않아 페이지 번호를 그대로 토큰으로 씁니다 — ' +
        '첫 페이지는 --page-token 없이 조회하고, 그 다음부터는 앞선 응답의 nextPageToken 을 ' +
        '그대로 넘기세요. 다른 레지스트리의 토큰은 여기서 쓸 수 없습니다.',
    );
  }
  return n;
}

export function createIctrpAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const client = makeClient(cfg, ICTRP_CAPABILITY.limits.ratePerSec, deps);

  return {
    key: 'ictrp',
    capability: () => ICTRP_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const pageSize = ICTRP_CAPABILITY.limits.maxPageSize;
      const page = parsePageToken(q.pageToken);
      const res = await client.search(q, pageSize, page, o.cacheMode);
      // ICTRP 는 구조화된 응답이 없다 — `--raw` 의 유일한 탈출구는 결과 페이지 원문
      // 그 자체다. `mapRow` 는 행 단위 매핑만 맡으므로(o.raw 를 모른다) 여기서 덧붙인다.
      const data = res.page.rows.map((row) => {
        const rec = mapRow(row, res.fetchedAt);
        return o.raw ? { ...rec, source: res.raw } : rec;
      });
      /**
       * 토큰은 **갈 수 있는 곳만** 가리킨다. 남은 레코드가 있느냐(`records`)와 다음
       * 페이지에 도달할 수 있느냐(`nextPageReachable`)는 다른 사실이고, 앞의 것만 보고
       * 토큰을 찍어내면 그 사슬을 따라간 호출자는 결과 화면의 페이저 창 밖으로 걸어 나가
       * 요청한 것과 다른 페이지를 받는다(client.ts 참고). 잘못된 곳으로 데려가는 토큰은
       * 없는 토큰보다 나쁘다.
       */
      const moreRecords = page * pageSize < res.page.records;
      const nextPageToken = moreRecords && res.nextPageReachable ? String(page + 1) : undefined;

      const warnings: Warning[] = [...res.warnings];
      if (moreRecords && !res.nextPageReachable) {
        // 토큰을 그냥 빼기만 하면 "이게 전부다" 로 읽힌다 — 남은 게 있는데 여기서
        // 멈춘다는 사실 자체를 말한다. 종료 코드는 바꾸지 않는다(오류가 아니다).
        warnings.push({
          code: 'pagination_depth_limit',
          message:
            `${res.page.records}건 중 ${page}페이지까지만 넘길 수 있습니다 — ` +
            'WHO ICTRP 는 커서를 주지 않고 결과 화면의 페이저 링크로만 페이지를 넘기는데, ' +
            '그 화면이 여기서 다음 페이지 링크를 내지 않았습니다. 질의를 더 좁혀 나눠 조회하세요.',
          at: page,
          registry: 'ictrp',
        });
      }
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
          // 이 응답이 몇 건을 실었는지(`data.length`)를 "언제나 10건" 처럼 고정값으로
          // 단정하면 안 된다 — 전체가 10건보다 적은 질의(예: 실제로 4건뿐인 질의)에서는
          // 이 문구가 그 응답 자체와 어긋나는 거짓이 된다. 그래서 이 응답이 실제로 낸
          // 건수(data.length)와, 고정인 것은 "페이지 크기 상한(10)" 뿐이라는 메커니즘을
          // 나눠 말한다 — 트리거(`data.length > q.pageSize`)는 그대로 두고 문장만 고쳤다.
          message:
            `${q.pageSize}건을 요청했는데 ${data.length}건이 돌아왔습니다 — ` +
            `WHO ICTRP 는 페이지 단위로만 결과를 내고 그 페이지 크기가 ${pageSize}건으로 고정돼 ` +
            '있어, 더 작게 요청해도 그보다 작게 받을 수 없습니다.',
          at: pageSize,
          registry: 'ictrp',
        });
      }

      return { data, warnings, total: res.page.trials, ...(nextPageToken ? { nextPageToken } : {}) };
    },

    /**
     * ICTRP 에 배치 엔드포인트가 없다 — **ID 하나당 요청 하나** 이고 `ratePerSec: 1` 이라
     * 10개를 조회하면 10초쯤 걸린다. `maxBatchIds` 가 10인 이유가 그것이다.
     *
     * 레코드 페이지는 검색 결과 행보다 충실하다(TRDS 24항목). 특히 **상태가 이진이
     * 아니다** — 같은 시험이 `search` 로 오면 `recruiting`/`other` 이고 여기서는
     * 레지스트리가 신고한 값 그대로다. 경로에 따라 충실도가 다른 것은 사실이고 README 가
     * 그것을 말한다.
     *
     * 내용 없는 껍데기 페이지는 `not_found` 로 신고하고 레코드를 만들지 않는다 —
     * ctgov 가 배치에서 빠진 ID 를 다루는 것과 같은 자리다.
     */
    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const data: TrialRecord[] = [];
      const warnings: Warning[] = [];
      for (const id of ids) {
        const { registryId } = parseTrialId(id);
        const res = await client.record(registryId, o.cacheMode);
        warnings.push(...res.warnings);
        if (res.record === undefined) {
          warnings.push({
            code: 'not_found',
            message: 'WHO ICTRP 에서 찾지 못했습니다 — 그 ID 의 레코드 화면이 비어 있습니다.',
            id: formatTrialId('ictrp', registryId),
          });
          continue;
        }
        const rec = mapRecord(res.record, registryId, res.fetchedAt, o.caps.locations);
        if ((rec.locationsTotal ?? 0) > (rec.locations?.length ?? 0)) {
          warnings.push({
            code: 'locations_truncated',
            message:
              `이 시험의 모집 국가 ${rec.locationsTotal}곳 중 ${rec.locations!.length}곳만 담았습니다. ` +
              '전부 받으려면 --include locations 로 캡을 올리세요.',
            id: rec.id,
            at: rec.locations!.length,
          });
        }
        data.push(o.raw ? { ...rec, source: res.raw } : rec);
      }
      return { data, warnings };
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
