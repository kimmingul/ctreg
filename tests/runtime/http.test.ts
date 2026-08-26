import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { Config } from '../../src/runtime/config.js';
import type { CtregError } from '../../src/runtime/errors.js';
import { getJson, postForm } from '../../src/runtime/http.js';
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
        isrctnBaseUrl: 'https://isrctn.example.test',
  };
});

const opts = (cacheMode: 'use' | 'refresh' | 'off' = 'use') => ({
  registry: 'ctgov',
  baseUrl: cfg.ctgovBaseUrl,
  path: '/studies',
  params: { 'query.cond': 'NSCLC', pageSize: 2 },
  cacheMode,
  ratePerSec: 1000, // 테스트에서 실제 대기를 없앤다 — cfg.ratePerSec 가 없을 때의 기본 경로다
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
      params: { a: 'x', b: undefined }, cacheMode: 'off', ratePerSec: 1000,
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

  /**
   * CTREG_*_BASE_URL 로 스테이징/미러를 가리켰다가 그게 응답하지 않으면, 로그에
   * 레지스트리 이름만 있고 어느 서버(URL)였는지가 없으면 원인을 못 좁힌다.
   * 이 주장은 공유 루프(withReliability)로 옮기면서 한 번 깨졌던 것이라 회귀 방지용이다.
   */
  it('네트워크 실패 메시지에 어느 URL 로 보낸 요청인지 남는다', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(getJson(cfg, opts('off'), deps(f as unknown as typeof fetch))).rejects.toMatchObject({
      message: expect.stringContaining(`${cfg.ctgovBaseUrl}/studies`),
    });
  });

  // 이 테스트의 주장 자체가 "AbortSignal.timeout(cfg.timeoutMs) 이 실제로 발동한다"
  // 이므로 실제 타이머를 없앨 수 없다 — 타이머가 주장의 일부다. 대신 마진을 넉넉히
  // 준다: 20ms 는 CPU 부하 아래 스케줄링 지연에 잡아먹힐 수 있었으므로 200ms 로
  // 올리고, vitest 의 기본 테스트 타임아웃(5000ms)보다 넉넉한 여유를 명시적으로 준다.
  it(
    'AbortSignal.timeout 이 실제로 발동하면 code upstream 으로 던진다',
    async () => {
      cfg.timeoutMs = 200;
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
    },
    10_000,
  );

  // 이 테스트가 실제로 주장하는 것은 "호출자의 signal 이 AbortSignal.any 로 내부
  // 타임아웃과 결합되고, 호출자가 취소하면 code upstream 으로 던지며 fetch 를 한 번만
  // 부른다"이다 — 언제 취소되는지는 주장에 안 들어간다. 이전에는 그 "언제"를 실제
  // setTimeout(5ms) 로 만들어 cfg.timeoutMs(5000ms) 와 경합했다(부하가 크면 마진이
  // 줄어든다). 여기서는 벽시계를 아예 쓰지 않는다: 주입한 fetch 가 signal 에
  // 리스너를 붙인 다음 같은 마이크로태스크 큐에서 즉시 취소해, "리스너가 붙은 뒤
  // 취소된다"는 순서만 보장하고 실제 시간 간격은 아무 역할도 하지 않는다.
  it('호출자의 signal 이 타임아웃과 결합되어(AbortSignal.any) 호출자가 취소하면 즉시 중단된다', async () => {
    cfg.timeoutMs = 5000; // 내부 타임아웃은 관여하지 않는다 — 결합된 신호 전파만 검사한다
    cfg.maxRetries = 0;
    const controller = new AbortController();
    const f = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
          queueMicrotask(() => controller.abort());
        }),
    );
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

  it(
    '스로틀 버킷 락을 잡지 못하면 단독 진행하면서 throttle_lock_timeout 경고를 담아 성공한다',
    async () => {
      const path = bucketPath(cfg.cacheDir, 'ctgov');
      writeFileSync(path, JSON.stringify({ nextAvailableAt: 0 }));
      // reserveSlot 이 이 락을 끝내 잡지 못하도록, getJson 을 부르기 전에 실제
      // proper-lockfile 락을 쥔 채로 유지한다 — throttle.test.ts 와 같은 기법.
      const release = await lockfile.lock(path, { realpath: false });
      try {
        const f = vi.fn(async () => json({ ok: true }));
        const r = await getJson<{ ok: boolean }>(cfg, opts('off'), deps(f as unknown as typeof fetch));
        expect(r.value).toEqual({ ok: true });
        expect(r.warnings).toContainEqual(
          expect.objectContaining({ code: 'throttle_lock_timeout' }),
        );
      } finally {
        await release();
      }
    },
    15_000, // reserveSlot 의 락 재시도 기본 상한(500ms)까지 10 회 재시도하므로 실시간으로 몇 초 걸린다.
  );

  it('base URL 이 다르면 캐시 항목을 공유하지 않는다 — 다른 서버의 응답을 이 서버 것인 양 내면 안 된다', async () => {
    const f1 = vi.fn(async () => json({ from: 'A' }));
    const a = await getJson<{ from: string }>(cfg, opts(), deps(f1 as unknown as typeof fetch));
    expect(a.value).toEqual({ from: 'A' });

    // 같은 registry / path / params, base URL 만 다르다.
    const f2 = vi.fn(async () => json({ from: 'B' }));
    const b = await getJson<{ from: string }>(
      cfg,
      { ...opts(), baseUrl: 'https://other.test/api/v2' },
      deps(f2 as unknown as typeof fetch),
    );

    expect(f2).toHaveBeenCalledTimes(1); // 캐시 히트로 건너뛰면 안 된다
    expect(b.cached).toBe(false);
    expect(b.value).toEqual({ from: 'B' });

    // 원래 base URL 은 여전히 자기 항목을 캐시에서 읽는다.
    const again = await getJson<{ from: string }>(cfg, opts(), deps(vi.fn() as unknown as typeof fetch));
    expect(again.cached).toBe(true);
    expect(again.value).toEqual({ from: 'A' });
  });

  describe('레지스트리별 요청률 예산', () => {
    /**
     * sleep 호출을 실제로 기다리지 않고 기록만 한다 — 결정적이고 빠르다. `now` 도
     * 고정한다: 실제 벽시계를 쓰면 두 호출 사이에 흐르는 실제 몇 ms 가 간격 계산에
     * 섞여 들어와 waitedMs 가 기대한 간격에서 살짝 어긋난다.
     */
    function sleepSpy() {
      const waits: number[] = [];
      return { waits, sleep: async (ms: number) => { waits.push(ms); }, now: () => 1_000_000 };
    }

    it('cfg.ratePerSec 가 없으면(전역 오버라이드 미설정) 이 레지스트리가 선언한 ratePerSec 를 쓴다', async () => {
      cfg.ratePerSec = undefined; // 이 테스트만 전역 오버라이드를 끈다
      const s = sleepSpy();
      const f = vi.fn(async () => json({ ok: true }));
      const callOpts = { ...opts('off'), ratePerSec: 2 }; // 간격 500ms
      await getJson(cfg, callOpts, { fetchImpl: f as unknown as typeof fetch, sleep: s.sleep, now: s.now });
      await getJson(cfg, callOpts, { fetchImpl: f as unknown as typeof fetch, sleep: s.sleep, now: s.now });
      expect(s.waits).toContain(500);
    });

    it('두 레지스트리가 서로 다른 ratePerSec 를 선언하면 각자의 간격로 독립적으로 스로틀된다 — 하나가 느려도 다른 하나가 막히지 않는다', async () => {
      cfg.ratePerSec = undefined;
      const slow = sleepSpy();
      const fast = sleepSpy();
      const f = vi.fn(async () => json({ ok: true }));
      const slowOpts = { ...opts('off'), registry: 'slow-reg', ratePerSec: 1 }; // 간격 1000ms
      const fastOpts = { ...opts('off'), registry: 'fast-reg', ratePerSec: 10 }; // 간격 100ms

      await getJson(cfg, slowOpts, { fetchImpl: f as unknown as typeof fetch, sleep: slow.sleep, now: slow.now });
      await getJson(cfg, slowOpts, { fetchImpl: f as unknown as typeof fetch, sleep: slow.sleep, now: slow.now });
      await getJson(cfg, fastOpts, { fetchImpl: f as unknown as typeof fetch, sleep: fast.sleep, now: fast.now });
      await getJson(cfg, fastOpts, { fetchImpl: f as unknown as typeof fetch, sleep: fast.sleep, now: fast.now });

      expect(slow.waits).toContain(1000);
      expect(fast.waits).toContain(100);
      expect(fast.waits).not.toContain(1000);
    });

    it('cfg.ratePerSec 가 명시적으로 설정되면(전역 오버라이드) 레지스트리 선언값보다 우선한다', async () => {
      cfg.ratePerSec = 4; // 간격 250ms — 운영자의 명시적 개입
      const s = sleepSpy();
      const f = vi.fn(async () => json({ ok: true }));
      const callOpts = { ...opts('off'), ratePerSec: 1 }; // 선언값은 1000ms 간격이지만 무시돼야 한다
      await getJson(cfg, callOpts, { fetchImpl: f as unknown as typeof fetch, sleep: s.sleep, now: s.now });
      await getJson(cfg, callOpts, { fetchImpl: f as unknown as typeof fetch, sleep: s.sleep, now: s.now });
      expect(s.waits).toContain(250);
      expect(s.waits).not.toContain(1000);
    });
  });
});

