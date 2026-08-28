import type { AdapterResult, Capability, RegistryAdapter, SearchAxis, Warning } from '../../core/capability.js';
import { resolvePageSize, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError, upstreamError } from '../../runtime/errors.js';
import { getJson, type HttpDeps } from '../../runtime/http.js';
import { mapItem, type CrisItem } from './map.js';
import { buildListParams, CRIS_MAX_PAGE_SIZE, parsePageToken } from './query.js';

const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });
/** 닫힌 어휘 축을 끄는 모양은 자유 텍스트 축과 다르다 — `[]` 는 "아무 값도 못 받는다" 다. */
const closedOff = (scope: string): SearchAxis => ({ supported: false, values: [], exhaustive: null, scope });

/**
 * **이 선언은 거의 전부 `false` 다. 그것이 이 어댑터의 정직한 모습이다.**
 *
 * CRIS 자체는 조건·중재·연구책임자·모집현황으로 거를 수 있다 — 사람이 쓰는 상세검색 화면에는
 * 그 칸이 다 있다. 그러나 그 화면 뒤의 엔드포인트는 `robots.txt` 가 `Disallow: /` 로 막고 있고,
 * **자동 조회로 허락된 문은 공공데이터포털의 공식 API 하나뿐이다.** 그 API 가 받는 검색 입력은
 * `srchWord` 하나이고 내주는 항목은 16개다(2026-08-28 실측, 포털 문서와 일치).
 *
 * 그래서 여기 적힌 `false` 들은 "CRIS 가 못 한다" 가 아니라 **"허락된 문으로는 못 묻는다"** 다.
 * 둘은 다른 사실이지만 사용자에게는 결과가 같다 — 그렇게 조회할 수 없다.
 */
export const CRIS_CAPABILITY: Capability = {
  key: 'cris',
  name: 'CRIS (한국 임상연구정보서비스)',
  region: 'KR',
  search: {
    /**
     * 하나뿐인 검색 입력. 실측(2026-08-28)으로 확인한 도달 범위:
     * 당뇨병 197 · diabetes 185 · 종근당 45 · 전북대학교병원 177 · KCT0000145 1.
     */
    term: free('국문·영문 제목, 의뢰기관, 연구비지원기관, 등록번호를 한 자리에서 훑는다. 어느 필드에 걸렸는지는 응답이 말해 주지 않는다'),
    condition: off('공식 API 에 질환 필터가 없다 — 질환명을 --term 에 담으면 제목에 걸리는 만큼만 걸린다'),
    intervention: off('공식 API 에 중재 필터가 없다'),
    title: off('제목만 따로 거는 자리가 없다 — --term 이 제목도 함께 훑는다'),
    sponsor: off('의뢰기관만 따로 거는 자리가 없다 — --term 이 함께 훑는다'),
    lead: off('주 스폰서를 따로 거는 자리가 없다'),
    location: off('공식 API 에 지역 필터가 없다. 등재는 대부분 국내다'),
    id: off('등록번호로 거는 자리가 따로 없다 — get 은 --term 자리에 번호를 넣어 찾고 결과를 대조한다'),
    patient: off('환자 서술로 묻는 자리가 없다'),
    outcomeQuery: off('결과변수로 거는 자리가 없다. 목록은 주요결과변수 1개만 내준다'),
    /**
     * **원 화면에는 있지만 허락된 문에는 없다.** CRIS 상세검색에는 `charge_name`
     * (연구책임자) 칸이 있고 실제로 동작한다. 그러나 그 엔드포인트는 robots 가 막는다.
     * 공식 API 는 이 값을 **거르지도 내주지도 않는다** — 실측: `srchWord=김민걸` 0건인데
     * 같은 조건의 기관명은 177건이고, 응답 16항목에 사람 이름이 없다.
     */
    investigator: off('공식 API 가 연구자 이름을 거르지도 내주지도 않는다 — 사람 이름에 닿는 검색 입력이 없다'),
    geo: off('좌표 검색이 없다'),
    status: closedOff('모집상태가 응답 16항목에 없다 — 거를 수도, 읽을 수도 없다'),
    phase: closedOff('상 필터가 없다. 응답의 상 필드는 대체로 비어 있다(표본 200건 중 실린 값 0)'),
    studyType: closedOff('연구종류 필터가 없다 — 값은 읽어서 신고하지만 그것으로 거를 수는 없다'),
    updatedRange: off('최종갱신일로 거는 자리가 없다 — 값은 읽어 온다'),
    startRange: off('첫 대상자 등록일로 거는 자리가 없다 — 값은 읽어 온다'),
    completionRange: off('연구종료일로 거는 자리가 없다 — 값은 읽어 온다'),
  },
  detail: {
    eligibilityText: { supported: false, scope: '목록 API 에 선정·제외 기준이 없다' },
    outcomes: { supported: false, scope: '주요결과변수 1개만 문자열로 오고 구조가 없다' },
    contacts: { supported: false, scope: '연락처가 응답에 없다' },
  },
  results: { supported: false, scope: '구조화된 결과 데이터를 내주지 않는다' },
  count: { supported: true, scope: '검색어에 걸린 등록 수(totalCount). 같은 시험의 중복 등재를 묶지 않는다' },
  sort: { supported: false, scope: '정렬 키를 받지 않아 응답 순서 그대로다' },
  /**
   * 실측 2026-08-28: `numOfRows=100` 을 보내도 50개가 온다. 요청률은 문서에 초당 상한이
   * 있다고만 적혀 있고(초과 시 오류코드 23) 수치가 없어, **재지 않은 값을 지어내지 않고**
   * 보수적으로 1/s 로 둔다. 개발계정 일일 상한은 10,000 콜이다.
   */
  limits: { maxPageSize: CRIS_MAX_PAGE_SIZE, ratePerSec: 1, maxBatchIds: 1 },
};

