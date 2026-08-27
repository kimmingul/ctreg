import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { CapabilitySchema, type Capability, type RegistryAdapter, type SearchAxis } from '../../src/core/capability.js';
import { CAPS, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../src/core/query.js';
import { TrialRecordSchema, TrialResultsSchema } from '../../src/core/record.js';
import { parseTrialId, type RegistryKey } from '../../src/core/registry.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../../src/core/vocab.js';
import { assertSupported } from '../../src/cli/guard.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { ParsedArgs } from '../../src/cli/args.js';
import { runCount } from '../../src/cli/commands/count.js';
import { runResults } from '../../src/cli/commands/results.js';
import { exitFor } from '../../src/cli/output.js';
import { CtregError } from '../../src/runtime/errors.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off', raw: false,
};

/**
 * 닫힌 어휘를 가진 세 축. 나머지 열네 축은 자유 텍스트이거나 날짜라 `values` 가
 * `null` 이다. 이 목록을 이름으로 적는 이유는 두 모양(`[]` 과 `null`)이 **다른 것을
 * 뜻하는데** 타입은 둘을 구분하지 못하기 때문이다 — 구분은 여기서만 선다.
 */
const CLOSED_VOCAB_AXES = ['status', 'phase', 'studyType'] as const;

const resultsOpts: ResultsOpts = {
  sections: ['outcomes', 'adverse', 'flow', 'baseline'],
  full: false,
  cacheMode: 'off',
};

/**
 * 어댑터 저자가 이 스위트에 제공하는 것.
 *
 * `make(fetchImpl)` 이 트랜스포트를 받는 것이 핵심이다. 이 스위트는 capability
 * *선언* 이 아니라 네 메서드의 *동작* 을 검증하기 때문에 업스트림을 흉내 낼
 * 자리가 필요하다 — 그 자리가 없으면 이 파일은 search() 가 매번 던지는 어댑터도
 * 통과시킨다(리뷰 M14 가 지적한 상태가 정확히 그것이었다). `fetch` 는 웹 표준이지
 * ctreg 내부 타입이 아니므로, HTTP 로 말하는 어떤 어댑터든 이 자리를 채울 수 있다.
 */
