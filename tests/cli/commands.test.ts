import { describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { runCount } from '../../src/cli/commands/count.js';
import { runGet } from '../../src/cli/commands/get.js';
import { runRegistries } from '../../src/cli/commands/registries.js';
import { runResults } from '../../src/cli/commands/results.js';
import { runSearch } from '../../src/cli/commands/search.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { REGISTRY_KEYS } from '../../src/core/registry.js';
import { run } from '../../src/cli/index.js';
import { exitFor } from '../../src/cli/output.js';
import type { Capability, RegistryAdapter } from '../../src/core/capability.js';
import type { TrialRecord } from '../../src/core/record.js';
import type { RegistryKey } from '../../src/core/registry.js';
import { CtregError } from '../../src/runtime/errors.js';

const record = (n: string): TrialRecord => ({
  id: `CTGOV:${n}`, registry: 'ctgov', registryId: n,
  url: `https://clinicaltrials.gov/study/${n}`,
  title: `Study ${n}`, status: 'recruiting', conditions: ['X'],
  fetchedAt: '2026-08-22T00:00:00.000Z',
});

function stubAdapter(over: Partial<RegistryAdapter> = {}, cap: Capability = CTGOV_CAPABILITY): Record<'ctgov', RegistryAdapter> {
  return {
    ctgov: {
      key: 'ctgov',
      capability: () => cap,
      search: vi.fn(async () => ({ data: [record('NCT00000001')], warnings: [], total: 1, nextPageToken: 'tok' })),
      get: vi.fn(async () => ({ data: [record('NCT00000001')], warnings: [] })),
      results: vi.fn(async () => ({
        data: { id: 'CTGOV:NCT00000001', registry: 'ctgov' as const, hasResults: true, sections: {}, fetchedAt: '2026-08-22T00:00:00.000Z' },
        warnings: [],
      })),
      count: vi.fn(async () => ({ data: 1, warnings: [] })),
      ...over,
    } as RegistryAdapter,
  };
}

describe('search 커맨드', () => {
  it('레코드와 레지스트리 상태·커서를 봉투에 담는다', async () => {
    const env = await runSearch(parseCliArgs(['search', '--condition', 'NSCLC']), stubAdapter());
    expect(env.data).toHaveLength(1);
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'ok', total: 1, returned: 1, nextPageToken: 'tok' });
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('결과 0건은 오류가 아니다', async () => {
    const adapters = stubAdapter({ search: vi.fn(async () => ({ data: [], warnings: [], total: 0 })) });
    const env = await runSearch(parseCliArgs(['search', '--condition', 'zzz']), adapters);
    expect(env.data).toHaveLength(0);
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('미지원 축은 조회하지 않고 unsupported 로 표시한다', async () => {
    const cap: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, patient: { ...CTGOV_CAPABILITY.search.patient, supported: false } },
    };
    const adapters = stubAdapter({}, cap);
    const env = await runSearch(parseCliArgs(['search', '--patient', '62 year old']), adapters);
    expect(env.registries[0]!.status).toBe('unsupported');
    expect(adapters.ctgov.search).not.toHaveBeenCalled();
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  it('어댑터 경고를 봉투로 끌어올린다', async () => {
    const adapters = stubAdapter({
      search: vi.fn(async () => ({ data: [], warnings: [{ code: 'date_filter_excludes_missing', message: 'm' }], total: 0 })),
    });
    const env = await runSearch(parseCliArgs(['search', '--updated-since', '2025-01-01']), adapters);
    expect(env.warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('업스트림 실패는 해당 레지스트리만 error 로 만든다', async () => {
    const { upstreamError } = await import('../../src/runtime/errors.js');
    const adapters = stubAdapter({ search: vi.fn(async () => { throw upstreamError('boom'); }) });
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X']), adapters);
    expect(env.registries[0]!.status).toBe('error');
    expect(exitFor(env)).toBe(EXIT.UPSTREAM);
  });
});

describe('get 커맨드', () => {
  it('위치 인자를 ID 로 받는다', async () => {
    const adapters = stubAdapter();
    const env = await runGet(parseCliArgs(['get', 'NCT00000001', 'CTGOV:NCT00000002']), adapters);
    expect(adapters.ctgov.get).toHaveBeenCalledWith(['CTGOV:NCT00000001', 'CTGOV:NCT00000002'], expect.anything());
    expect(env.data).toHaveLength(1);
  });

  it('ID 가 없으면 exit 2 다', async () => {
    await expect(runGet(parseCliArgs(['get']), stubAdapter())).rejects.toMatchObject({ exit: EXIT.USAGE });
  });

  it('ID 를 레지스트리별로 나눠 해당 어댑터에만 보낸다', async () => {
    const adapters = stubAdapter();
    await runGet(parseCliArgs(['get', 'NCT00000001']), adapters);
    expect(adapters.ctgov.get).toHaveBeenCalledTimes(1);
  });
});

describe('results 커맨드', () => {
  it('ID 하나를 받아 TrialResults 를 낸다', async () => {
    const env = await runResults(parseCliArgs(['results', 'NCT00000001', '--outcome', 'PFS']), stubAdapter());
    expect((env.data as { id: string }).id).toBe('CTGOV:NCT00000001');
  });

  it('ID 가 정확히 하나가 아니면 exit 2 다', async () => {
    await expect(runResults(parseCliArgs(['results']), stubAdapter())).rejects.toMatchObject({ exit: EXIT.USAGE });
    await expect(runResults(parseCliArgs(['results', 'NCT00000001', 'NCT00000002']), stubAdapter()))
      .rejects.toMatchObject({ exit: EXIT.USAGE });
  });

  // 리뷰 I-3 지시로 브리프 테스트를 바꿨다: 던지는 대신 registries[] 에 기록한다.
  // 규칙은 "registries[] 가 비어 있다 == 어떤 레지스트리도 정해지지 않았다" 이고,
  // 여기서는 parseTrialId 가 레지스트리를 이미 풀었으므로 비어 있으면 안 된다.
  it('results 를 제공하지 않는 레지스트리는 registries[] 에 unsupported 로 남고 exit 3 이다', async () => {
    const cap: Capability = { ...CTGOV_CAPABILITY, results: { ...CTGOV_CAPABILITY.results, supported: false } };
    const adapters = stubAdapter({}, cap);
    const env = await runResults(parseCliArgs(['results', 'NCT00000001']), adapters);

    expect(adapters.ctgov.results).not.toHaveBeenCalled();
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'unsupported' });
    expect(env.registries[0]!.error?.code).toBe('unsupported');
    // 핵심 구분("없는 것이 아니라 안 싣는다")은 hint 가 아니라 메시지에 있어야 한다 —
    // hint 자리는 생겼지만(I1), 이건 힌트가 아니라 사실 자체다.
    expect(env.registries[0]!.error?.message).toContain('싣지 않습니다');
    expect(env.data).toBeNull();
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });
});

/**
 * C3 회귀. 발견 당시 capability 는 불리언이었고, 그 둘 중 results 만 강제되고 count 는
 * 어디서도 강제되지 않았다 — count 를 미지원으로 신고한 어댑터가 0 을 돌려주면(카운트
 * 엔드포인트가 없는 레지스트리를 위한 가장 흔한 순진한 구현) CLI 는 status "ok",
 * total 0, exit 0 을 냈다. "이 레지스트리는 셀 수 없다" 가 "해당하는 시험이 없다"
 * 로 배달되는 것으로, 스펙 §3.3 이 설계에서 가장 중요한 규칙이라고 부른 것의 정확한
 * 반대다. 지금 붙어 있는 두 어댑터는 둘 다 `count.supported: true` 라 이 경로는 실물로는
 * 도달 불가능하지만, 이 슬라이스의 산출물은 어댑터가 아니라 계약이다 — 세 번째
 * 레지스트리가 셀 수 없을 때 이 검사가 이미 서 있어야 한다. 그래서 스텁으로 세운다.
 */
describe('count 커맨드 — capability.count', () => {
  it('count 를 제공하지 않는 레지스트리는 0 이 아니라 exit 3 이다', async () => {
    const cap: Capability = { ...CTGOV_CAPABILITY, count: { ...CTGOV_CAPABILITY.count, supported: false } };
    // 카운트 엔드포인트가 없는 레지스트리를 위한 가장 순진한 구현: 0 을 돌려준다.
    const adapters = stubAdapter({ count: vi.fn(async () => ({ data: 0, warnings: [] })) }, cap);
    const env = await runCount(parseCliArgs(['count', '--condition', 'X']), adapters);

    expect(adapters.ctgov.count).not.toHaveBeenCalled();
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'unsupported' });
    expect(env.registries[0]!.error?.code).toBe('unsupported');
    expect(env.registries[0]!.error?.message).toContain('셀 수 없습니다');
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  it('count.supported: true 인 레지스트리는 그대로 센다', async () => {
    const env = await runCount(parseCliArgs(['count', '--condition', 'X']), stubAdapter());
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'ok', total: 1 });
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  /**
   * 아무 레지스트리도 세지 못했는데 `data: { total: 0 }` 을 남기면, `registries[]` 를
   * 보지 않는 호출자에게 그 0 이 **"해당하는 시험이 없다"** 로 배달된다. 이 CLI 가
   * 없애려는 실패 유형 그대로다. `results.ts` 는 같은 상황에서 이미 `data: null` 을 낸다 —
   * 봉투가 커맨드마다 다른 규칙을 쓰면 파서를 쓰는 쪽이 커맨드마다 다른 방어를 해야 한다.
   */
  it('아무도 세지 못하면 0 이 아니라 data: null 이다 — 0 은 "없다" 로 읽힌다', async () => {
    const cap: Capability = { ...CTGOV_CAPABILITY, count: { ...CTGOV_CAPABILITY.count, supported: false } };
    const adapters = stubAdapter({}, cap);
    const env = await runCount(parseCliArgs(['count', '--condition', 'X']), adapters);

    expect(env.data).toBeNull();
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  /**
   * 반대 방향. 하나라도 셌으면 그 합은 진짜 부분 합이므로 남긴다 — 여기서 null 로
   * 지워 버리면 성공한 레지스트리의 답까지 사라진다. 부분이라는 사실은 `registries[]`
   * 와 exit 5 가 말한다.
   */
  /**
   * I6. 레지스트리 둘을 실제로 세면 `total` 은 **무엇의 개수도 아니다** — 교차 등록은
   * 흔하고(`crossIds` 가 존재하는 이유), 겹치는 두 수를 더한 값은 합집합이 아니다.
   * 실측(2026-08-25): `count --registry ctgov --registry isrctn --condition diabetes`
   * 가 24273 + 1118 = 25391 을 경고 없이 냈다.
   *
   * `count` 에서는 중복을 뺄 수 없다 — 레코드를 안 받으니 `crossIds` 를 볼 수 없고,
   * 받으면 이 커맨드가 존재하는 이유가 사라진다. 그래서 빼는 대신 **숫자 자리에서
   * 내린다.** 바로 위 '아무도 세지 못하면 data: null' 과 같은 논거다: 틀린 숫자를
   * 숫자 자리에 두지 않는다.
   *
   * `data: null`(아무도 못 셌다)과는 **다른 모양**이어야 한다. 둘을 같은 값으로 뭉개면
   * "셀 수 없었다" 와 "더할 수 없다" 가 구별되지 않는다 — 이 CLI 가 없애려는 혼동 그대로다.
   */
  it('둘 이상을 셌으면 total 은 null 이다 — 겹치는 수의 합은 개수가 아니다', async () => {
    const a = stubAdapter().ctgov;
    const b = stubAdapter({ count: vi.fn(async () => ({ data: 2, warnings: [] })) }, { ...CTGOV_CAPABILITY, key: 'other' as RegistryKey }).ctgov;
    const adapters = { ctgov: a, other: b } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = { ...parseCliArgs(['count', '--condition', 'X']), registries: ['ctgov', 'other'] as unknown as RegistryKey[] };

    const env = await runCount(args, adapters);

    expect(env.data).toEqual({ total: null });
    // 레지스트리별 수는 그대로 남는다 — 더하고 싶은 호출자는 자기가 무엇을 더하는지
    // 알고 더할 수 있다. 지우는 것은 합계뿐이다.
    expect(env.registries.map((r) => r.total)).toEqual([1, 2]);
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('왜 null 인지를 경고가 말한다 — 값만 지우면 호출자는 도구가 고장 났다고 읽는다', async () => {
    const a = stubAdapter().ctgov;
    const b = stubAdapter({ count: vi.fn(async () => ({ data: 2, warnings: [] })) }, { ...CTGOV_CAPABILITY, key: 'other' as RegistryKey }).ctgov;
    const adapters = { ctgov: a, other: b } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = { ...parseCliArgs(['count', '--condition', 'X']), registries: ['ctgov', 'other'] as unknown as RegistryKey[] };

    const env = await runCount(args, adapters);

    const w = env.warnings.find((x) => x.code === 'totals_not_summable');
    expect(w, '겹칠 수 있는 총계를 내리면서 이유를 말하지 않았습니다').toBeDefined();
    // 상한이라는 사실을 말한다 — 25391 은 답이 아니지만 합집합의 상한이기는 하다.
    expect(w!.message).toContain('상한');
  });

  it('하나만 셌으면 total 은 그대로 숫자다 — 겹칠 상대가 없다', async () => {
    const env = await runCount(parseCliArgs(['count', '--condition', 'X']), stubAdapter());
    expect(env.data).toEqual({ total: 1 });
    expect(env.warnings.map((w) => w.code)).not.toContain('totals_not_summable');
  });

  it('한쪽만 셌으면 그 부분 합은 남긴다 — exit 5 가 부분임을 말한다', async () => {
    const good = stubAdapter().ctgov;
    const bad = stubAdapter({}, {
      ...CTGOV_CAPABILITY, key: 'bad' as RegistryKey,
      count: { ...CTGOV_CAPABILITY.count, supported: false },
    }).ctgov;
    const adapters = { good, bad } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = { ...parseCliArgs(['count', '--condition', 'X']), registries: ['good', 'bad'] as unknown as RegistryKey[] };

    const env = await runCount(args, adapters);

    expect(env.data).toEqual({ total: 1 });
    expect(env.registries.map((r) => r.status)).toEqual(['ok', 'unsupported']);
    expect(exitFor(env)).toBe(EXIT.PARTIAL);
  });
});

/**
 * I1 회귀. http.ts 는 업스트림 400 본문("Unknown sort field")을 회복 힌트로 만들어
 * CtregError.hint 에 담는데, RegistryStatus.error 에 hint 자리가 없어 봉투 문턱에서
 * 사라졌다. 400 이 날 수 있는 유일한 경로가 레지스트리별 catch 이므로, 스펙 §1.1 이
 * 이 CLI 의 존재 이유 네 가지 중 하나로 든 "400 회복 힌트" 가 실제로는 도달 불가능했다.
 */
describe('봉투 — 레지스트리별 오류의 회복 힌트', () => {
  const failing = (hint?: string) =>
    stubAdapter({
      search: vi.fn(async () => { throw new CtregError('ctgov 가 400 를 반환했습니다', 'upstream', EXIT.UPSTREAM, hint); }),
      count: vi.fn(async () => { throw new CtregError('ctgov 가 400 를 반환했습니다', 'upstream', EXIT.UPSTREAM, hint); }),
      get: vi.fn(async () => { throw new CtregError('ctgov 가 400 를 반환했습니다', 'upstream', EXIT.UPSTREAM, hint); }),
      results: vi.fn(async () => { throw new CtregError('ctgov 가 400 를 반환했습니다', 'upstream', EXIT.UPSTREAM, hint); }),
    });

  it('search / count / get / results 모두 hint 를 봉투까지 옮긴다', async () => {
    const HINT = 'Unknown sort field: NotAField';
    const envs = [
      await runSearch(parseCliArgs(['search', '--condition', 'X', '--sort', 'NotAField']), failing(HINT)),
      await runCount(parseCliArgs(['count', '--condition', 'X']), failing(HINT)),
      await runGet(parseCliArgs(['get', 'NCT00000001']), failing(HINT)),
      await runResults(parseCliArgs(['results', 'NCT00000001']), failing(HINT)),
    ];
    for (const env of envs) {
      expect(env.registries[0]!.error?.hint).toBe(HINT);
    }
  });

  it('힌트가 없으면 hint 키 자체를 만들지 않는다', async () => {
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X']), failing());
    expect(env.registries[0]!.error).toEqual({ code: 'upstream', message: 'ctgov 가 400 를 반환했습니다' });
    expect(JSON.stringify(env.registries[0])).not.toContain('hint');
  });
});

// --- 브리프가 다루지 않은 계약 ---

describe('search 커맨드 — 페이지 커서', () => {
  it('어댑터가 커서를 주지 않으면 봉투에 nextPageToken 키를 만들지 않는다', async () => {
    const adapters = stubAdapter({ search: vi.fn(async () => ({ data: [record('NCT00000001')], warnings: [], total: 1 })) });
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X']), adapters);
    expect(env.registries[0]).not.toHaveProperty('nextPageToken');
    expect(JSON.stringify(env.registries[0])).not.toContain('nextPageToken');
  });

  it('--page-token 을 어댑터에 그대로 넘긴다 — 커서 왕복이 성립해야 페이지를 넘길 수 있다', async () => {
    const adapters = stubAdapter();
    await runSearch(parseCliArgs(['search', '--condition', 'X', '--page-token', 'tok']), adapters);
    expect(adapters.ctgov.search).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: 'tok' }),
      expect.anything(),
    );
  });
});

describe('search 커맨드 — 부분 실패', () => {
  it('레지스트리 하나가 죽어도 나머지 레코드를 지키고 exit 5 를 낸다', async () => {
    // REGISTRY_KEYS 에는 아직 ctgov 하나뿐이라, 두 번째 레지스트리가 붙었을 때의
    // 코드 경로를 run.test.ts 와 같은 방식(런타임 전용 캐스팅)으로 확인한다.
    const ok = stubAdapter().ctgov;
    const bad = stubAdapter({
      search: vi.fn(async () => { throw (await import('../../src/runtime/errors.js')).upstreamError('boom'); }),
    }).ctgov;
    const adapters = { good: ok, bad } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = { ...parseCliArgs(['search', '--condition', 'X']), registries: ['good', 'bad'] as unknown as RegistryKey[] };

    const env = await runSearch(args, adapters);

    expect(env.data).toHaveLength(1);
    expect(env.registries.map((r) => r.status)).toEqual(['ok', 'error']);
    expect(exitFor(env)).toBe(EXIT.PARTIAL);
  });
});

describe('search 커맨드 — 레지스트리별 페이지 크기 상한', () => {
  /**
   * 회귀 테스트. args.query 는 이 루프의 모든 레지스트리가 공유하는 같은 객체다.
   * 상한이 낮은 레지스트리를 먼저 처리하면서 그 객체를 in-place 로 깎으면, 상한이
   * 높은 다음 레지스트리가 이미 깎인 값을 물려받는다 — 사용자가 원래 요청한 값이
   * 조용히 사라진다. REGISTRY_KEYS 에는 아직 ctgov 하나뿐이라, 부분 실패 테스트와
   * 같은 방식(런타임 전용 캐스팅)으로 두 번째 레지스트리를 흉내낸다.
   */
  it('상한이 낮은 레지스트리를 먼저 처리해도, 상한이 높은 다음 레지스트리는 원래 요청값을 받는다', async () => {
    const narrowCap: Capability = { ...CTGOV_CAPABILITY, key: 'narrow' as RegistryKey, name: '좁은 레지스트리', limits: { ...CTGOV_CAPABILITY.limits, maxPageSize: 50 } };
    const wideCap: Capability = { ...CTGOV_CAPABILITY, key: 'wide' as RegistryKey, name: '넓은 레지스트리', limits: { ...CTGOV_CAPABILITY.limits, maxPageSize: 200 } };
    const narrow = stubAdapter({}, narrowCap).ctgov;
    const wide = stubAdapter({}, wideCap).ctgov;
    const adapters = { narrow, wide } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = {
      ...parseCliArgs(['search', '--condition', 'X', '--page-size', '200']),
      registries: ['narrow', 'wide'] as unknown as RegistryKey[],
    };

    const env = await runSearch(args, adapters);

    expect(narrow.search).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }), expect.anything());
    expect(wide.search).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 200 }), expect.anything());
    expect(args.query.pageSize).toBe(200); // 원본 쿼리도 훼손되지 않는다
    expect(env.warnings).toEqual([
      expect.objectContaining({ code: 'page_size_clamped', registry: 'narrow' }),
    ]);
  });

  it('아무도 깎이지 않으면 page_size_clamped 경고를 내지 않는다 — 매번 붙는 경고는 안 읽힌다', async () => {
    const adapters = stubAdapter();
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X', '--page-size', '10']), adapters);
    expect(env.warnings.map((w) => w.code)).not.toContain('page_size_clamped');
  });
});

