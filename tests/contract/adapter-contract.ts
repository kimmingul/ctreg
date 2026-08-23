import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { CapabilitySchema, type Capability, type RegistryAdapter } from '../../src/core/capability.js';
import { CAPS, type FetchOpts, type NormalizedQuery, type ResultsOpts } from '../../src/core/query.js';
import { TrialRecordSchema, TrialResultsSchema } from '../../src/core/record.js';
import { parseTrialId, type RegistryKey } from '../../src/core/registry.js';
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
    it('maxBatchIds 를 넘는 ID 는 실제로 나눠 보낸다 — 숫자를 신고하는 것과 지키는 것은 다르다', async () => {
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

    it('get 은 ID 배치를 계약을 지키는 레코드로 낸다', async () => {
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
    it('장소가 잘리면 locations_truncated 경고가 반드시 딸려온다 — 경고 배열이 있다는 것만으론 부족하다', async () => {
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
    });

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
    it('o.caps 를 좁히면 그만큼만 담는다 — 캡은 CLI 가 정하고 어댑터는 읽기만 한다', async () => {
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
    });

    /**
     * I5. `get()`/`results()` 가 받는 ID 는 **접두사가 붙은 형태**(`CTGOV:NCT03831932`)다
     * — 어댑터가 스스로 벗겨서 업스트림에 보내야 한다. 이 규약이 인터페이스에도 이
     * 스위트에도 없어서, 안 벗기는 스텁으로 계약 17개가 전부 초록이었다. 스텁 트랜스포트는
     * 무엇을 물어보든 표본을 돌려주므로 벗기지 않은 요청도 "성공" 하기 때문이다.
     *
     * 그러니 결과가 아니라 **나간 요청** 을 본다: 접두사가 업스트림까지 새어 나가면 안 되고,
     * 벗긴 원문 ID 는 반드시 실려야 한다(뒤쪽이 없으면 ID 를 통째로 버리는 어댑터가 통과한다).
     */
    it('get/results 는 접두사 붙은 ID 를 받아 스스로 벗긴다 — 접두사가 업스트림에 새면 안 된다', async () => {
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

      await check('get', (a) => a.get([under.sampleId], fetchOpts));
      if (makeAdapter().capability().results) {
        await check('results', (a) => a.results(under.sampleId, resultsOpts));
      }
    });

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
      if (!cap.results) return; // results:false 는 아래 exit 3 테스트가 덮는다
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
      if (cap.results) probes.push(['results', () => broken().adapter.results(under.sampleId, resultsOpts)]);

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
        .filter((k) => cap.search[k] === false);

      if (unsupported.length === 0) {
        // 전부 지원하는 어댑터라면 반대 방향으로 검증한다: 가짜로 하나를 끄면 반드시 걸려야 한다.
        expectExit3({ condition: 'x' }, { ...cap, search: { ...cap.search, condition: false } }, 'condition');
        return;
      }
      for (const axis of unsupported) {
        expectExit3(probeFor(axis), cap, axis);
      }
    });

    /**
     * 스펙 §9 가 이 스위트의 핵심으로 지목한 항목: `results: false` 인 어댑터에
     * results 를 부르면 빈 값이 아니라 exit 3 이 나야 한다. capability 를 조작해
     * 이 어댑터가 그렇게 신고했을 때 CLI 가 어떻게 굴러가는지를 본다 — 신고를
     * 배신하는 순간을 잡는 것이 목적이므로, 조작이 곧 이 테스트의 방법이다.
     */
    it('results:false 를 신고하면 빈 결과가 아니라 exit 3 이다', async () => {
      const { adapter } = ok();
      const results = vi.fn(adapter.results.bind(adapter));
      const forged: RegistryAdapter = {
        ...adapter,
        capability: () => ({ ...adapter.capability(), results: false }),
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
     * 같은 규칙의 나머지 절반. `count: false` 를 신고한 어댑터가 0 을 돌려주는 것은
     * 카운트 엔드포인트가 없는 레지스트리에서 가장 흔한 순진한 구현이고, 그 0 이
     * status "ok" 로 나가면 "이 레지스트리는 셀 수 없다" 가 "해당 시험이 없다" 로
     * 배달된다. results 와 달리 이쪽은 아무 데서도 강제되지 않아 실제로 그렇게
     * 동작했다(리뷰 C3).
     */
    it('count:false 를 신고하면 0 이 아니라 exit 3 이다', async () => {
      const { adapter } = ok();
      const count = vi.fn(async () => ({ data: 0, warnings: [] }));
      const forged: RegistryAdapter = {
        ...adapter,
        capability: () => ({ ...adapter.capability(), count: false }),
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
      if (cap.detail.eligibilityText) include.push('eligibility');
      if (cap.detail.outcomes) include.push('outcomes');
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
