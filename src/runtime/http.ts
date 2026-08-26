/**
 * 재시도/백오프 로직은 clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads,
 * Apache-2.0) 의 `src/services/clinical-trials/clinical-trials-service.ts` 에서
 * 파생했다 (RETRYABLE_STATUS, 지수 백오프 + 지터, 재시도 3회). 스로틀은 프로세스 간
 * 공유가 필요해 온디스크 토큰버킷(`throttle.ts`)으로 교체했다. 라이선스 전문은
 * 이 저장소의 NOTICE 를 참고한다.
 */
import type { Warning } from '../core/capability.js';
import type { CacheMode } from '../core/query.js';
import type { Config } from './config.js';
import { cacheKey, readCache, writeCache } from './cache.js';
import { CtregError, rateLimitedError, upstreamError } from './errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { reserveSlot, shareBackoff } from './throttle.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export type HttpDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type GetJsonOpts<T> = {
  registry: string;
  baseUrl: string;
  path: string;
  params: Record<string, string | number | undefined>;
  cacheMode: CacheMode;
  signal?: AbortSignal;
  /** 이 레지스트리가 capability 에 선언한 예산. cfg.ratePerSec 가 없을 때 쓰인다. */
  ratePerSec: number;
  /**
   * 업스트림 본문의 해석. 주지 않으면 `res.json()` — 지금까지의 동작 그대로다.
   * 주면 본문을 텍스트로 읽어 이 함수에 넘긴다. ISRCTN 처럼 JSON 포맷이 아예 없는
   * 레지스트리를 위한 자리다. 이 자리가 없으면 그런 어댑터는 캐시·스로틀·재시도·
   * 타임아웃을 통째로 다시 구현해야 하고, 그러면 레지스트리마다 신뢰성이 갈린다.
   *
   * 해석된 값이 캐시에 들어간다(원문이 아니다) — 원문을 넣으면 캐시 히트 경로만
   * decode 를 건너뛰어, 같은 요청이 캐시 여부에 따라 다른 타입을 내놓는다.
   */
  decode?: (text: string) => T;
  /** `decode` 와 짝이다. 기본값은 `application/json`. */
  accept?: string;
};

function buildUrl(baseUrl: string, path: string, params: GetJsonOpts<unknown>['params']): string {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function bodyMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      return parsed.message ?? text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return undefined;
  }
}

type SharedOpts = {
  registry: string;
  cacheKey: string;
  /** 실패 메시지에만 쓴다 — 어느 서버로 보낸 요청이 안 되는지 로그에 남기기 위해서다. */
  url: string;
  cacheMode: CacheMode;
  ratePerSec: number;
  signal?: AbortSignal;
};

/**
 * 캐시·스로틀·재시도·타임아웃. `getJson` 과 `postForm` 이 함께 쓴다 — 이 루프가
 * 한 벌이어야 레지스트리마다 신뢰성이 갈리지 않는다. `send` 는 요청을 만드는 부분만
 * 다르므로 콜백으로 받는다.
 */