/**
 * I1 회귀. search.ts 는 위에서 이미 고정돼 있지만, count.ts 의 `applyLimits` 호출은
 * 통째로 지워도 걸리는 테스트가 없었다 — search 만 이 이음매를 검사했다. 같은 모양으로
 * count 에도 못박는다: 상한이 낮은 레지스트리만 클램프되고 경고가 붙는지, 상한이 높은
 * 다음 레지스트리는 원래 요청값을 그대로 받는지.
 */
describe('count 커맨드 — 레지스트리별 페이지 크기 상한', () => {
  it('상한이 낮은 레지스트리를 먼저 처리해도, 상한이 높은 다음 레지스트리는 원래 요청값을 받는다', async () => {
    const narrowCap: Capability = { ...CTGOV_CAPABILITY, key: 'narrow' as RegistryKey, name: '좁은 레지스트리', limits: { ...CTGOV_CAPABILITY.limits, maxPageSize: 50 } };
    const wideCap: Capability = { ...CTGOV_CAPABILITY, key: 'wide' as RegistryKey, name: '넓은 레지스트리', limits: { ...CTGOV_CAPABILITY.limits, maxPageSize: 200 } };
    const narrow = stubAdapter({}, narrowCap).ctgov;
    const wide = stubAdapter({}, wideCap).ctgov;
    const adapters = { narrow, wide } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = {
      ...parseCliArgs(['count', '--condition', 'X', '--page-size', '200']),
      registries: ['narrow', 'wide'] as unknown as RegistryKey[],
    };

    const env = await runCount(args, adapters);

    expect(narrow.count).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }), expect.anything());
    expect(wide.count).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 200 }), expect.anything());
    expect(args.query.pageSize).toBe(200); // 원본 쿼리도 훼손되지 않는다
    // 깎인 것은 narrow 뿐이다. 이 검사의 주제는 **클램프** 이므로 그 코드만 걸러
    // 본다 — 봉투 전체를 고정하면 무관한 경고가 하나 늘 때마다 제목과 다른 이유로
    // 빨개진다(연합 count 의 `totals_not_summable` 이 실제로 그랬다).
    expect(env.warnings.filter((w) => w.code === 'page_size_clamped')).toEqual([
      expect.objectContaining({ code: 'page_size_clamped', registry: 'narrow' }),
    ]);
  });

  it('아무도 깎이지 않으면 page_size_clamped 경고를 내지 않는다', async () => {
    const adapters = stubAdapter();
    const env = await runCount(parseCliArgs(['count', '--condition', 'X', '--page-size', '10']), adapters);
    expect(env.warnings.map((w) => w.code)).not.toContain('page_size_clamped');
  });
});