type CrisResponse = {
  resultCode?: string;
  resultMsg?: string;
  totalCount?: number;
  items?: CrisItem[];
};

/**
 * 공공데이터포털은 실패도 **HTTP 200 + resultCode** 로 낸다. 그대로 두면 `items` 가 없는
 * 응답이 0건으로 읽힌다 — 이 CLI 가 없애려는 실패다. 정상 코드(`00`)가 아니면 던진다.
 */
function assertOk(res: CrisResponse): void {
  const code = res.resultCode;
  if (code === undefined || code === '00') return;
  const msg = res.resultMsg ?? '(메시지 없음)';
  const hint =
    code === '20' || code === '30'
      ? 'CTREG_CRIS_SERVICE_KEY 를 확인하세요 — 공공데이터포털의 일반 인증키(Decoding) 여야 합니다.'
      : code === '22' || code === '23'
        ? '공공데이터포털의 요청 한도를 넘었습니다. 개발계정은 하루 10,000 콜이고 초당 상한도 있습니다.'
        : '공공데이터포털이 낸 오류입니다. 잠시 뒤 다시 시도하거나 인증키 상태를 확인하세요.';
  throw upstreamError(`CRIS 가 오류를 반환했습니다 (${code}: ${msg})`, hint);
}

export function createCrisAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  /**
   * 키가 없을 때 **생성 시점에 던지지 않는다.** 이 어댑터는 다른 셋과 함께 만들어지므로,
   * 여기서 던지면 CRIS 를 부르지도 않은 사용자의 `ctreg search --registry ctgov` 까지
   * 같이 죽는다. 키가 필요한 것은 요청을 보낼 때다.
   */
  const requireKey = (): string => {
    const key = cfg.crisServiceKey;
    if (key === undefined || key.trim() === '') {
      throw upstreamError(
        'CRIS 인증키가 없습니다',
        '공공데이터포털에서 「질병관리청_임상연구 DB」 활용신청(자동승인) 후 받은 일반 인증키를 ' +
          'CTREG_CRIS_SERVICE_KEY 에 넣으세요. 이 레지스트리만 키가 필요하고 나머지는 그대로 동작합니다.',
      );
    }
    return key.trim();
  };

  const call = async (
    params: Record<string, string | number>,
    o: { cacheMode: FetchOpts['cacheMode'] },
  ): Promise<{ value: CrisResponse; fetchedAt: string; warnings: Warning[] }> => {
    const r = await getJson<CrisResponse>(
      cfg,
      {
        registry: 'cris',
        baseUrl: cfg.crisBaseUrl,
        path: '/list',
        params,
        // 인증키가 사람이 읽는 실패 메시지로 새지 않게 한다.
        redactParams: ['serviceKey'],
        cacheMode: o.cacheMode,
        ratePerSec: CRIS_CAPABILITY.limits.ratePerSec,
      },
      deps,
    );
    assertOk(r.value);
    return { value: r.value, fetchedAt: r.fetchedAt, warnings: r.warnings };
  };

  /**
   * `raw` 는 **그 레코드의 원문 항목** 을 싣는다. 응답 전체를 싣지 않는 이유는, 한 쪽에
   * 50건이 오므로 레코드마다 전체를 복사하면 페이로드가 50배가 되기 때문이다.
   * 이 API 는 레코드 단위가 그 자체로 완결된 객체라 그렇게 나눌 수 있다.
   */
  const toRecords = (res: CrisResponse, fetchedAt: string, raw: boolean): TrialRecord[] =>
    (res.items ?? [])
      // 등록번호가 없는 항목은 레코드로 만들 수 없다. 지어내는 대신 버리고,
      // 버린 사실은 아래에서 경고로 낸다.
      .filter((it) => (it.trial_id ?? '').trim() !== '')
      .map((it) => {
        const rec = mapItem(it, fetchedAt);
        return raw ? { ...rec, source: it } : rec;
      })
      .filter((r) => r.title !== '');

  return {
    key: 'cris',
    capability: () => CRIS_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const key = requireKey();
      const pageSize = resolvePageSize(q);
      const page = parsePageToken(q.pageToken);
      const params = { ...buildListParams(q, key, pageSize), pageNo: page };

      const { value, fetchedAt, warnings: w } = await call(params, o);
      const warnings: Warning[] = [...w];
      const data = toRecords(value, fetchedAt, o.raw);

      const raw = (value.items ?? []).length;
      if (raw > data.length) {
        warnings.push({
          code: 'records_dropped',
          message: `${raw}건 중 ${raw - data.length}건은 등록번호나 제목이 없어 레코드로 만들지 못했습니다.`,
          registry: 'cris',
        });
      }

      const total = value.totalCount ?? 0;
      const seen = (page - 1) * Math.min(pageSize, CRIS_MAX_PAGE_SIZE) + raw;
      const nextPageToken = seen < total ? String(page + 1) : undefined;

      return { data, warnings, total, ...(nextPageToken ? { nextPageToken } : {}) };
    },

    /**
     * `get` 은 등록번호를 `srchWord` 에 넣고 **돌아온 것을 대조한다.** 이 API 에는 ID 로
     * 한 건을 집는 자리가 없어서 검색으로 대신하는데, 검색은 번호를 부분 일치로도 물 수
     * 있으므로 대조 없이 첫 건을 내면 다른 시험을 그 시험이라고 내놓게 된다.
     */
    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const key = requireKey();
      const warnings: Warning[] = [];
      const data: TrialRecord[] = [];

      for (const id of ids) {
        const { registryId } = parseTrialId(id);
        const { value, fetchedAt, warnings: w } = await call(
          { serviceKey: key, resultType: 'json', srchWord: registryId, numOfRows: CRIS_MAX_PAGE_SIZE, pageNo: 1 },
          o,
        );
        warnings.push(...w);
        const hit = toRecords(value, fetchedAt, o.raw).find((r) => r.registryId.toUpperCase() === registryId.toUpperCase());
        if (hit === undefined) {
          warnings.push({ code: 'not_found', message: `${CRIS_CAPABILITY.name} 에서 찾지 못했습니다.`, id });
          continue;
        }
        data.push(hit);
      }
      return { data, warnings };
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const key = requireKey();
      // 건수만 필요하므로 한 쪽만 받는다. totalCount 는 쪽 크기와 무관하다.
      const params = { ...buildListParams(q, key, 1), numOfRows: 1 };
      const { value, warnings } = await call(params, o);
      return { data: value.totalCount ?? 0, warnings };
    },

    async results(_id: string, _o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      throw unsupportedError(
        `${CRIS_CAPABILITY.name}: 구조화된 결과 데이터를 제공하지 않습니다`,
        'ctreg registries 로 이 레지스트리가 지원하는 것을 확인하세요. 결과가 없는 것이 아니라 조회 자체가 불가능합니다.',
      );
    },
  };
}
