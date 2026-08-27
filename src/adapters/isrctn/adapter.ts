import type { AdapterResult, Capability, RegistryAdapter, SearchAxis, Warning } from '../../core/capability.js';
import { CAPS, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { formatTrialId, parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError } from '../../runtime/errors.js';
import type { HttpDeps } from '../../runtime/http.js';
import { makeClient } from './client.js';
import { mapTrial } from './map.js';
import { buildIdsQuery, buildQuery, ISRCTN_FILTERABLE, pageLimit } from './query.js';
import { list } from './xml.js';

/** 자유 텍스트 축. 닫힌 어휘가 없으니 `values` 는 `null` 이고 덮개 물음도 성립하지 않는다. */
const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
/** 없는 축. 닫힌 어휘 축이 아니므로 `values` 는 `[]` 가 아니라 `null` 이다 — status 와 다르다. */
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });

/**
 * 이 선언의 `supported: false` 들이 이 어댑터에서 가장 중요한 부분이다.
 *
 * ISRCTN 은 **틀린 질의에 오류를 내지 않는다**: 모르는 필드명은 0건, 죽은 필드에 건
 * 범위 비교는 그 절이 통째로 사라져 전체를 낸다. 어느 쪽도 exit 0 이고 경고도 없으므로,
 * 축을 낙관적으로 지원한다고 신고하면 사용자는 "그런 시험이 없다" 와 "그렇게 검색할 수
 * 없다" 를 영영 구분하지 못한다. 그 구분이 이 CLI 가 존재하는 이유다.
 *
 * 그래서 여기의 모든 값은 실제로 쳐 본 결과다(docs/registry-field-survey-2026-08-22.md).
 * 축마다 무엇을 보는지·왜 껐는지는 이제 그 축의 `scope` 한 문장이 말한다. 아래는 그
 * 문장들을 뒷받침하는 **실측과 출처** 로, 한 문장에 담기지 않는 것만 남긴다:
 * - `status` — `trialStatus`(문서 3.2.1.1)와 `recruitmentStatus`(3.2.1.13)는 문서에 값
 *   목록까지 있는데 **모든 값이 0건** 이다. 그래서 `values` 가 `[]` 다 — "그런 시험이
 *   없다" 가 아니라 "그렇게 물어볼 수 없다" 이고, 자유 텍스트 축의 `null` 과 다르다.
 * - `startRange` — `overallStartDate`(3.2.1.14)는 `GE 2050` 조차 레지스트리 전체를 낸다.
 *   `condition:X AND overallStartDate GE 2020` 이 `condition:X` 와 같은 건수라는 것이
 *   절이 조용히 버려진다는 증거다.
 * - `location` — `location:` 은 0건이고, 살아 있는 `recruitmentCountry` 는 국가 이름
 *   완전일치만 받는다.
 * - `id` — `isrctn:`·`isrctnNumber:`·`secondaryNumber:`·`clinicalTrialsGovNumber:` 전부
 *   0건이다. 자기 번호는 자유 텍스트로만 걸린다 — 그 경로는 `get` 이 쓴다.
 * - `lead` — `sponsorOrganisation` 하나뿐이라 `sponsor` 로만 신고한다.
 */
