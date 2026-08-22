import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { Config } from '../../src/runtime/config.js';
import type { CtregError } from '../../src/runtime/errors.js';
import { getJson } from '../../src/runtime/http.js';
import { bucketPath } from '../../src/runtime/throttle.js';

let cfg: Config;
beforeEach(() => {
  cfg = {
    cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-http-')),
    cacheTtlSec: 3600,
    timeoutMs: 5000,
    maxRetries: 3,
    ratePerSec: 1000, // 테스트에서 실제 대기를 없앤다
    ctgovBaseUrl: 'https://example.test/api/v2',
  };
});

const opts = (cacheMode: 'use' | 'refresh' | 'off' = 'use') => ({
  registry: 'ctgov',
  baseUrl: cfg.ctgovBaseUrl,
  path: '/studies',
  params: { 'query.cond': 'NSCLC', pageSize: 2 },
  cacheMode,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const deps = (fetchImpl: typeof fetch) => ({ fetchImpl, sleep: async () => {} });

describe('HTTP 클라이언트', () => {
  it('200 이면 값을 돌려주고 캐시에 저장한다', async () => {
    const f = vi.fn(async () => json({ ok: true }));
    const r = await getJson<{ ok: boolean }>(cfg, opts(), deps(f as unknown as typeof fetch));
    expect(r.value).toEqual({ ok: true });
    expect(r.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('재시도 가능한 5xx 뒤 200 이면 성공한다', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 3 ? json({}, 503) : json({ ok: true })));
    const r = await getJson<{ ok: boolean }>(cfg, opts('off'), deps(f as unknown as typeof fetch));
    expect(r.value).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('429 가 재시도 예산을 소진하면 exit 4 / code rate_limited 로 던진다', async () => {
    const f = vi.fn(async () => json({}, 429));
    try {
      await getJson(cfg, opts('off'), deps(f as unknown as typeof fetch));
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.UPSTREAM);
      expect((e as CtregError).code).toBe('rate_limited');
    }
    expect(f).toHaveBeenCalledTimes(cfg.maxRetries + 1);
  });

  it('400 은 재시도하지 않고 본문 메시지를 hint 로 옮긴다', async () => {
    const f = vi.fn(async () => json({ message: "Unknown field 'Phase3'" }, 400));
    try {
      await getJson(cfg, opts('off'), deps(f as unknown as typeof fetch));
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).code).toBe('upstream');
      expect((e as CtregError).hint).toContain("Unknown field 'Phase3'");
    }
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('404 는 code not_found 로 구분되어 어댑터가 경고로 낮출 수 있다', async () => {
    const f = vi.fn(async () => json({}, 404));
    await expect(getJson(cfg, opts('off'), deps(f as unknown as typeof fetch))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('캐시 히트면 네트워크를 치지 않고 원래 fetchedAt 을 보존한다', async () => {
    const f1 = vi.fn(async () => json({ ok: true }));
    const first = await getJson(cfg, opts(), deps(f1 as unknown as typeof fetch));
    const f2 = vi.fn(async () => json({ ok: 'different' }));
    const second = await getJson(cfg, opts(), deps(f2 as unknown as typeof fetch));
    expect(f2).not.toHaveBeenCalled();
    expect(second.cached).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it('cacheMode refresh 는 캐시가 있어도 네트워크를 친다', async () => {
    const f1 = vi.fn(async () => json({ v: 1 }));
    await getJson(cfg, opts(), deps(f1 as unknown as typeof fetch));
    const f2 = vi.fn(async () => json({ v: 2 }));
    const r = await getJson<{ v: number }>(cfg, opts('refresh'), deps(f2 as unknown as typeof fetch));
    expect(f2).toHaveBeenCalledTimes(1);
    expect(r.value).toEqual({ v: 2 });
  });

  it('undefined 파라미터는 쿼리스트링에 넣지 않는다', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown) => { seen.push(String(url)); return json({}); });
    await getJson(cfg, {
      registry: 'ctgov', baseUrl: cfg.ctgovBaseUrl, path: '/studies',
      params: { a: 'x', b: undefined }, cacheMode: 'off',
    }, deps(f as unknown as typeof fetch));
    expect(seen[0]).toContain('a=x');
    expect(seen[0]).not.toContain('b=');
  });

  it('429 의 retry-after 를 그대로 존중해 디스크 버킷에 정확한 절대시각으로 공유한다', async () => {
    const FIXED_NOW = 2_000_000;
    const f = vi.fn(async () => json({}, 429, { 'retry-after': '7' }));
    await expect(
      getJson(cfg, opts('off'), { ...deps(f as unknown as typeof fetch), now: () => FIXED_NOW }),
    ).rejects.toMatchObject({ code: 'rate_limited' });

    const state = JSON.parse(readFileSync(bucketPath(cfg.cacheDir, 'ctgov'), 'utf8'));
    expect(state.blockedUntil).toBe(FIXED_NOW + 7000);
  });

  it('fetch 자체가 reject 하면(네트워크 단절) code upstream 으로 재시도 예산만큼 재시도한다', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(getJson(cfg, opts('off'), deps(f as unknown as typeof fetch))).rejects.toMatchObject({
      code: 'upstream',
    });
    expect(f).toHaveBeenCalledTimes(cfg.maxRetries + 1);
  });

  it('AbortSignal.timeout 이 실제로 발동하면 code upstream 으로 던진다', async () => {
    cfg.timeoutMs = 20;
    cfg.maxRetries = 0;
    const f = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    await expect(getJson(cfg, opts('off'), deps(f as unknown as typeof fetch))).rejects.toMatchObject({
      code: 'upstream',
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('호출자의 signal 이 타임아웃과 결합되어(AbortSignal.any) 호출자가 취소하면 즉시 중단된다', async () => {
    cfg.timeoutMs = 5000; // 이 테스트에서는 타임아웃이 아니라 호출자의 abort 로만 끝나야 한다
    cfg.maxRetries = 0;
    const controller = new AbortController();
    const f = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    setTimeout(() => controller.abort(), 5);
    await expect(
      getJson(cfg, { ...opts('off'), signal: controller.signal }, deps(f as unknown as typeof fetch)),
    ).rejects.toMatchObject({ code: 'upstream' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('cacheMode off 는 응답을 캐시에 쓰지 않는다', async () => {
    const f = vi.fn(async () => json({ ok: true }));
    await getJson(cfg, opts('off'), deps(f as unknown as typeof fetch));
    const cached = readdirSync(cfg.cacheDir).filter((name) => name.startsWith('resp-'));
    expect(cached).toEqual([]);
  });
});
