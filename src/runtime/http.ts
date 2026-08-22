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

type GetJsonOpts = {
  registry: string;
  baseUrl: string;
  path: string;
  params: Record<string, string | number | undefined>;
  cacheMode: CacheMode;
  signal?: AbortSignal;
};

function buildUrl(baseUrl: string, path: string, params: GetJsonOpts['params']): string {
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

export async function getJson<T>(
  cfg: Config,
  o: GetJsonOpts,
  deps: HttpDeps = {},
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const warnings: Warning[] = [];
  // 캐시 키에 base URL 이 들어가야 한다. 없으면 A 서버에서 받은 응답을 B 서버에 대한
  // 요청에 그대로 내주는 false hit 이 된다 — CTREG_*_BASE_URL 로 다른 서버(스테이징,
  // 미러, 테스트 스텁)를 가리켜도 이전 서버의 데이터가 이 서버 것인 양 나온다.
  // cacheKey 의 endpoint 인자에 실어 보낸다 — 요청 URL 의 파라미터 앞부분 그대로다.
  const key = cacheKey(o.registry, o.baseUrl + o.path, o.params);

  if (o.cacheMode === 'use') {
    const hit = await readCache<T>(cfg.cacheDir, key, cfg.cacheTtlSec, now);
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, cached: true, warnings };
  }

  const url = buildUrl(o.baseUrl, o.path, o.params);
  let lastStatus = 0;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const slot = await reserveSlot({
      dir: cfg.cacheDir,
      registry: o.registry,
      ratePerSec: cfg.ratePerSec,
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
      res = await doFetch(url, { signal, headers: { accept: 'application/json' } });
    } catch (cause) {
      if (attempt === cfg.maxRetries) {
        throw upstreamError(`${o.registry} 요청 실패: ${url}`, '네트워크 또는 타임아웃.', cause);
      }
      await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.75 + 0.5 * Math.random()));
      continue;
    }

    lastStatus = res.status;

    if (res.ok) {
      const value = (await res.json()) as T;
      const fetchedAt = new Date(now()).toISOString();
      if (o.cacheMode !== 'off') await writeCache(cfg.cacheDir, key, value, fetchedAt, now);
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
      await shareBackoff({ dir: cfg.cacheDir, registry: o.registry, ratePerSec: cfg.ratePerSec }, untilMs);
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