/**
 * ISRCTN 은 XML 만 낸다 — JSON 포맷이 없다. `res.json()` 을 고정으로 부르는 한 이
 * 런타임(캐시·스로틀·재시도·타임아웃)을 두 번째 어댑터가 쓸 수 없고, 그러면 그 어댑터가
 * 자기 HTTP 스택을 따로 갖게 된다. 본문 해석만 호출자에게 넘긴다.
 */
describe('JSON 이 아닌 업스트림', () => {
  const xmlOpts = (over: Record<string, unknown> = {}) => ({
    ...opts('off'),
    registry: 'isrctn',
    path: '/api/query/format/default',
    ...over,
  });

  it('decode 를 주면 본문을 텍스트로 읽어 해석하고, accept 헤더도 그 타입으로 나간다', async () => {
    const f = vi.fn(async () => new Response('<a><b>7</b></a>', { status: 200, headers: { 'content-type': 'application/xml' } }));
    const r = await getJson<{ b: string }>(
      cfg,
      xmlOpts({ accept: 'application/xml', decode: (text: string) => ({ b: /<b>(.*)<\/b>/.exec(text)![1]! }) }),
      deps(f as unknown as typeof fetch),
    );
    expect(r.value).toEqual({ b: '7' });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ accept: 'application/xml' });
  });

  /**
   * 캐시에는 **해석된 값** 이 들어가야 한다. 원문 텍스트를 넣으면 캐시 히트 경로만
   * decode 를 건너뛰어 같은 요청이 캐시 여부에 따라 다른 타입을 내놓는다.
   */
  it('캐시에 저장되는 것은 원문이 아니라 해석된 값이다', async () => {
    const f = vi.fn(async () => new Response('<a><b>7</b></a>', { status: 200 }));
    const o = xmlOpts({ cacheMode: 'use', decode: (text: string) => ({ b: /<b>(.*)<\/b>/.exec(text)![1]! }) });
    const first = await getJson<{ b: string }>(cfg, o, deps(f as unknown as typeof fetch));
    const second = await getJson<{ b: string }>(cfg, o, deps(f as unknown as typeof fetch));
    expect(second.cached).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('decode 를 안 주면 예전대로 JSON 으로 읽는다', async () => {
    const f = vi.fn(async () => json({ ok: true }));
    const r = await getJson<{ ok: boolean }>(cfg, xmlOpts(), deps(f as unknown as typeof fetch));
    expect(r.value).toEqual({ ok: true });
  });
});

