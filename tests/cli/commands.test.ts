import { describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { runGet } from '../../src/cli/commands/get.js';
import { runResults } from '../../src/cli/commands/results.js';
import { runSearch } from '../../src/cli/commands/search.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { run } from '../../src/cli/index.js';
import { exitFor } from '../../src/cli/output.js';
import type { Capability, RegistryAdapter } from '../../src/core/capability.js';
import type { TrialRecord } from '../../src/core/record.js';
import type { RegistryKey } from '../../src/core/registry.js';

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
    const cap: Capability = { ...CTGOV_CAPABILITY, search: { ...CTGOV_CAPABILITY.search, patient: false } };
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

  it('results 를 제공하지 않는 레지스트리면 exit 3 이다', async () => {
    const cap: Capability = { ...CTGOV_CAPABILITY, results: false };
    await expect(runResults(parseCliArgs(['results', 'NCT00000001']), stubAdapter({}, cap)))
      .rejects.toMatchObject({ exit: EXIT.UNSUPPORTED });
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
    const cap: Capability = { ...CTGOV_CAPABILITY, detail: { ...CTGOV_CAPABILITY.detail, outcomes: false } };
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
      const code = await run(argv, c.io, {}, { adapters: stubAdapter() as Record<RegistryKey, RegistryAdapter> });
      expect(code).toBe(EXIT.OK);
      const parsed = JSON.parse(c.out());
      expect(parsed.error).toBeUndefined();
      expect(parsed.registries[0].status).toBe('ok');
    }
  });
});