describe('get 커맨드 — 라우팅과 가드', () => {
  it('어댑터가 없는 레지스트리의 ID 하나가 요청 전체를 가라앉히지 않는다', async () => {
    const adapters = stubAdapter();
    const env = await runGet(parseCliArgs(['get', 'NCT00000001', 'EUCTR:2020-000001-11']), adapters);

    expect(adapters.ctgov.get).toHaveBeenCalledWith(['CTGOV:NCT00000001'], expect.anything());
    expect(env.data).toHaveLength(1);
    expect(env.warnings.map((w) => [w.code, w.id])).toContainEqual(['id_unroutable', 'EUCTR:2020-000001-11']);
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('모든 ID 가 라우팅 불가면 빈 성공이 아니라 그 오류를 낸다', async () => {
    await expect(runGet(parseCliArgs(['get', 'EUCTR:2020-000001-11']), stubAdapter()))
      .rejects.toMatchObject({ exit: EXIT.UNSUPPORTED });
    await expect(runGet(parseCliArgs(['get', 'not-an-id']), stubAdapter()))
      .rejects.toMatchObject({ exit: EXIT.USAGE });
  });

  it('레지스트리가 담지 않는 --include 섹션은 어댑터를 부르기 전에 막는다', async () => {
    const cap: Capability = {
      ...CTGOV_CAPABILITY,
      detail: { ...CTGOV_CAPABILITY.detail, outcomes: { ...CTGOV_CAPABILITY.detail.outcomes, supported: false } },
    };
    const adapters = stubAdapter({}, cap);
    const env = await runGet(parseCliArgs(['get', 'NCT00000001', '--include', 'outcomes']), adapters);

    expect(adapters.ctgov.get).not.toHaveBeenCalled();
    expect(env.registries[0]!.status).toBe('unsupported');
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });
});

describe('results 커맨드 — 옵션 전달과 실패', () => {
  it('섹션·필터를 어댑터에 그대로 넘긴다', async () => {
    const adapters = stubAdapter();
    await runResults(parseCliArgs(['results', 'NCT00000001', '--section', 'adverse', '--ae-organ', 'Cardiac']), adapters);
    expect(adapters.ctgov.results).toHaveBeenCalledWith(
      'CTGOV:NCT00000001',
      expect.objectContaining({ sections: ['adverse'], aeOrganFilter: 'Cardiac' }),
    );
  });

  it('어댑터 업스트림 실패는 봉투의 error 상태로 나오고 exit 4 다', async () => {
    const { upstreamError } = await import('../../src/runtime/errors.js');
    const adapters = stubAdapter({ results: vi.fn(async () => { throw upstreamError('boom'); }) });
    const env = await runResults(parseCliArgs(['results', 'NCT00000001']), adapters);
    expect(env.data).toBeNull();
    expect(env.registries[0]).toMatchObject({ status: 'error', error: { code: 'upstream', message: 'boom' } });
    expect(exitFor(env)).toBe(EXIT.UPSTREAM);
  });
});

describe('index 배선', () => {
  const capture = () => {
    const out: string[] = [];
    return { io: { stdout: (s: string) => out.push(s), stderr: () => {} }, out: () => out.join('') };
  };

  it('search / get / results 가 모두 dispatcher 에 연결되어 봉투를 낸다', async () => {
    for (const argv of [
      ['search', '--condition', 'NSCLC'],
      ['get', 'NCT00000001'],
      ['results', 'NCT00000001'],
    ]) {
      const c = capture();
      const code = await run(argv, c.io, {}, { adapters: stubAdapter() });
      expect(code).toBe(EXIT.OK);
      const parsed = JSON.parse(c.out());
      expect(parsed.error).toBeUndefined();
      expect(parsed.registries[0].status).toBe('ok');
    }
  });
});

// --- 리뷰 1차 수정 ---

describe('get 커맨드 — 파싱 불가 ID 와 미지원 레지스트리를 구분한다', () => {
  it('파싱 불가 ID 는 정상 ID 와 섞여 있어도 exit 2 다 (§5.3)', async () => {
    const adapters = stubAdapter();
    await expect(runGet(parseCliArgs(['get', 'NCT00000001', 'NCT0000010']), adapters))
      .rejects.toMatchObject({ exit: EXIT.USAGE });
    // 같은 오타가 단독일 때와 같은 뜻이어야 한다 — 동행에 따라 의미가 달라지면 안 된다.
    await expect(runGet(parseCliArgs(['get', 'NCT0000010']), adapters))
      .rejects.toMatchObject({ exit: EXIT.USAGE });
    // 요청 자체가 성립하지 않았으므로 어떤 레지스트리도 부르지 않는다.
    expect(adapters.ctgov.get).not.toHaveBeenCalled();
  });

  it('어댑터가 없는 레지스트리는 여전히 경고로 격하된다 — 두 실패는 다른 사실이다', async () => {
    const adapters = stubAdapter();
    const env = await runGet(parseCliArgs(['get', 'NCT00000001', 'EUCTR:2020-000001-11']), adapters);
    expect(exitFor(env)).toBe(EXIT.OK);
    expect(env.warnings.map((w) => w.code)).toEqual(['id_unroutable']);
  });

  it('라우팅에 실패한 ID 는 던질 때도 전부 봉투에 남는다', async () => {
    await expect(runGet(parseCliArgs(['get', 'EUCTR:2020-000001-11', 'not-an-id']), stubAdapter()))
      .rejects.toMatchObject({
        exit: EXIT.USAGE,
        warnings: [
          { code: 'id_unroutable', id: 'EUCTR:2020-000001-11' },
          { code: 'id_unroutable', id: 'not-an-id' },
        ],
      });
  });
});

describe('results 커맨드 — 없는 시험은 업스트림 장애가 아니다', () => {
  it('not_found 는 exit 0 · data null · not_found 경고다 (get 과 같은 사실은 같은 모양으로)', async () => {
    const { CtregError } = await import('../../src/runtime/errors.js');
    const adapters = stubAdapter({
      results: vi.fn(async () => {
        throw new CtregError('ctgov 에서 찾을 수 없습니다', 'not_found', EXIT.UPSTREAM);
      }),
    });
    const env = await runResults(parseCliArgs(['results', 'NCT99999999']), adapters);

    expect(exitFor(env)).toBe(EXIT.OK);
    expect(env.data).toBeNull();
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'ok', returned: 0 });
    expect(env.warnings).toEqual([
      expect.objectContaining({ code: 'not_found', id: 'CTGOV:NCT99999999' }),
    ]);
  });
});