export const ISRCTN_CAPABILITY: Capability = {
  key: 'isrctn',
  name: 'ISRCTN',
  region: 'UK / global',
  search: {
    condition: free('질환 설명 자유 텍스트(condition 필드)'),
    intervention: free('중재 설명 자유 텍스트(intervention 필드)'),
    term: free('본문 전반의 자유 텍스트'),
    title: free('제목 필드(title) 하나. 레코드에는 공개 제목과 학술 제목이 따로 실려 나오는데 축은 하나뿐이라 둘을 갈라 물을 수 없다'),
    sponsor: free('스폰서 기관명(sponsorOrganisation) — 자금 제공자는 별개다'),
    lead: off('ISRCTN 에는 주 스폰서와 공동 스폰서를 가르는 검색 축이 없다'),
    /**
     * **필드 지정이 통하지 않는다.** 실측 2026-08-28: `contact:"Min-Gul Kim"` 과
     * `zzznonsensefield:"Min-Gul Kim"` 이 같은 1건을 냈다 — 없는 필드 이름도 같은 수를
     * 내므로 이 API 는 필드 접두사를 조용히 버리고 전체 검색으로 떨어진다(`overallStartDate`
     * 가 무시되는 것과 같은 부류). 그러면 이름이 어디에 실렸든 걸리므로 이 축이 약속하는
     * 것을 지킬 수 없다. 지원한다고 신고하면 그 순간 조용히 틀린 답이 된다.
     */
    investigator: off('필드 이름을 조용히 무시해서 연구자만 골라낼 수 없다'),
    location: off('자유 문자열 장소 축이 없다 — 살아 있는 것은 국가 이름 완전일치뿐이다. ctreg 는 이 축을 0건으로 답하지 않고 exit 3 으로 거부한다'),
    id: off('식별자 전용 축이 전부 죽어 있다 — isrctn:·secondaryNumber:·clinicalTrialsGovNumber: 모두 0건'),
    patient: off('환자 친화 문장을 받는 검색 에어리어가 없다 — 나이·성별 같은 조건을 문장으로 넘길 자리가 없다. 가장 가까운 것은 본문 전반을 훑는 term 이지만 그쪽도 글자를 맞출 뿐 적격 기준을 해석하지는 않는다'),
    outcomeQuery: free('평가변수 문구(outcomeMeasures 필드)'),
    geo: off('데이터에 좌표가 없다'),
    status: {
      supported: false, values: ISRCTN_FILTERABLE.status, exhaustive: null,
      scope: 'trialStatus·recruitmentStatus 가 문서에 값 목록까지 있으나 실측에서 전부 0건이다. 상태는 레코드에는 실려 나온다 — 받아 보고 거르는 것은 된다',
    },
    phase: {
      supported: true, values: ISRCTN_FILTERABLE.phase, exhaustive: false,
      scope: 'ISRCTN 이 신고한 단계. early_phase_1 에 해당하는 값이 어휘에 없다',
    },
    studyType: {
      supported: true, values: ISRCTN_FILTERABLE.studyType, exhaustive: false,
      scope: 'primaryStudyDesign — 중재/관찰 두 값뿐이고 확대접근 자리가 없다',
    },
    updatedRange: {
      supported: true, values: null, exhaustive: null,
      scope: '마지막 편집 시각(lastEdited)',
    },
    startRange: {
      supported: false, values: null, exhaustive: null,
      scope: 'overallStartDate 는 문서에 있으나 필터가 통째로 무시되어 전체를 돌려준다 — 0건보다 위험해서 끈다',
    },
    completionRange: {
      supported: true, values: null, exhaustive: null,
      scope: '시험 종료일(overallEndDate)',
    },
  },
  detail: {
    eligibilityText: { supported: true, scope: '포함·제외 기준을 하나의 본문으로 합쳐 낸다' },
    outcomes: { supported: true, scope: '1차·2차 평가변수 문구. 결과 수치가 아니다' },
    contacts: { supported: true, scope: '공개·과학 연락처' },
  },
  /**
   * 없는 구조를 억지로 채우면 빈 섹션이 "결과가 없다" 로 읽히므로, 아예 신고하지 않고
   * exit 3 으로 돌린다. `scope` 가 그 이유를 사용자에게도 그대로 전한다.
   */
  results: {
    supported: false,
    scope: 'ISRCTN 의 결과는 논문 링크와 첨부 PDF 다 — TrialResults 가 요구하는 구조화된 평가변수·이상반응·참가자 흐름·기저 특성이 아니다',
  },
  count: { supported: true, scope: 'default 포맷의 limit=0 응답에서 총계만 읽는다' },
  // 이 어댑터는 정렬 키를 보내지 않는다. 조용히 무시하는 대신 신고해서 exit 3 이 되게 한다.
  sort: { supported: false, scope: '결과는 업스트림이 준 순서 그대로다' },
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
