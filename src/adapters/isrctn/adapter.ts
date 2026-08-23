import type { AdapterResult, Capability, RegistryAdapter, Warning } from '../../core/capability.js';
import { CAPS, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { formatTrialId, parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError } from '../../runtime/errors.js';
import type { HttpDeps } from '../../runtime/http.js';
import { makeClient } from './client.js';
import { mapTrial } from './map.js';
import { buildIdsQuery, buildQuery, pageLimit } from './query.js';
import { list } from './xml.js';

/**
 * 이 선언의 `false` 들이 이 어댑터에서 가장 중요한 부분이다.
 *
 * ISRCTN 은 **틀린 질의에 오류를 내지 않는다**: 모르는 필드명은 0건, 죽은 필드에 건
 * 범위 비교는 그 절이 통째로 사라져 전체를 낸다. 어느 쪽도 exit 0 이고 경고도 없으므로,
 * 축을 낙관적으로 `true` 라고 신고하면 사용자는 "그런 시험이 없다" 와 "그렇게 검색할 수
 * 없다" 를 영영 구분하지 못한다. 그 구분이 이 CLI 가 존재하는 이유다.
 *
 * 그래서 여기의 모든 값은 실제로 쳐 본 결과다(docs/registry-field-survey-2026-08-22.md).
 * 문서에 있으나 죽은 것은 전부 false 다:
 * - `status` — `trialStatus`(문서 3.2.1.1)와 `recruitmentStatus`(3.2.1.13)가 문서에 값
 *   목록까지 있지만 **모든 값이 0건** 이다. 레코드에는 그 값이 들어 있는데도 그렇다.
 * - `startRange` — `overallStartDate`(3.2.1.14)는 필터가 아예 무시된다. `GE 2050` 도
 *   레지스트리 전체를 낸다. `condition:X AND overallStartDate GE 2020` 이
 *   `condition:X` 와 같은 건수라는 것이 증거다 — 절이 조용히 버려진다.
 * - `location` — `location:` 은 0건이고, 살아 있는 `recruitmentCountry` 는 국가 이름
 *   완전일치만 받는다. 자유 문자열 장소를 거기 넣으면 "서울" 이 0건으로 돌아온다.
 * - `id` — `isrctn:`·`isrctnNumber:`·`secondaryNumber:`·`clinicalTrialsGovNumber:` 전부
 *   0건이다. 자기 번호는 자유 텍스트로만 걸린다(그 경로는 `get` 이 쓴다).
 * - `geo` — 좌표가 데이터에 없다.
 * - `lead` — ISRCTN 에는 주 스폰서와 공동 스폰서를 가르는 **검색 축** 이 없다.
 *   `sponsorOrganisation` 하나뿐이라 `sponsor` 로만 신고한다.
 */
export const ISRCTN_CAPABILITY: Capability = {
  key: 'isrctn',
  name: 'ISRCTN',
  region: 'UK / global',
  search: {
    condition: true,
    intervention: true,
    term: true,
    title: true,
    sponsor: true,
    lead: false,
    location: false,
    id: false,
    patient: false,
    outcomeQuery: true,
    geo: false,
    status: false,
    phase: true,
    studyType: true,
    updatedRange: true,
    startRange: false,
    completionRange: true,
  },
  detail: { eligibilityText: true, outcomes: true, contacts: true },
  /**
   * ISRCTN 의 `<results>` 는 논문 링크와 첨부 PDF 이지, `TrialResults` 가 요구하는
   * 구조화된 평가변수·이상반응·참가자 흐름·기저 특성이 아니다. 없는 구조를 억지로
   * 채우면 빈 섹션이 "결과가 없다" 로 읽히므로, 아예 신고하지 않고 exit 3 으로 돌린다.
   */
  results: false,
  count: true,
  limits: {
    maxPageSize: CAPS.pageSize.max,
    // API 문서가 명시적으로 요청한다 — 큰 질의는 쪼개고, 병렬화하지 말고 순차로.
    ratePerSec: 1,
    // 배치는 원문 ID 를 자유 텍스트 OR 로 잇는다(전용 ID 축이 없다). 자유 텍스트라
    // 남의 시험이 딸려올 수 있어 여유분을 두고 받아 걸러내므로, 배치를 작게 잡아야
    // 그 여유분이 페이지 상한 안에 들어온다 — get() 참고.
    maxBatchIds: 10,
  },
};

/** 자유 텍스트 배치 조회의 여유 배수. 걸러낼 것을 감안해 요청한 수보다 넉넉히 받는다. */
const ID_BATCH_SLACK = 5;

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * 시험 하나를 매핑한다. `mapTrial` 은 `trial_id` 가 없으면 던진다 — 페이지 하나에 든
 * 오염된 레코드 하나 때문에 나머지가 딸려 죽으면 안 되므로 여기서 경고로 격하한다.
 * (ctgov 어댑터의 `mapStudySafely` 와 같은 이유, 같은 모양이다.)
 */
function mapSafely(trial: unknown, o: FetchOpts, fetchedAt: string) {
  try {
    return mapTrial(trial, o, fetchedAt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      record: undefined,
      warnings: [{ code: 'trial_unmapped', message: `시험을 매핑하지 못해 건너뛰었습니다: ${message}` }] as Warning[],
    };
  }
}

export function createIsrctnAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const client = makeClient(cfg, ISRCTN_CAPABILITY.limits.ratePerSec, deps);

  const toRegistryIds = (ids: string[]) =>
    ids.map((raw) => {
      const parsed = parseTrialId(raw);
      if (parsed.registry !== 'isrctn') {
        throw unsupportedError(
          `'${raw}' 는 isrctn 어댑터가 처리할 수 없습니다`,
          'ctreg registries 로 사용 가능한 레지스트리를 확인하세요.',
        );
      }
      return parsed.registryId;
    });

  const collect = (trials: unknown[], o: FetchOpts, fetchedAt: string) => {
    const data: TrialRecord[] = [];
    const warnings: Warning[] = [];
    for (const t of trials) {
      const m = mapSafely(t, o, fetchedAt);
      if (m.record) data.push(m.record);
      warnings.push(...m.warnings);
    }
    return { data, warnings };
  };

  return {
    key: 'isrctn',
    capability: () => ISRCTN_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const built = buildQuery(q);
      const limit = pageLimit(q);
      const res = await client.who(built.q, limit, o.cacheMode);
      const { data, warnings } = collect(list(res.value.trials?.trial), o, res.fetchedAt);
      warnings.unshift(...built.warnings, ...res.warnings);

      // 총계는 다른 포맷에서 따로 읽는다 — WHO 포맷에는 totalCount 가 없다. 본문을 받지
      // 않는 80바이트 요청이라 이 한 번이 페이지 하나를 더 받는 것보다 훨씬 싸다.
      const counted = await client.total(built.q, o.cacheMode);
      warnings.push(...counted.warnings);

      if (counted.total > data.length) {
        // **ISRCTN 에는 페이지네이션 파라미터가 없다**(API 문서 3.2: `q` 와 `limit` 뿐).
        // 여기서 말하지 않으면 사용자는 다음 페이지를 요청할 방법을 찾다가, 결국 이
        // 결과가 전부라고 믿게 된다. 문서 자체가 권하는 우회로(날짜로 쪼개기)를 같이 적는다.
        warnings.push({
          code: 'no_pagination',
          message:
            `${counted.total}건 중 ${data.length}건만 받았습니다. ISRCTN API 에는 페이지 넘김 파라미터가 없어 ` +
            `나머지를 이어 받을 수 없습니다 — --page-size 를 올리거나(최대 ${ISRCTN_CAPABILITY.limits.maxPageSize}), ` +
            '--updated-since/--completion-after 로 기간을 쪼개 여러 번 조회하세요.',
          registry: 'isrctn',
          at: counted.total,
        });
      }

      // nextPageToken 을 만들지 않는다. 이 레지스트리에는 다음 페이지가 없다.
      return { data, warnings, total: counted.total };
    },

    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const registryIds = toRegistryIds(ids);
      const warnings: Warning[] = [];
      const data: TrialRecord[] = [];
      const found = new Set<string>();

      for (const batch of chunk(registryIds, ISRCTN_CAPABILITY.limits.maxBatchIds)) {
        const limit = Math.min(batch.length * ID_BATCH_SLACK, CAPS.pageSize.max);
        const res = await client.who(buildIdsQuery(batch), limit, o.cacheMode);
        warnings.push(...res.warnings);
        const trials = list(res.value.trials?.trial);

        const wanted = new Set(batch);
        const collected = collect(trials, o, res.fetchedAt);
        warnings.push(...collected.warnings);
        for (const rec of collected.data) {
          // 자유 텍스트 조회라 요청하지 않은 시험이 딸려올 수 있다 — 본문 어딘가에
          // 그 번호를 인용한 시험이 걸린다. 요청한 것만 남긴다.
          if (wanted.has(rec.registryId)) {
            data.push(rec);
            found.add(rec.registryId);
          }
        }

        if (trials.length >= limit && batch.some((id) => !found.has(id))) {
          // 응답이 상한까지 찼는데 못 찾은 ID 가 남았다면, 그 ID 가 없는 것인지 남의
          // 시험에 밀려 잘린 것인지 구별할 수 없다. not_found 로 단정하지 않는다.
          warnings.push({
            code: 'id_batch_saturated',
            message:
              `배치 응답이 상한(${limit}건)까지 찼습니다. 못 찾은 ID 가 실제로 없는 것인지 ` +
              '다른 시험에 밀려 잘린 것인지 구별할 수 없습니다 — ID 를 더 적게 나눠 다시 조회하세요.',
            registry: 'isrctn',
            at: limit,
          });
        }
      }

      for (const rid of registryIds) {
        if (!found.has(rid)) {
          warnings.push({
            code: 'not_found',
            message: 'ISRCTN 에서 찾지 못했습니다.',
            id: formatTrialId('isrctn', rid),
          });
        }
      }
      return { data, warnings };
    },

    async results(_id: string, _o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      // capability.results 가 false 이므로 CLI 는 여기까지 오지 않는다(guard.ts). 그래도
      // 빈 결과를 만들어 내지 않는 것이 이 인터페이스의 규칙이라 명시적으로 막는다.
      throw unsupportedError(
        'ISRCTN 은 구조화된 결과 데이터를 제공하지 않습니다',
        'ISRCTN 의 결과는 논문 링크와 첨부 문서 형태입니다 — ctreg get 의 --raw 로 원문을 확인하세요.',
      );
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const built = buildQuery(q);
      const res = await client.total(built.q, o.cacheMode);
      return { data: res.total, warnings: [...built.warnings, ...res.warnings] };
    },
  };
}