async function withReliability<T>(
  cfg: Config,
  o: SharedOpts,
  send: (signal: AbortSignal) => Promise<Response>,
  decode: (text: string) => Promise<T> | T,
  deps: HttpDeps,
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const warnings: Warning[] = [];

  if (o.cacheMode === 'use') {
    const hit = await readCache<T>(cfg.cacheDir, o.cacheKey, cfg.cacheTtlSec, now);
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, cached: true, warnings };
  }

  let lastStatus = 0;
  // cfg.ratePerSec 는 운영자가 명시적으로 준 전역 오버라이드일 때만 존재한다(config.ts 참고).
  // 없으면 이 레지스트리가 스스로 선언한 예산을 쓴다 — 어댑터 #2 가 다른 예산을 선언하면
  // 그 값이 그대로 반영된다.
  const ratePerSec = cfg.ratePerSec ?? o.ratePerSec;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const slot = await reserveSlot({
      dir: cfg.cacheDir,
      registry: o.registry,
      ratePerSec,
      now,
      sleep,
    });
    if (slot.lockTimedOut) {
      warnings.push({
        code: 'throttle_lock_timeout',
        message: '요청률 버킷 락을 잡지 못해 단독으로 진행했습니다.',
      });
    }

    const timeout = AbortSignal.timeout(cfg.timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await send(signal);
    } catch (cause) {
      if (attempt === cfg.maxRetries) {
        throw upstreamError(`${o.registry} 요청 실패: ${o.url}`, '네트워크 또는 타임아웃.', cause);
      }
      await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.75 + 0.5 * Math.random()));
      continue;
    }

    lastStatus = res.status;

    if (res.ok) {
      const value = await decode(await res.text());
      const fetchedAt = new Date(now()).toISOString();
      if (o.cacheMode !== 'off') await writeCache(cfg.cacheDir, o.cacheKey, value, fetchedAt, now);
      return { value, fetchedAt, cached: false, warnings };
    }

    if (res.status === 404) {
      throw new CtregError(
        `${o.registry} 에서 찾을 수 없습니다`,
        'not_found',
        EXIT.UPSTREAM,
        await bodyMessage(res),
      );
    }

    if (!RETRYABLE_STATUS.has(res.status)) {
      throw upstreamError(`${o.registry} 가 ${res.status} 를 반환했습니다`, await bodyMessage(res));
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const untilMs =
        now() +
        (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BASE_BACKOFF_MS * 2 ** attempt);
      await shareBackoff({ dir: cfg.cacheDir, registry: o.registry, ratePerSec }, untilMs);
    }

    if (attempt === cfg.maxRetries) break;
    await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.75 + 0.5 * Math.random()));
  }

  if (lastStatus === 429) {
    throw rateLimitedError(
      `${o.registry} 가 ${cfg.maxRetries}회 재시도 후에도 요청률을 제한했습니다`,
      '동시에 도는 ctreg 프로세스를 줄이거나 잠시 뒤 다시 시도하세요.',
    );
  }
  throw upstreamError(`${o.registry} 가 ${cfg.maxRetries}회 재시도 후에도 ${lastStatus} 를 반환했습니다`);
}

export async function getJson<T>(
  cfg: Config,
  o: GetJsonOpts<T>,
  deps: HttpDeps = {},
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  const doFetch = deps.fetchImpl ?? fetch;
  // 캐시 키에 base URL 이 들어가야 한다. 없으면 A 서버에서 받은 응답을 B 서버에 대한
  // 요청에 그대로 내주는 false hit 이 된다 — CTREG_*_BASE_URL 로 다른 서버(스테이징,
  // 미러, 테스트 스텁)를 가리켜도 이전 서버의 데이터가 이 서버 것인 양 나온다.
  // cacheKey 의 endpoint 인자에 실어 보낸다 — 요청 URL 의 파라미터 앞부분 그대로다.
  const key = cacheKey(o.registry, o.baseUrl + o.path, o.params);
  const url = buildUrl(o.baseUrl, o.path, o.params);

  return withReliability(
    cfg,
    {
      registry: o.registry,
      cacheKey: key,
      url,
      cacheMode: o.cacheMode,
      ratePerSec: o.ratePerSec,
      ...(o.signal ? { signal: o.signal } : {}),
    },
    (signal) => doFetch(url, { signal, headers: { accept: o.accept ?? 'application/json' } }),
    (text) => (o.decode ? o.decode(text) : (JSON.parse(text) as T)),
    deps,
  );
}

export type PostFormOpts<T> = {
  registry: string;
  baseUrl: string;
  path: string;
  /** 그대로 폼 인코딩되어 본문이 된다. ViewState 를 포함한다. */
  form: Record<string, string>;
  /**
   * 캐시 키를 만드는 데 쓰는 **논리 질의**. `form` 이 아니라 이것을 쓰는 이유는
   * ViewState 가 요청마다 달라서, 그것을 키에 넣으면 캐시가 영원히 미스이기 때문이다.
   */
  cacheKeyParams: Record<string, string | number>;
  cacheMode: CacheMode;
  ratePerSec: number;
  decode: (text: string) => T;
  accept?: string;
  signal?: AbortSignal;
};

export async function postForm<T>(
  cfg: Config,
  o: PostFormOpts<T>,
  deps: HttpDeps = {},
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const url = o.baseUrl + o.path;
  const body = new URLSearchParams(o.form).toString();
  return withReliability(
    cfg,
    {
      registry: o.registry,
      cacheKey: cacheKey(o.registry, url, o.cacheKeyParams),
      url,
      cacheMode: o.cacheMode,
      ratePerSec: o.ratePerSec,
      ...(o.signal ? { signal: o.signal } : {}),
    },
    (signal) =>
      doFetch(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: o.accept ?? 'text/html',
        },
        body,
      }),
    async (text) => o.decode(text),
    deps,
  );
}