describe('postForm — 폼 POST', () => {
  /**
   * ICTRP 는 REST API 가 없고 ViewState 폼만 있다. 어댑터가 fetch 를 직접 부르면
   * 캐시·스로틀·재시도·타임아웃을 통째로 다시 구현하게 되고 레지스트리마다 신뢰성이
   * 갈린다 — `decode` 훅이 존재하는 이유와 같은 논거다.
   */
  it('폼을 application/x-www-form-urlencoded 로 POST 한다', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await postForm(cfg, {
      registry: 'ictrp', baseUrl: 'https://ictrp.example.test', path: '/AdvSearch.aspx',
      form: { a: '1', b: 'x y' },
      cacheKeyParams: { q: 'diabetes' },
      cacheMode: 'off', ratePerSec: 1000,
      decode: (text) => text,
    }, { fetchImpl, sleep: async () => {} });

    expect(res.value).toBe('<html>ok</html>');
    expect(seen.init?.method).toBe('POST');
    expect(String((seen.init?.headers as Record<string, string>)['content-type']))
      .toContain('application/x-www-form-urlencoded');
    expect(String(seen.init?.body)).toBe('a=1&b=x+y');
  });

  /**
   * 캐시 키는 ViewState 가 아니라 **논리 질의** 로 만든다. ViewState 는 요청마다
   * 달라서 그것을 키에 넣으면 캐시가 영원히 미스다.
   */
  it('같은 논리 질의는 ViewState 가 달라도 캐시 히트다', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const base = {
      registry: 'ictrp', baseUrl: 'https://ictrp.example.test', path: '/AdvSearch.aspx',
      cacheKeyParams: { q: 'diabetes' }, cacheMode: 'use' as const, ratePerSec: 1000,
      decode: (t: string) => t,
    };
    await postForm(cfg, { ...base, form: { __VIEWSTATE: 'AAA' } }, { fetchImpl, sleep: async () => {} });
    const second = await postForm(cfg, { ...base, form: { __VIEWSTATE: 'BBB' } }, { fetchImpl, sleep: async () => {} });
    expect(calls).toBe(1);
    expect(second.cached).toBe(true);
  });
});
