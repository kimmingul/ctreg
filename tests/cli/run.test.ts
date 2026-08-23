import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import type { ParsedArgs } from '../../src/cli/args.js';
import { runCount } from '../../src/cli/commands/count.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { run } from '../../src/cli/index.js';
import { exitFor } from '../../src/cli/output.js';
import { CAPS } from '../../src/core/query.js';
import type { RegistryAdapter } from '../../src/core/capability.js';
import type { RegistryKey } from '../../src/core/registry.js';
import { upstreamError } from '../../src/runtime/errors.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-run-')), CTREG_RATE_PER_SEC: '1000' });

const stubFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

const baseArgs = (overrides: Partial<ParsedArgs> = {}): ParsedArgs => ({
  command: 'count',
  positionals: [],
  registries: ['ctgov'],
  query: {},
  fetch: {
    include: ['core'],
    caps: {
      locations: CAPS.locations.default,
      eligibilityChars: CAPS.eligibilityChars.default,
      outcomes: CAPS.outcomes.default,
    },
    cacheMode: 'use',
    raw: false,
  },
  results: { sections: ['outcomes', 'adverse', 'flow', 'baseline'], full: false, cacheMode: 'use' },
  format: 'json',
  help: false,
  ...overrides,
});

describe('run()', () => {
  it('registries 는 네트워크 없이 capability 를 낸다', async () => {
    const c = capture();
    const f = stubFetch({});
    const code = await run(['registries'], c.io, env(), { http: { fetchImpl: f as unknown as typeof fetch } });
    expect(code).toBe(EXIT.OK);
    expect(f).not.toHaveBeenCalled();
    const parsed = JSON.parse(c.out());
    expect(parsed.data[0].key).toBe('ctgov');
    // 축이 객체가 됐으므로 JSON 을 건너온 뒤에도 내용이 남아 있는지까지 본다 —
    // 직렬화가 축을 다시 불리언으로 납작하게 만들면 `registries` 를 읽는 에이전트는
    // 예전과 똑같이 "무엇을 받는지" 를 알 수 없다.
    expect(parsed.data[0].search.geo).toEqual(CTGOV_CAPABILITY.search.geo);
  });

  it('count 는 개수만 낸다', async () => {
    const c = capture();
    const f = stubFetch({ totalCount: 412 });
    const code = await run(['count', '--condition', 'NSCLC'], c.io, env(), {
      http: { fetchImpl: f as unknown as typeof fetch, sleep: async () => {} },
    });
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(c.out()).data).toEqual({ total: 412 });
  });

  it(
    'count 는 레지스트리 하나가 실패해도 나머지 결과를 지키고, exitFor 는 5(부분 실패)를 낸다',
    async () => {
      // REGISTRY_KEYS 에는 현재 ctgov 하나뿐이라 실제 서로 다른 두 레지스트리 키가 없다.
      // runCount 는 어댑터 맵의 키가 아니라 args.registries 를 순회하며 어댑터를 찾아
      // 도는 루프이므로, 두 번째 레지스트리가 실제로 등록될 때와 동일한 코드 경로를
      // (런타임에서만 유효한 캐스팅으로) runCount 를 직접 불러 확인한다.
      const ok = {
        key: 'ctgov',
        capability: () => CTGOV_CAPABILITY,
        search: vi.fn(),
        get: vi.fn(),
        results: vi.fn(),
        count: vi.fn(async () => ({ data: 100, warnings: [] })),
      } as unknown as RegistryAdapter;
      const bad = {
        key: 'ctgov',
        capability: () => CTGOV_CAPABILITY,
        search: vi.fn(),
        get: vi.fn(),
        results: vi.fn(),
        count: vi.fn(async () => {
          throw upstreamError('boom');
        }),
      } as unknown as RegistryAdapter;
      const adapters = { good: ok, bad } as unknown as Record<RegistryKey, RegistryAdapter>;
      const args = baseArgs({ registries: ['good', 'bad'] as unknown as RegistryKey[] });

      const envelope = await runCount(args, adapters);

      expect(envelope.registries).toEqual([
        { registry: 'good', status: 'ok', total: 100 },
        { registry: 'bad', status: 'error', error: { code: 'upstream', message: 'boom' } },
      ]);
      expect(envelope.data).toEqual({ total: 100 });
      expect(exitFor(envelope)).toBe(EXIT.PARTIAL);
    },
  );

  it('count 는 미지원 축을 만나면 어댑터를 부르기 전에 막는다 — 어댑터의 count() 가 호출되지 않는다', async () => {
    const c = capture();
    const countSpy = vi.fn(async () => ({ data: 999, warnings: [] }));
    const limited = {
      key: 'ctgov',
      capability: () => ({
        ...CTGOV_CAPABILITY,
        search: { ...CTGOV_CAPABILITY.search, patient: { ...CTGOV_CAPABILITY.search.patient, supported: false } },
      }),
      search: vi.fn(),
      get: vi.fn(),
      results: vi.fn(),
      count: countSpy,
    } as unknown as RegistryAdapter;

    const code = await run(['count', '--patient', '62 year old'], c.io, env(), {
      adapters: { ctgov: limited },
    });

    expect(code).toBe(EXIT.UNSUPPORTED);
    expect(countSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(c.out());
    expect(parsed.registries[0].status).toBe('unsupported');
  });

  it('모르는 커맨드는 exit 2 이고, 사용법은 stderr 로 가지만 stdout 도 파싱 가능한 오류 봉투를 낸다', async () => {
    const c = capture();
    const code = await run(['landscape'], c.io, env());
    expect(code).toBe(EXIT.USAGE);
    expect(c.err()).toContain('search');
    const parsed = JSON.parse(c.out());
    expect(parsed.error.code).toBe('usage');
  });

  it('오류도 봉투 모양으로 stdout 에 나가고 힌트를 담는다', async () => {
    const c = capture();
    const code = await run(['search', '--radius', '100km'], c.io, env());
    expect(code).toBe(EXIT.USAGE);
    const parsed = JSON.parse(c.out());
    expect(parsed.error.code).toBe('usage');
    expect(parsed.error.hint).toContain('--near');
  });

  it('--help 는 exit 0 이고 사용법을 stdout 에 낸다', async () => {
    const c = capture();
    expect(await run(['--help'], c.io, env())).toBe(EXIT.OK);
    expect(c.out()).toContain('ctreg search');
  });

  it('도움말이 exit 5 가 언제 나는지 말한다 — 경고가 아니라 레지스트리 실패', async () => {
    const c = capture();
    await run(['--help'], c.io, env());
    const help = c.out();
    expect(help).toContain('레지스트리');
    expect(help).toMatch(/5[^\n]*레지스트리/);
  });

  it('로그는 stdout 을 오염시키지 않는다 — stdout 은 항상 파싱 가능해야 한다', async () => {
    const c = capture();
    await run(['registries'], c.io, env());
    expect(() => JSON.parse(c.out())).not.toThrow();
  });
});