export type AdapterUnderTest = {
  /** 트랜스포트를 주입해 어댑터를 만든다. 주입한 트랜스포트 밖으로는 나가지 않아야 한다. */
  make(fetchImpl: typeof fetch): RegistryAdapter;
  /**
   * 요청 URL 을 받아 이 레지스트리의 업스트림이 성공 시 낼 법한 본문을 낸다.
   * 검색/배치 조회 요청에 대해서는 **적어도 시험 하나** 를 담은 응답이어야 한다 —
   * 빈 응답만 내주면 아래 검증들이 전부 공허하게 통과한다.
   */
  respond(url: string): unknown;
  /** 이 어댑터가 이해하는 접두사 포함 ID 하나 (`CTGOV:NCT03831932` 형태). */
  sampleId: string;
  /**
   * 전송 형식. 주지 않으면 `respond(url)` 을 JSON 으로 직렬화해 보낸다.
   *
   * 모든 레지스트리가 JSON 을 내지는 않는다 — ISRCTN 은 XML 만 낸다. 그런 어댑터에게
   * `respond` 하나만 주면 두 역할이 충돌한다: 이 스위트는 `respond(url)` 을 **자료
   * 구조로** 써서 `--raw` 의 source 가 원문 어딘가와 깊이 같은지 보는데, 전송에는
   * **원문 텍스트** 가 필요하다. 그래서 둘을 나눈다 — `respond` 는 원문을 자료로
   * 본 모습, `wire` 는 선으로 나가는 바이트다. 같은 픽스처에서 파생시키면 둘이
   * 어긋날 일이 없다.
   */
  wire?(url: string): { text: string; contentType: string };
  /**
   * `get()` 이 개별 ID 조회를 실제로 지원하는가. 기본 `true`.
   *
   * `Capability` 스키마에는 `get` 축이 없다 — get 미지원은 신고가 아니라 **던지는
   * 것**으로 알린다(get.ts 가 CtregError.code === 'unsupported' 를 그대로 받아
   * RegistryStatus 로 옮긴다). 이 스위트는 원래 두 어댑터(ctgov, isrctn) 만 알았고
   * 둘 다 배치 ID 조회 창구가 있어 get 이 항상 성공한다고 가정했다 — ICTRP 가 그
   * 가정을 깬 첫 사례다: 결과 화면에는 ID 로 건 배치 조회가 없고, 장소 데이터도
   * 아예 싣지 않는다. `false` 로 두면 get 이 성공한다고 가정하는 검사들(배치 분할,
   * 장소 절단, 캡 좁히기, prefix 벗기기의 get 쪽 절반)을 건너뛰고 대신 get 이
   * unsupported 로 던지는지만 확인한다.
   */
  getSupported?: boolean;
  /**
   * `q.pageSize` 가 업스트림 요청 파라미터로 전달되는가. 기본 `true`.
   *
   * ICTRP 는 예외다 — 결과 페이지 크기 컨트롤(`ddlPageSize`)이 검색 POST 에는
   * 렌더되지 않아, 그 필드를 실으면 ASP.NET 이 `__EVENTVALIDATION` 으로 거절해
   * 0건이 된다(실측, query.ts 참고). 즉 pageSize 를 흘려보내지 **않는 것** 이
   * 올바른 동작이라, `q.pageSize 가 업스트림 요청까지 간다` 검사와 정면으로
   * 충돌한다. `false` 로 두면 그 검사를 건너뛴다.
   */
  pageSizeConfigurable?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * `haystack` 안 어딘가(자기 자신, 배열 원소, 오브젝트 프로퍼티 값을 재귀적으로)에
 * `needle` 과 깊이 동등한 값이 있는지 본다. 업스트림 본문의 정확한 모양(목록이
 * `studies` 에 있는지 `results` 에 있는지 등)은 레지스트리마다 다르므로, 필드명을
 * 하드코딩하지 않고 트리 전체를 훑어 "이 조각이 원문 어딘가에서 그대로 왔는가" 를
 * 묻는다. 얕게 좁힌 source(예: `{ id }` 하나만 남긴 객체)는 원문 트리의 어떤
 * 지점과도 깊이 같을 수 없으므로 이 검사에 걸린다.
 */
function containsDeepEqual(haystack: unknown, needle: unknown): boolean {
  if (isDeepStrictEqual(haystack, needle)) return true;
  if (Array.isArray(haystack)) return haystack.some((item) => containsDeepEqual(item, needle));
  if (haystack !== null && typeof haystack === 'object') {
    return Object.values(haystack).some((v) => containsDeepEqual(v, needle));
  }
  return false;
}

/**
 * `Capability['search']` 의 키 대부분은 `NormalizedQuery` 의 필드명과 그대로 겹치지만,
 * 전부는 아니다 — `guard.ts` 의 `assertSupported` 가 실제로 무엇을 보고 축이 "쓰였다"고
 * 판단하는지가 기준이다:
 * - `geo` 는 `q.near` 를 본다(`q.geo` 라는 필드는 없다).
 * - 세 날짜 축(`updatedRange`/`startRange`/`completionRange`)은 각자 두 개씩의 날짜 필드를
 *   본다(`q.updatedRange` 같은 필드는 없다) — `{ updatedRange: 'x' }` 를 넣으면 그 필드들이 전부 `undefined` 인 채로 남아
 *   `used` 가 거짓이 되고, `assertSupported` 는 조용히 통과해 버린다. `expectExit3` 는
 *   그래서 `assertSupported` 가 안 던진 걸 `expect.unreachable` 로 잡는데, 그 에러엔
 *   `.exit` 이 없어 `expected undefined to be 3` 이라는 무의미한 메시지로 떨어진다 —
 *   관문이 진짜로 미지원인 축을 놓친 게 아니라, 이 스위트의 프로브가 애초에 그 축을
 *   건드리지 못한 것이었다.
 * 나머지 축(`condition`, `status`, `phase` 등)은 이름이 그대로 겹치므로 `{[axis]:'x'}`
 * 로 충분하다.
 */
const probeFor = (axis: keyof Capability['search']): NormalizedQuery => {
  switch (axis) {
    case 'geo':
      return { near: { lat: 0, lon: 0 } };
    case 'updatedRange':
      return { updatedSince: 'x' };
    case 'startRange':
      return { startAfter: 'x' };
    case 'completionRange':
      return { completionAfter: 'x' };
    default:
      return { [axis]: 'x' } as NormalizedQuery;
  }
};

const argsFor = (key: RegistryKey, over: Partial<ParsedArgs> = {}): ParsedArgs => ({
  command: 'count',
  positionals: [],
  registries: [key],
  query: {},
  fetch: fetchOpts,
  results: resultsOpts,
  format: 'json',
  help: false,
  ...over,
});

/**
 * 새 어댑터를 만들 때 이 스위트를 통과시키는 것이 계약 준수의 정의다.
 * 두 번째 레지스트리는 여기에 한 줄(`runAdapterContract('isrctn', …)`)을 더하면 된다.
 */
export function runAdapterContract(name: string, under: AdapterUnderTest): void {
  const stub = (respond: (url: string) => Response) => {
    const calls: string[] = [];
    /**
     * URL 과 본문을 함께 남긴다. 접두사 유출 검사(아래 I5)는 어댑터가 ID 를 질의
     * 문자열에 싣든 POST 본문에 싣든 똑같이 걸어야 하는데, URL 만 보면 본문으로
     * 보내는 어댑터에게는 검사가 공허해진다.
     */
    const requests: { url: string; body: string }[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push(String(url));
      requests.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : '' });
      return respond(String(url));
    }) as unknown as typeof fetch;
    return { adapter: under.make(fetchImpl), calls, requests };
  };
  const ok = () =>
    stub((url) => {
      const w = under.wire?.(url);
      return w
        ? new Response(w.text, { status: 200, headers: { 'content-type': w.contentType } })
        : json(under.respond(url));
    });
  /** 재시도 대상이 아닌 상태코드를 골랐다 — 백오프 없이 즉시 실패 경로로 간다. */
  const broken = () => stub(() => json({ message: 'Unknown sort field' }, 400));

  const makeAdapter = () => ok().adapter;

  describe(`어댑터 계약: ${name}`, () => {
    // --- 선언 ---

    it('capability 선언이 스키마를 통과한다', () => {
      expect(() => CapabilitySchema.parse(makeAdapter().capability())).not.toThrow();
    });

    it('key 와 capability.key 가 일치한다', () => {
      const a = makeAdapter();
      expect(a.capability().key).toBe(a.key);
    });

    it('limits 는 양수다', () => {
      const l = makeAdapter().capability().limits;
      expect(l.maxPageSize).toBeGreaterThan(0);
      expect(l.ratePerSec).toBeGreaterThan(0);
      expect(l.maxBatchIds).toBeGreaterThan(0);
    });

    /**
     * get() 은 배치 하나당 요청을 딱 한 번만 보내고 그 응답을 페이지네이션하지
     * 않는다(review 발견, task-16a). CT.gov 의 filter.ids 자체는 500개 이상도
     * 받지만, buildIdsParams 가 pageSize 를 Math.min(ids.length, CAPS.pageSize.max)
     * 로 잡으므로 배치가 CAPS.pageSize.max 보다 크면 그 초과분이 요청은 됐지만
     * 응답에는 실리지 않은 채 조용히 사라진다 — get() 입장에서는 아무것도
     * 실패하지 않았으니 warnings 도 안 남는다. maxBatchIds 가 이 상한을 넘는
     * 순간 capability 의 "한 번에 N개 처리 가능" 선언이 거짓이 된다.
     */
    it('maxBatchIds 는 한 페이지로 전부 읽을 수 있는 범위를 넘지 않는다', () => {
      const l = makeAdapter().capability().limits;
      if (l.maxBatchIds > CAPS.pageSize.max) {
        expect.fail(
          `maxBatchIds(${l.maxBatchIds}) 가 CAPS.pageSize.max(${CAPS.pageSize.max}) 를 초과합니다. ` +
            `get() 은 배치당 요청을 한 번만 보내고 응답을 페이지네이션하지 않으므로, 이 값을 올리면 ` +
            `pageSize 상한을 넘는 ID 들이 조용히 응답에서 빠집니다 — 호출자는 실패 신호나 경고 없이 ` +
            `부분 결과를 전체로 오인합니다. get() 이 배치 내부 페이지네이션을 구현하기 전까지는 ` +
            `maxBatchIds 를 CAPS.pageSize.max 이하로 유지하세요.`,
        );
      }
    });

    /**
     * M2. 위 검사는 `maxBatchIds` 라는 **숫자** 가 말이 되는지만 본다 — 어댑터가 그 수를
     * 실제로 지키는지는 안 본다. 선언만 검사하면 50 을 신고하고 500개를 한 요청에 밀어
     * 넣는 어댑터가 통과하고, 그 초과분은 업스트림에서 조용히 잘린다(경고도, 실패도 없다).
     *
     * 그래서 상한보다 하나 많은 ID 를 주고 **나간 요청들** 을 센다. 두 가지를 묻는다:
     * 어떤 요청도 상한보다 많은 ID 를 싣지 않았는가, 그리고 요청한 ID 가 하나도 빠지지
     * 않고 어딘가에는 실렸는가. 뒤쪽이 없으면 초과분을 그냥 버리는 어댑터가 통과한다.
     *
     * 표본 ID 의 끝자리를 바꿔 합성한다 — 존재하지 않는 시험이어도 상관없다. 여기서
     * 보는 것은 응답이 아니라 **요청이 어떻게 나뉘었는가** 이기 때문이다.
     */
    (under.getSupported === false ? it.skip : it)(
      'maxBatchIds 를 넘는 ID 는 실제로 나눠 보낸다 — 숫자를 신고하는 것과 지키는 것은 다르다',
      async () => {
      const cap = makeAdapter().capability();
      const limit = cap.limits.maxBatchIds;
      const { registry, registryId } = parseTrialId(under.sampleId);
      const width = String(limit + 1).length;
      // 끝자리만 바꾼다 — 접두사와 자릿수가 유지돼야 parseTrialId 가 같은 레지스트리로 라우팅한다.
      const ids = Array.from({ length: limit + 1 }, (_, i) =>
        `${registry.toUpperCase()}:${registryId.slice(0, -width)}${String(i).padStart(width, '0')}`,
      );
      const bare = ids.map((id) => parseTrialId(id).registryId.toLowerCase());
      // 합성이 제대로 됐는지 먼저 못박는다 — 중복이 섞이면 아래 계수가 전부 무의미해진다.
      expect(new Set(bare).size, `합성한 ID 가 서로 다르지 않습니다: ${bare.slice(0, 3).join(', ')}…`).toBe(ids.length);

      const { adapter, requests } = ok();
      await adapter.get(ids, fetchOpts);
      expect(requests.length, 'get 이 업스트림 요청을 보내지 않았습니다.').toBeGreaterThan(0);

      const seen = new Set<string>();
      for (const r of requests) {
        const hay = `${r.url} ${r.body}`.toLowerCase();
        const carried = bare.filter((b) => hay.includes(b));
        carried.forEach((b) => seen.add(b));
        expect(
          carried.length,
          `요청 하나가 ID 를 ${carried.length}개 실었는데 capability 의 maxBatchIds 는 ${limit} 입니다. ` +
            '업스트림은 상한을 넘은 ID 를 실패가 아니라 침묵으로 처리하므로, 호출자는 부분 결과를 ' +
            '전체로 오인합니다 — get() 에서 ID 를 maxBatchIds 크기로 나누세요.',
        ).toBeLessThanOrEqual(limit);
      }

      const dropped = bare.filter((b) => !seen.has(b));
      expect(
        dropped,
        `요청한 ID ${dropped.length}개가 어떤 요청에도 실리지 않았습니다: ${dropped.slice(0, 3).join(', ')}…. ` +
          '상한을 넘는 ID 를 나누지 않고 버리면 조회 자체가 조용히 부분 조회가 됩니다.',
      ).toEqual([]);
    },
    );

    /**
     * 신고해 놓고 거부하는 어댑터를 잡는다. **이 검사를 쓰기 직전까지 ISRCTN 이
     * 정확히 그랬다** — phase 어휘에 early_phase_1 자리가 없어 `buildQuery` 가 거부하는데
     * 선언에는 그 사실이 없었다. 신고와 구현이 어긋나면 사용자는 부딪혀야만 안다.
     *
     * (그 거부가 사용자에게 **어떤 종료 코드로** 도착하는지는 이 검사의 관심이 아니다.
     * 지금은 가드가 먼저 서서 exit 3 이다 — 예전 주석이 "exit 2" 라고 적었던 것은
     * `buildQuery` 가 던지는 오류 객체의 필드였지 프로세스 코드가 아니었다.)
     *
     * `supported: false` 인 축은 건너뛴다 — 그 축은 애초에 `buildQuery` 가 읽지
     * 않으므로 값 하나만 실어 보내면 "검색 조건이 적어도 하나 필요합니다" 같은,
     * 진짜 문제(죽은 축에 값이 남아 있다)와 무관한 메시지로 실패한다. 그 문제는
     * 아래 '지원하지 않는 축은 values 가 비어 있다' 가 정확히 짚는다 — 한 실수에
     * 신호 하나씩만 나가야 한다.
     *
     * 한계: `ok()` 의 스텁은 질의 내용과 무관하게 같은 픽스처로 응답하므로, 이
     * 검사는 신고한 값이 `buildQuery`/매핑에서 **던지지 않는다** 는 것만 증명한다.
     * `phase_2` 를 `phase_3` 업스트림 토큰에 매핑하는 것처럼 문법적으로는 멀쩡한
     * 오매핑은 잡지 못한다 — 값별 요청 내용까지 단언하는 것은 이 검사의 범위 밖이다.
     */
    it('신고한 values 는 전부 실제로 질의로 조립된다', async () => {
      const cap = makeAdapter().capability();
      const axes: [string, SearchAxis, (v: string) => NormalizedQuery][] = [
        ['status', cap.search.status, (v) => ({ status: [v as never] })],
        ['phase', cap.search.phase, (v) => ({ phase: [v as never] })],
        ['studyType', cap.search.studyType, (v) => ({ studyType: v as never })],
      ];
      for (const [axis, decl, probe] of axes) {
        if (!decl.supported) continue; // 죽은 축의 값은 아래 검사의 몫이다
        for (const v of decl.values ?? []) {
          const { adapter } = ok();
          await expect(
            adapter.search(probe(v), fetchOpts),
            `'${axis}' 에 '${v}' 를 신고해 놓고 그 값으로 검색하면 실패합니다 — ` +
              '선언과 구현이 어긋나면 사용자는 부딪혀야만 알게 됩니다.',
          ).resolves.toBeDefined();
        }
      }
    });

    /**
     * `supported: false` 인데 `values` 에 뭔가 들어 있으면 두 선언이 서로를 부정한다.
     * 읽는 쪽은 어느 쪽을 믿어야 할지 알 수 없다.
     *
     * 기대하는 빈 값이 축 종류마다 다르다 — 닫힌 어휘 축은 `[]`, 자유 텍스트 축은
     * `null` 이다. 이전 판은 `values ?? []` 로 둘을 하나로 뭉갰고, 그래서 닫힌 어휘
     * 축에 `null` 을 적어도 통과했다. `off()` 헬퍼가 바로 그 `null` 을 만든다.
     */
    it('지원하지 않는 축은 values 가 비어 있다', () => {
      const cap = makeAdapter().capability();
      for (const [name, axis] of Object.entries(cap.search) as [string, SearchAxis][]) {
        if (axis.supported) continue;
        const empty = (CLOSED_VOCAB_AXES as readonly string[]).includes(name) ? [] : null;
        expect(
          axis.values,
          `'${name}' 은 supported:false 인데 values 가 ${JSON.stringify(empty)} 가 아닙니다`,
        ).toEqual(empty);
        expect(axis.exhaustive, `'${name}' 은 supported:false 인데 exhaustive 가 null 이 아닙니다`).toBeNull();
      }
    });

    /**
     * `null` 은 **자유 텍스트 축의 모양** 이다 — "닫힌 어휘가 없다, 아무 문자열이나
     * 받는다". 닫힌 어휘 축에 그것을 적으면 "그 축으로 무엇을 물어볼 수 있는지" 가
     * 신고에서 통째로 사라지고, 읽는 쪽은 정반대의 결론을 낸다.
     *
     * 위 검사만으로는 못 잡는다: 그쪽은 `supported: false` 인 축만 본다. 여기서는
     * `supported` 와 무관하게 본다 — 함정이 한 줄 옆에 있기 때문이다. ISRCTN 어댑터의
     * `off()` 헬퍼가 `values: null` 을 만들고, `status` 가 그 헬퍼를 안 쓴 것은
     * 손으로 적었기 때문일 뿐 구조가 막아 준 것이 아니다.
     */
    it('닫힌 어휘 축은 supported 와 무관하게 values 가 배열이다', () => {
      const cap = makeAdapter().capability();
      for (const name of CLOSED_VOCAB_AXES) {
        expect(
          Array.isArray(cap.search[name].values),
          `'${name}' 은 닫힌 어휘 축인데 values 가 ${JSON.stringify(cap.search[name].values)} 입니다 — ` +
            'null 은 "닫힌 어휘가 없다" 는 자유 텍스트 축의 뜻이라, 읽는 쪽이 정반대로 해석합니다.',
        ).toBe(true);
      }
    });

    /**
     * **지원되는** 닫힌 어휘 축은 덮개를 신고해야 한다.
     *
     * 위 두 검사는 `values` 의 모양만 본다. `exhaustive` 쪽은 `supported: false` 인 축이
     * `null` 인지만 검사받고 있었고(바로 위 '지원하지 않는 축은 values 가 비어 있다'),
     * **지원되는** 축이 `null` 을 신고하는 것은 아무도 막지 않았다.
     *
     * 왜 무는가 — `null` 은 세 소비자에게서 전부 조용히 통과한다:
     * 가드는 `exhaustive === false` 만 보므로 `vocab_excludes_missing` 이 침묵하고,
     * 필드테스트는 실측이 판정 불가일 때 `compareDeclared(null, null)` 로 ⚠️ 불확정
     * 통과이며, 남는 것은 **exit 0 의 조용한 축소** 다 — 이 CLI 가 없애려는 실패 그 자체.
     * 실측이 항상 `null` 인 축(ctgov `phase` 는 overlapping 이라 판정 불가다)에서는
     * 어느 소비자도 이것을 되잡아 주지 못한다.
     *
     * 자유 텍스트 축은 대상이 아니다 — 거기서 `null` 은 "닫힌 어휘가 없다" 는 옳은 신고다.
     *
     * 못 잡는 것: 이 검사는 `false`/`true` 중 **어느 쪽이 맞는지** 는 모른다. 그것은
     * 실측의 몫이고 필드테스트가 `compareDeclared` 로 대조한다. 여기서 세우는 것은
     * "판단을 내렸는가" 뿐이다.
     */
    it('지원되는 닫힌 어휘 축은 exhaustive 를 신고한다', () => {
      const cap = makeAdapter().capability();
      for (const name of CLOSED_VOCAB_AXES) {
        const axis = cap.search[name];
        if (!axis.supported) continue; // 미지원 축의 null 은 위 검사가 요구하는 값이다
        expect(
          axis.exhaustive,
          `'${name}' 은 지원되는 닫힌 어휘 축인데 exhaustive 가 null 입니다 — ` +
            'null 이면 가드도(exhaustive === false 만 본다) 필드테스트도(실측이 판정 불가면 ⚠️ 로 넘어간다) ' +
            '침묵해서, 신고한 값 밖의 시험이 조용히 사라집니다. 증명하지 못했으면 false 로 신고하세요.',
        ).not.toBeNull();
      }
    });

    /**
     * 신고한 값을 **CLI 가 받는가.** 위의 '신고한 values 는 전부 실제로 질의로
     * 조립된다' 는 `adapter.search()` 를 직접 부르므로 `parseCliArgs` 를 건너뛴다 —
     * 어댑터가 기꺼이 조립하는 값이라도 CLI 가 exit 2 로 거절하면 사용자에게는
     * 여전히 "신고해 놓고 거부한다" 이고, 그것이 이 브랜치가 고치려는 실패 그 자체다.
     *
     * ctgov 는 `*_OUT` 이 `isFilterable*` 로 걸러 파생되므로 구조적으로 면역이지만
     * ISRCTN 의 `*_OUT` 은 손으로 적은 테이블이라 면역이 아니다. 두 어댑터가 같은
     * 일에 서로 다른 규율을 쓰는 한, 그 차이를 메우는 것은 이 검사다.
     */
    it('신고한 values 는 전부 CLI 가 받는 값이다', () => {
      const cap = makeAdapter().capability();
      const accepted: Record<(typeof CLOSED_VOCAB_AXES)[number], readonly string[]> = {
        status: FILTERABLE_STATUS,
        phase: FILTERABLE_PHASE,
        studyType: FILTERABLE_STUDY_TYPE,
      };
      for (const name of CLOSED_VOCAB_AXES) {
        const strays = (cap.search[name].values ?? []).filter((v) => !accepted[name].includes(v));
        expect(
          strays,
          `'${name}' 이 신고한 값 ${strays.join(', ')} 를 CLI 가 받지 않습니다 — ` +
            `--${name === 'studyType' ? 'study-type' : name} 에 넣으면 exit 2 입니다. ` +
            '신고는 받아들여지는 값의 목록이지 어댑터가 아는 값의 목록이 아닙니다.',
        ).toEqual([]);
      }
    });

    // --- 네 메서드의 동작 ---
    //
    // 여기부터가 이 스위트의 본체다. 선언만 검사하면 search() 가 매번 던지는
    // 어댑터도 통과한다 — 어댑터 #2 의 저자가 "준수" 의 정의로 읽을 파일이므로,
    // 정의는 인터페이스를 실제로 호출해서 세워야 한다.

    it('search 는 업스트림 응답을 계약을 지키는 레코드로 낸다', async () => {
      const { adapter, calls } = ok();
      const r = await adapter.search({ condition: 'x' } as NormalizedQuery, fetchOpts);

      expect(calls.length).toBeGreaterThan(0); // 주입한 트랜스포트 밖으로 나가지 않았다
      expect(Array.isArray(r.data)).toBe(true);
      expect(r.data.length).toBeGreaterThan(0);
      for (const rec of r.data) {
        expect(() => TrialRecordSchema.parse(rec)).not.toThrow();
        expect(rec.registry).toBe(adapter.key);
        expect(rec.id).toBe(`${adapter.key.toUpperCase()}:${rec.registryId}`);
      }
      expect(Array.isArray(r.warnings)).toBe(true);
      for (const w of r.warnings) {
        expect(typeof w.code).toBe('string');
        expect(typeof w.message).toBe('string');
      }
    });

    /**
     * M3. 캡(`o.caps.*`)과 마찬가지로 페이지 크기도 **CLI 가 정하고 어댑터는 읽는다.**
     * 어댑터가 `q.pageSize` 를 무시하고 자기 기본값을 쓰면 `--page-size` 가 조용히
     * 사라지고, 사용자는 자기가 요청한 것보다 적은(또는 많은) 결과를 받는다 — 적게 받는
     * 쪽이 위험하다. 페이지가 잘렸다는 신호가 어디에도 없기 때문이다.
     *
     * 파라미터 **이름** 은 레지스트리마다 다르므로(ctgov 는 `pageSize`, ISRCTN 은 `limit`)
     * 이름을 하드코딩하지 않는다. 서로 다른 두 값으로 두 번 부르고, 각 요청이 자기 값을
     * 싣고 상대의 값은 싣지 않는지만 본다 — 값 하나만 보면 우연히 다른 파라미터와 같은
     * 수여서 통과할 수 있다.
     */
    (under.pageSizeConfigurable === false ? it.skip : it)(
      'q.pageSize 가 업스트림 요청까지 간다 — 어댑터가 자기 기본값으로 덮으면 안 된다',
      async () => {
      const carries = (reqs: { url: string; body: string }[], n: number) =>
        reqs.some((r) => [...new URL(r.url).searchParams.values()].includes(String(n)) || r.body.includes(String(n)));

      const run = async (pageSize: number) => {
        const { adapter, requests } = ok();
        await adapter.search({ condition: 'x', pageSize } as NormalizedQuery, fetchOpts);
        return requests;
      };
      // 흔한 파라미터 값(0, 1, 10, 20, 200)과 겹치지 않는 두 수를 고른다.
      const [a, b] = [13, 17];
      const ra = await run(a);
      const rb = await run(b);

      expect(carries(ra, a), `pageSize=${a} 로 불렀는데 어떤 요청도 ${a} 를 싣지 않았습니다.`).toBe(true);
      expect(carries(rb, b), `pageSize=${b} 로 불렀는데 어떤 요청도 ${b} 를 싣지 않았습니다.`).toBe(true);
      expect(
        carries(ra, b) || carries(rb, a),
        '두 요청이 서로의 페이지 크기를 싣고 있습니다 — 어댑터가 q.pageSize 를 읽지 않고 고정값을 쓰는 것으로 보입니다.',
      ).toBe(false);
    },
    );

    /**
     * `pageSizeConfigurable: false` — 위 검사는 건너뛰지만 빈 자리로 남기지 않는다.
     * `getSupported` 와 같은 규율이다: 성립하지 않는 가정을 뺐으면 실제로 무엇이
     * 일어나는지를 **다른 검사가** 못박아야 한다. 이 레지스트리는 요청한 `q.pageSize`
     * 가 아니라 자기 고정 페이지 크기(`limits.maxPageSize`)를 낸다는 것이 그 사실이다 —
     * 작은 pageSize 를 요청해도 표본 응답 크기 그대로(고정 크기만큼) 돌아와야 한다.
     * 경고가 실제로 붙는지는 어댑터마다 문구·코드가 다를 수 있어 여기서 보지 않는다 —
     * 그건 각 어댑터의 전용 테스트(ICTRP 는 `tests/adapters/ictrp/adapter.test.ts`)의 몫이다.
     */
    (under.pageSizeConfigurable === false ? it : it.skip)(
      '페이지 크기를 조절할 수 없는 레지스트리는 작은 q.pageSize 를 요청해도 고정 크기를 낸다',
      async () => {
        const cap = makeAdapter().capability();
        const { adapter } = ok();
        const r = await adapter.search({ condition: 'x', pageSize: 1 } as NormalizedQuery, fetchOpts);
        expect(
          r.data.length,
          `표본 응답이 고정 페이지 크기(${cap.limits.maxPageSize})에 못 미쳐 이 검사가 공허하게 ` +
            '통과합니다 — respond() 의 표본을 조정하세요.',
        ).toBe(cap.limits.maxPageSize);
      },
    );

    /**
     * `getSupported: false` — get 이 성공한다는 가정 위에 선 아래 검사들(배치 분할,
     * 장소 절단, 캡 좁히기) 대신, get 이 실제로 unsupported 로 던지는지만 확인한다.
     * `code` 가 'unsupported' 여야 get.ts 의 catch 가 이걸 RegistryStatus 로 옮긴다 —
     * 다른 코드로 던지면 그 자리에서 전체 커맨드가 죽는다.
     */
    if (under.getSupported === false) {
      it('get 은 미지원을 exit 3 으로 신고한다 — 빈 결과가 아니라 던진다', async () => {
        const { adapter } = ok();
        await expect(adapter.get([under.sampleId], fetchOpts)).rejects.toMatchObject({ code: 'unsupported' });
      });
    }

    (under.getSupported === false ? it.skip : it)('get 은 ID 배치를 계약을 지키는 레코드로 낸다', async () => {
      const { adapter, calls } = ok();
      const r = await adapter.get([under.sampleId], fetchOpts);

      expect(calls.length).toBeGreaterThan(0);
      expect(Array.isArray(r.data)).toBe(true);
      for (const rec of r.data) {
        expect(() => TrialRecordSchema.parse(rec)).not.toThrow();
        expect(rec.registry).toBe(adapter.key);
      }
      expect(Array.isArray(r.warnings)).toBe(true);
    });

    /**
     * 경고 배열이 있다는 사실(shape)과 실제로 경고가 들어있다는 사실(존재)은 다르다
     * — 앞의 두 테스트는 모양만 보므로, 경고를 전부 `[]` 로 버리는 어댑터도 통과한다.
     * `locationsTotal`(정규화된 스키마 필드, 레지스트리 무관) 이 `locations.length` 보다
     * 큰 레코드는 정의상 장소가 잘린 것이므로, 그런 레코드가 하나라도 있다면
     * `locations_truncated` 경고가 반드시 동반돼야 한다. 표본 응답(`under.respond`) 이
     * CAPS.locations.default 를 넘는 장소를 담은 레코드를 내지 않으면 이 검사는 아무것도
     * 확인하지 못하고 공허하게 통과하므로, 먼저 절단이 실제로 일어났는지부터 못박는다.
     */
    (under.getSupported === false ? it.skip : it)(
      '장소가 잘리면 locations_truncated 경고가 반드시 딸려온다 — 경고 배열이 있다는 것만으론 부족하다',
      async () => {
      // 캡을 1 로 낮춰서 묻는다. 예전에는 기본 캡(10)으로 물었는데, 그러면 표본이 장소를
      // 11곳 이상 담은 레지스트리에서만 이 검사가 작동한다 — 장소를 국가 단위로만 주는
      // 레지스트리(ISRCTN 은 WHO 포맷에서 모집 국가 서너 곳이 전부다)에서는 절단이 일어날
      // 수 없어 검사가 통째로 헛돌거나, 하네스를 고치라는 엉뚱한 실패가 난다. 장소가 둘만
      // 있어도 캡 1 이면 반드시 잘리므로, 이 검사는 이제 어떤 레지스트리에서도 성립한다.
      const narrow: FetchOpts = { ...fetchOpts, caps: { ...fetchOpts.caps, locations: 1 } };
      const { adapter } = ok();
      const r = await adapter.get([under.sampleId], narrow);
      const truncated = r.data.filter(
        (rec) => rec.locationsTotal !== undefined && rec.locations !== undefined && rec.locationsTotal > rec.locations.length,
      );
      expect(
        truncated.length,
        'respond() 의 표본이 장소 절단을 유발하지 않습니다 — 장소를 두 곳 이상 담은 레코드를 ' +
          '포함하도록 respond() 를 조정하세요(캡을 1 로 낮춰 물었습니다).',
      ).toBeGreaterThan(0);
      for (const rec of truncated) {
        expect(
          r.warnings.some((w) => w.code === 'locations_truncated'),
          `${rec.id} 는 장소가 잘렸는데(locationsTotal=${rec.locationsTotal}, locations=${rec.locations!.length}) locations_truncated 경고가 없습니다.`,
        ).toBe(true);
      }
    },
    );

    /**
     * I4. 위 `locations_truncated` 검사는 캡을 *무시하는* 어댑터도 잡기는 한다 —
     * 절단이 안 일어나니 `truncated.length` 가 0 이 되어서다. 그런데 그때 뜨는 말은
     * **"respond() 의 표본을 조정하세요"** 로 하네스를 가리킨다. 표본에는 이미 기본
     * 캡의 몇 배가 들어 있는데도 그렇다 — 어댑터 저자가 그 말을 따라가면 자기 버그가
     * 아니라 남의 하네스를 고치려 든다(스텁 어댑터 실험에서 실제로 그 경로를 밟았다).
     *
     * 그래서 캡 채널을 **직접** 묻는다: 같은 시험을 넓은 캡과 좁은 캡으로 두 번 받아,
     * 넓게 받으면 실제로 더 담기는 축에 대해 좁은 요청이 정확히 좁은 만큼만 담는지 본다.
     * 두 번 받는 것이 핵심이다 — 좁은 요청 하나만 보면 그 축을 아예 안 채우는 어댑터가
     * 공허하게 통과한다.
     */
    (under.getSupported === false ? it.skip : it)(
      'o.caps 를 좁히면 그만큼만 담는다 — 캡은 CLI 가 정하고 어댑터는 읽기만 한다',
      async () => {
      const NARROW = { locations: 1, eligibilityChars: 40, outcomes: 1 };
      const wide: FetchOpts = {
        ...fetchOpts,
        include: ['all'],
        caps: { locations: CAPS.locations.max, eligibilityChars: CAPS.eligibilityChars.max, outcomes: CAPS.outcomes.max },
      };
      const narrow: FetchOpts = { ...fetchOpts, include: ['all'], caps: NARROW };

      const big = (await ok().adapter.get([under.sampleId], wide)).data;
      const small = (await ok().adapter.get([under.sampleId], narrow)).data;
      expect(big.length, 'get 이 sampleId 로 아무 레코드도 내지 않아 캡을 검사할 수 없습니다.').toBeGreaterThan(0);

      const violation = (axis: string, got: number, cap: number, id: string) =>
        `${id} 의 ${axis} 가 ${got} 인데 요청의 o.caps 는 ${cap} 였습니다. ` +
        `캡은 CLI 가 정하고 어댑터는 o.caps.* 를 읽기만 해야 합니다(스펙 §5.2) — ` +
        `어댑터가 자체 상수를 쓰거나 캡을 덮어쓰고 있지 않은지 확인하세요.`;

      // 장소는 하드 요구다: 위의 locations_truncated 검사가 이미 표본에 기본 캡(10)을
      // 넘는 장소가 있음을 못박았으므로, 여기서 안 늘어난다면 어댑터가 원인이다.
      const widest = Math.max(...big.map((r) => r.locations?.length ?? 0));
      expect(
        widest,
        `캡을 ${CAPS.locations.max} 로 올려도 장소가 ${widest}곳뿐입니다 — ` +
          '어댑터가 o.caps.locations 를 읽지 않고 자체 상한을 쓰고 있을 수 있습니다.',
      ).toBeGreaterThan(NARROW.locations);
      for (const rec of small) {
        const n = rec.locations?.length ?? 0;
        expect(n, violation('locations', n, NARROW.locations, rec.id)).toBeLessThanOrEqual(NARROW.locations);
      }

      // 나머지 두 축은 조건부다 — 표본 시험이 결과 지표나 적격 기준문을 아예 게시하지
      // 않는 레지스트리가 있을 수 있고, 그건 어댑터의 잘못이 아니다. 넓게 받아서 실제로
      // 좁은 캡을 넘은 축만 검사한다.
      if (big.some((r) => (r.outcomes?.length ?? 0) > NARROW.outcomes)) {
        for (const rec of small) {
          const n = rec.outcomes?.length ?? 0;
          expect(n, violation('outcomes', n, NARROW.outcomes, rec.id)).toBeLessThanOrEqual(NARROW.outcomes);
        }
      }
      if (big.some((r) => (r.eligibility?.criteriaText?.length ?? 0) > NARROW.eligibilityChars)) {
        for (const rec of small) {
          const n = rec.eligibility?.criteriaText?.length ?? 0;
          expect(n, violation('eligibility.criteriaText', n, NARROW.eligibilityChars, rec.id)).toBeLessThanOrEqual(
            NARROW.eligibilityChars,
          );
        }
      }
    },
    );

    /**
     * I5. `get()`/`results()` 가 받는 ID 는 **접두사가 붙은 형태**(`CTGOV:NCT03831932`)다
     * — 어댑터가 스스로 벗겨서 업스트림에 보내야 한다. 이 규약이 인터페이스에도 이
     * 스위트에도 없어서, 안 벗기는 스텁으로 계약 17개가 전부 초록이었다. 스텁 트랜스포트는
     * 무엇을 물어보든 표본을 돌려주므로 벗기지 않은 요청도 "성공" 하기 때문이다.
     *
     * 그러니 결과가 아니라 **나간 요청** 을 본다: 접두사가 업스트림까지 새어 나가면 안 되고,
     * 벗긴 원문 ID 는 반드시 실려야 한다(뒤쪽이 없으면 ID 를 통째로 버리는 어댑터가 통과한다).
     *
     * `get` 도 `results` 도 없는 어댑터(ictrp)에서는 아래 두 분기가 **둘 다 거짓** 이라 이
     * 테스트가 아무것도 검사하지 않고 초록으로 지나갔다 — 통과 목록에 이름이 오르는데
     * 검사한 것은 없는, 제목이 거짓말하는 테스트다. 형제들과 같은 방식으로 건너뛴다.
     */
    (under.getSupported === false && !makeAdapter().capability().results.supported ? it.skip : it)(
      'get/results 는 접두사 붙은 ID 를 받아 스스로 벗긴다 — 접두사가 업스트림에 새면 안 된다', async () => {
      const { registryId } = parseTrialId(under.sampleId);
      const key = makeAdapter().key;
      const bare = registryId.toLowerCase();
      const leaked = [`${key}:`, `${key}%3a`];

      const check = async (label: string, run: (a: RegistryAdapter) => Promise<unknown>) => {
        const { adapter, requests } = ok();
        await run(adapter);
        const seen = requests.map((r) => `${r.url} ${r.body}`.toLowerCase());
        expect(seen.length, `${label} 이 업스트림 요청을 보내지 않았습니다.`).toBeGreaterThan(0);

        const offender = seen.find((s) => leaked.some((p) => s.includes(p)));
        expect(
          offender,
          `${label} 이 접두사를 벗기지 않고 업스트림에 보냈습니다: ${offender}. ` +
            `get()/results() 는 '${key.toUpperCase()}:${registryId}' 형태를 받아 ` +
            `'${registryId}' 만 업스트림에 실어야 합니다 — core/registry.ts 의 parseTrialId 를 쓰세요.`,
        ).toBeUndefined();

        expect(
          seen.some((s) => s.includes(bare)),
          `${label} 이 보낸 요청 어디에도 '${registryId}' 가 없습니다 — ` +
            '접두사를 벗기면서 ID 자체를 잃어버렸을 수 있습니다.',
        ).toBe(true);
      };

      if (under.getSupported !== false) {
        await check('get', (a) => a.get([under.sampleId], fetchOpts));
      }
      if (makeAdapter().capability().results.supported) {
        await check('results', (a) => a.results(under.sampleId, resultsOpts));
      }
    },
    );

    it('count 는 개수를 낸다 — 레코드가 아니라 수 하나다', async () => {
      const { adapter, calls } = ok();
      const r = await adapter.count({ condition: 'x' } as NormalizedQuery, fetchOpts);

      expect(calls.length).toBeGreaterThan(0);
      expect(typeof r.data).toBe('number');
      expect(Number.isFinite(r.data)).toBe(true);
      expect(r.data).toBeGreaterThanOrEqual(0);
    });

    it('results 는 TrialResults 계약을 지키는 값을 낸다', async () => {
      const cap = makeAdapter().capability();
      if (!cap.results.supported) return; // results 미지원은 아래 exit 3 테스트가 덮는다
      const { adapter, calls } = ok();
      const r = await adapter.results(under.sampleId, resultsOpts);

      expect(calls.length).toBeGreaterThan(0);
      expect(() => TrialResultsSchema.parse(r.data)).not.toThrow();
      expect(r.data.registry).toBe(adapter.key);
      expect(Array.isArray(r.warnings)).toBe(true);
    });

    /**
     * `.toBeDefined()` 만으로는 source 를 얕게 좁힌 어댑터(예: `{ id: rec.registryId }`
     * 만 남기는 것)를 못 잡는다 — 뭔가 있기만 하면 통과했다. 하네스의 `respond(url)` 이
     * 이미 이 호출이 받았을 업스트림 본문을 쥐고 있으므로, source 가 그 본문 어딘가와
     * 깊이 동등한지 요구하면 좁혀진 source 는 원문 트리의 어떤 지점과도 일치하지 못해
     * 걸린다.
     */
    it('raw 를 요청하면 레코드에 원문을 실어 낸다 — 유일한 탈출구가 비어 있거나 좁혀져 있으면 안 된다', async () => {
      const { adapter, calls } = ok();
      const r = await adapter.search({ condition: 'x' } as NormalizedQuery, { ...fetchOpts, raw: true });
      expect(r.data.length).toBeGreaterThan(0);
      expect(calls.length).toBeGreaterThan(0);
      for (const rec of r.data) {
        expect(rec.source).toBeDefined();
        const foundUpstream = calls.some((url) => containsDeepEqual(under.respond(url), rec.source));
        expect(
          foundUpstream,
          `${rec.id} 의 source 가 이 호출이 받은 업스트림 본문 어디에도 깊이 동등한 조각으로 없습니다 — source 가 좁혀졌을 수 있습니다.`,
        ).toBe(true);
      }
    });

    /**
     * 업스트림 실패를 빈 성공으로 바꾸지 않는다. 빈 배열/0 을 돌려주면 호출자는
     * "해당하는 시험이 없다" 로 읽는다 — 이 프로젝트가 없애려는 실패 유형 그대로다.
     */
    it('업스트림이 실패하면 빈 결과가 아니라 던진다', async () => {
      const cap = makeAdapter().capability();
      const probes: [string, () => Promise<unknown>][] = [
        ['search', () => broken().adapter.search({ condition: 'x' } as NormalizedQuery, fetchOpts)],
        ['get', () => broken().adapter.get([under.sampleId], fetchOpts)],
        ['count', () => broken().adapter.count({ condition: 'x' } as NormalizedQuery, fetchOpts)],
      ];
      if (cap.results.supported) probes.push(['results', () => broken().adapter.results(under.sampleId, resultsOpts)]);

      for (const [label, call] of probes) {
        await expect(call(), `${label} 은 업스트림 실패를 던져야 한다`).rejects.toBeInstanceOf(CtregError);
      }
    });

    // --- capability 진실성 (스펙 §9) ---

    it('신고하지 않은 축으로 요청하면 빈 결과가 아니라 exit 3 이 나온다', () => {
      const cap = makeAdapter().capability();

      const expectExit3 = (probe: NormalizedQuery, using: Capability, label: string) => {
        try {
          assertSupported(using, probe, fetchOpts);
          expect.unreachable(`'${label}' 은 exit 3 을 던져야 한다`);
        } catch (e) {
          expect((e as { exit?: number }).exit).toBe(EXIT.UNSUPPORTED);
        }
      };

      const unsupported = (Object.keys(cap.search) as (keyof Capability['search'])[])
        .filter((k) => cap.search[k].supported === false);

      if (unsupported.length === 0) {
        // 전부 지원하는 어댑터라면 반대 방향으로 검증한다: 가짜로 하나를 끄면 반드시 걸려야 한다.
        expectExit3(
          { condition: 'x' },
          { ...cap, search: { ...cap.search, condition: { ...cap.search.condition, supported: false } } },
          'condition',
        );
        return;
      }
      for (const axis of unsupported) {
        expectExit3(probeFor(axis), cap, axis);
      }
    });

    /**
     * 스펙 §9 가 이 스위트의 핵심으로 지목한 항목: `results.supported: false` 인 어댑터에
     * results 를 부르면 빈 값이 아니라 exit 3 이 나야 한다. capability 를 조작해
     * 이 어댑터가 그렇게 신고했을 때 CLI 가 어떻게 굴러가는지를 본다 — 신고를
     * 배신하는 순간을 잡는 것이 목적이므로, 조작이 곧 이 테스트의 방법이다.
     */
    it('results 를 미지원으로 신고하면 빈 결과가 아니라 exit 3 이다', async () => {
      const { adapter } = ok();
      const results = vi.fn(adapter.results.bind(adapter));
      const forged: RegistryAdapter = {
        ...adapter,
        capability: () => ({ ...adapter.capability(), results: { ...adapter.capability().results, supported: false } }),
        results,
      };
      const key = parseTrialId(under.sampleId).registry;
      const env = await runResults(
        argsFor(key, { command: 'results', positionals: [under.sampleId] }),
        { [key]: forged },
      );

      expect(results).not.toHaveBeenCalled();
      expect(env.registries[0]).toMatchObject({ registry: key, status: 'unsupported' });
      expect(env.data).toBeNull();
      expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
    });

    /**
     * 같은 규칙의 나머지 절반. `count.supported: false` 를 신고한 어댑터가 0 을 돌려주는 것은
     * 카운트 엔드포인트가 없는 레지스트리에서 가장 흔한 순진한 구현이고, 그 0 이
     * status "ok" 로 나가면 "이 레지스트리는 셀 수 없다" 가 "해당 시험이 없다" 로
     * 배달된다. results 와 달리 이쪽은 아무 데서도 강제되지 않아 실제로 그렇게
     * 동작했다(리뷰 C3).
     */
    it('count 를 미지원으로 신고하면 0 이 아니라 exit 3 이다', async () => {
      const { adapter } = ok();
      const count = vi.fn(async () => ({ data: 0, warnings: [] }));
      const forged: RegistryAdapter = {
        ...adapter,
        capability: () => ({ ...adapter.capability(), count: { ...adapter.capability().count, supported: false } }),
        count,
      };
      const env = await runCount(
        argsFor(adapter.key, { command: 'count' }),
        { [adapter.key]: forged },
      );

      expect(count).not.toHaveBeenCalled();
      expect(env.registries[0]).toMatchObject({ registry: adapter.key, status: 'unsupported' });
      expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
    });

    it('신고한 detail 섹션은 가드를 통과한다', () => {
      const cap = makeAdapter().capability();
      const include: FetchOpts['include'] = ['core'];
      if (cap.detail.eligibilityText.supported) include.push('eligibility');
      if (cap.detail.outcomes.supported) include.push('outcomes');
      expect(() => assertSupported(cap, {}, { ...fetchOpts, include })).not.toThrow();
    });

    it('TrialRecordSchema 가 이 어댑터의 registry 키를 안다', () => {
      const a = makeAdapter();
      const probe = {
        id: `${a.key.toUpperCase()}:X1`, registry: a.key, registryId: 'X1',
        url: 'https://example.test/X1', title: 'T', status: 'unknown',
        conditions: [], fetchedAt: '2026-08-22T00:00:00.000Z',
      };
      expect(() => TrialRecordSchema.parse(probe)).not.toThrow();
    });

    it('sampleId 는 이 어댑터의 키로 라우팅된다', () => {
      expect(parseTrialId(under.sampleId).registry).toBe(makeAdapter().key);
    });
  });
}
