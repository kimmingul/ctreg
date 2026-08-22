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
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
 * 두 번째 레지스트리는 여기에 한 줄(`runAdapterContract('ictrp', …)`)을 더하면 된다.
 */
export function runAdapterContract(name: string, under: AdapterUnderTest): void {
  const stub = (respond: (url: string) => Response) => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return respond(String(url));
    }) as unknown as typeof fetch;
    return { adapter: under.make(fetchImpl), calls };
  };
  const ok = () => stub((url) => json(under.respond(url)));
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

    it('raw 를 요청하면 레코드에 원문을 실어 낸다 — 유일한 탈출구가 비어 있으면 안 된다', async () => {
      const { adapter } = ok();
      const r = await adapter.search({ condition: 'x' } as NormalizedQuery, { ...fetchOpts, raw: true });
      expect(r.data.length).toBeGreaterThan(0);
      for (const rec of r.data) expect(rec.source).toBeDefined();
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
        const probe: NormalizedQuery =
          axis === 'geo' ? { near: { lat: 0, lon: 0 } } : ({ [axis]: 'x' } as NormalizedQuery);
        expectExit3(probe, cap, axis);
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