describe('index 배선 — 던진 오류도 경고를 잃지 않는다', () => {
  it('라우팅 전멸이면 stdout 봉투가 나쁜 ID 를 전부 이름으로 담는다', async () => {
    const out: string[] = [];
    const io = { stdout: (s: string) => out.push(s), stderr: () => {} };
    const code = await run(
      ['get', 'EUCTR:2020-000001-11', 'not-an-id'],
      io,
      {},
      { adapters: stubAdapter() },
    );

    expect(code).toBe(EXIT.USAGE);
    const parsed = JSON.parse(out.join(''));
    expect(parsed.error.code).toBe('usage');
    expect(parsed.registries).toEqual([]); // 어떤 레지스트리도 정해지지 않았다
    expect(parsed.warnings.map((w: { id: string }) => w.id))
      .toEqual(['EUCTR:2020-000001-11', 'not-an-id']);
  });
});

// --- Task 6: 레지스트리 키가 어댑터보다 먼저 존재할 수 있다 ---

describe('레지스트리 키는 있는데 아직 어댑터가 없을 때', () => {
  it('등록된 키인데 어댑터가 없으면 크래시도 빈 성공도 아니라 exit 3 이다', async () => {
    // ctgov 는 REGISTRY_KEYS 에 실려 있는 진짜 키다 — 여기서는 그 어댑터를
    // 아예 채우지 않은 맵을 준다. Partial<> 이므로 캐스팅 없이 그냥 {} 로 된다.
    const adapters: Partial<Record<RegistryKey, RegistryAdapter>> = {};
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X']), adapters);

    expect(env.data).toEqual([]);
    expect(env.registries).toEqual([
      expect.objectContaining({ registry: 'ctgov', status: 'unsupported' }),
    ]);
    expect(env.registries[0]?.error?.code).toBe('unsupported');
    expect(env.registries[0]?.error?.message).toContain('ctgov');
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  it('연합에서 하나만 어댑터가 없으면, 있는 쪽은 정상 처리되고 exit 5 (부분 성공) 다', async () => {
    // 등록되지 않은 키('bad')를 런타임 전용 캐스팅으로 흉내낸다 — REGISTRY_KEYS 에
    // 실린 진짜 키를 쓰면 "그 키의 어댑터가 없는 상태" 를 만들기 위해 adapters 를
    // 비워야 하고, 그러면 이 테스트가 검사하려는 '한쪽만 없음' 이 아니게 된다.
    const good = stubAdapter().ctgov;
    const adapters = { good } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = { ...parseCliArgs(['search', '--condition', 'X']), registries: ['good', 'bad'] as unknown as RegistryKey[] };

    const env = await runSearch(args, adapters);

    expect(env.data).toHaveLength(1);
    expect(env.registries.map((r) => r.status)).toEqual(['ok', 'unsupported']);
    expect(env.registries[1]?.error?.code).toBe('unsupported');
    expect(exitFor(env)).toBe(EXIT.PARTIAL);
  });

  it('registries 커맨드는 어댑터 없는 키에서 죽지 않고 unsupported 로 남긴다', () => {
    const adapters: Partial<Record<RegistryKey, RegistryAdapter>> = {};
    const env = runRegistries(parseCliArgs(['registries']), adapters);

    // 등록된 키 전부가 나온다 — 어댑터가 없다고 목록에서 사라지면 "그런 레지스트리는
    // 없다" 와 "이 빌드에 아직 없다" 가 구별되지 않는다.
    expect(env.registries.map((r) => r.registry)).toEqual([...REGISTRY_KEYS]);
    for (const r of env.registries) {
      expect(r.status).toBe('unsupported');
      expect(r.error?.code).toBe('unsupported');
    }
    expect(env.data).toEqual([]); // 어댑터가 없어 capability 를 낼 수 없는 키는 건너뛴다
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  // 아래 네 개는 fix round 1 — 리뷰가 count/get/results 를 각각 continue 나 조용한
  // 'ok' 위장으로 사보타주해도 336개 스위트가 전부 통과한다는 것을 확인했다. 코드는
  // 이미 옳다(위 search/registries 테스트를 쓸 때 이미 다섯 커맨드 모두 구현했다) —
  // 이 테스트들은 버그를 고치는 게 아니라 그 옳음을 회귀로부터 고정하는 것이 목적이다.
  // 어댑터 #2 를 붙이는 작업이 정확히 이 코드를 건드리므로, 그때 퇴행이 나면 잡아야 한다.

  it('count: 등록된 키인데 어댑터가 없으면 exit 3 이다', async () => {
    const adapters: Partial<Record<RegistryKey, RegistryAdapter>> = {};
    const env = await runCount(parseCliArgs(['count', '--condition', 'X']), adapters);

    expect(env.registries).toEqual([
      expect.objectContaining({ registry: 'ctgov', status: 'unsupported' }),
    ]);
    expect(env.registries[0]?.error?.code).toBe('unsupported');
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  it('count: 연합에서 하나만 어댑터가 없으면, 있는 쪽은 정상 처리되고 exit 5 다', async () => {
    // count 는 search 와 같은 루프 모양(args.registries 를 도는)이라 같은 연합
    // 시나리오가 그대로 성립한다.
    const good = stubAdapter().ctgov;
    const adapters = { good } as unknown as Record<RegistryKey, RegistryAdapter>;
    const args = { ...parseCliArgs(['count', '--condition', 'X']), registries: ['good', 'bad'] as unknown as RegistryKey[] };

    const env = await runCount(args, adapters);

    expect(env.registries.map((r) => r.status)).toEqual(['ok', 'unsupported']);
    expect(env.registries[1]?.error?.code).toBe('unsupported');
    expect(exitFor(env)).toBe(EXIT.PARTIAL);
  });

  it('get: ID 형식은 유효한 등록된 키인데 어댑터가 없으면 exit 3 이다', async () => {
    // 위 「어댑터가 없는 레지스트리는 여전히 경고로 격하된다」테스트와 다른 경로다 —
    // 그 테스트의 EUCTR:... 는 REGISTRY_KEYS 에 아예 없어 parseTrialId 단계에서
    // id_unroutable 로 걸러지고 adapters[key] 조회까지 가지 않는다. 여기서는 NCT
    // 형식이 유효해 parseTrialId 를 통과하고 byRegistry 에 실제로 라우팅된 뒤,
    // adapters 맵에 ctgov 가 없다는 사실 자체를 검사한다.
    const adapters: Partial<Record<RegistryKey, RegistryAdapter>> = {};
    const env = await runGet(parseCliArgs(['get', 'NCT00000001']), adapters);

    expect(env.registries).toEqual([
      expect.objectContaining({ registry: 'ctgov', status: 'unsupported' }),
    ]);
    expect(env.registries[0]?.error?.code).toBe('unsupported');
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });
  // get 에는 연합("하나만 없으면 나머지는 처리") 테스트를 넣지 않는다. get 의
  // 레지스트리 분기는 args.registries 가 아니라 ID 접두사를 parseTrialId 로 라우팅해
  // 정해지고, 그 함수는 REGISTRY_KEYS 에 실제로 등록된 키만 인정한다. search/count
  // 처럼 args.registries 를 직접 덮어써 가짜 두 번째 레지스트리('good'/'bad')를
  // 흉내낼 방법이 없다 — 가짜 접두사를 담은 ID 는 parseTrialId 자체에서
  // id_unroutable 로 걸러지고 byRegistry 근처에도 못 간다. 두 번째 진짜 어댑터가
  // 붙기 전까지는 이 시나리오를 실제 ID 라우팅으로 재현할 방법이 없다.

  it('results: 등록된 키인데 어댑터가 없으면 exit 3 이다', async () => {
    // results 는 애초에 ID 하나 → 레지스트리 하나만 다룬다(runResults 시그니처가
    // 그렇다). 연합("하나만 없으면 나머지는 처리")이라는 개념 자체가 성립하지 않는다.
    const adapters: Partial<Record<RegistryKey, RegistryAdapter>> = {};
    const env = await runResults(parseCliArgs(['results', 'NCT00000001']), adapters);

    expect(env.registries).toEqual([
      expect.objectContaining({ registry: 'ctgov', status: 'unsupported' }),
    ]);
    expect(env.registries[0]?.error?.code).toBe('unsupported');
    expect(env.data).toBeNull();
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });
});

describe('zero_results_scope — 0건일 때만 축의 scope 를 말한다', () => {
  /**
   * 발화 시점을 커맨드가 정한다는 것이 이 설계의 핵심이라, 검사도 **부르는 자리**
   * 를 겨눈다. `search.ts` 의 한 줄과 `count.ts` 의 한 줄이 각각 따로 빨개져야
   * 한다 — 한 줄을 지웠는데 다른 테스트가 대신 잡아 주면 그 자리는 무방비다.
   */
  const empty = { search: vi.fn(async () => ({ data: [], warnings: [], total: 0 })), count: vi.fn(async () => ({ data: 0, warnings: [] })) };

  it('search: 0건이면 쓴 축의 scope 가 봉투에 실린다', async () => {
    const env = await runSearch(parseCliArgs(['search', '--term', '2015-000397-19']), stubAdapter(empty));
    expect(env.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'zero_results_scope', registry: 'ctgov' })]),
    );
    // 종료 코드는 바꾸지 않는다. 0건은 여전히 오류가 아니다.
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('search: 1건이라도 있으면 침묵한다 — 모호함이 없는 자리에서 말하면 변별력을 잃는다', async () => {
    const env = await runSearch(parseCliArgs(['search', '--term', 'NSCLC']), stubAdapter());
    expect(env.warnings.map((w) => w.code)).not.toContain('zero_results_scope');
  });

  /**
   * 페이지 끝을 넘겨 받은 빈 페이지는 "이 축이 그것을 보지 않을 수도 있다" 의
   * 사례가 아니다 — 업스트림은 걸린 것이 있다고 말하고 있다. `total` 을 함께 본다.
   */
  it('search: 총계가 있는데 이 페이지만 비면 침묵한다', async () => {
    const past = { search: vi.fn(async () => ({ data: [], warnings: [], total: 42 })) };
    const env = await runSearch(parseCliArgs(['search', '--term', 'NSCLC']), stubAdapter(past));
    expect(env.warnings.map((w) => w.code)).not.toContain('zero_results_scope');
  });

  it('count: 0 이면 같은 경고를 싣는다', async () => {
    const env = await runCount(parseCliArgs(['count', '--term', '2015-000397-19']), stubAdapter(empty));
    expect(env.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'zero_results_scope', registry: 'ctgov' })]),
    );
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('count: 0 이 아니면 침묵한다', async () => {
    const env = await runCount(parseCliArgs(['count', '--term', 'NSCLC']), stubAdapter());
    expect(env.warnings.map((w) => w.code)).not.toContain('zero_results_scope');
  });
});

describe('vocab_excludes_missing 는 봉투까지 간다', () => {
  /**
   * 가드가 경고를 만들어도 커맨드가 봉투에 싣지 않으면 사용자에게 도달하지 않는다.
   * 이 저장소에서 같은 형태의 구멍이 세 번 났다 — 고친 함수가 아니라 **부르는 자리**
   * 를 검사한다.
   */
  it('search 가 exhaustive:false 축 경고를 봉투에 싣는다', async () => {
    const cap: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: false } },
    };
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X', '--phase', 'phase_3']), stubAdapter({}, cap));
    expect(env.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'vocab_excludes_missing' })]),
    );
  });

  it('count 도 같은 경고를 싣는다', async () => {
    const cap: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: false } },
    };
    const env = await runCount(parseCliArgs(['count', '--condition', 'X', '--phase', 'phase_3']), stubAdapter({}, cap));
    expect(env.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'vocab_excludes_missing' })]),
    );
  });
});
