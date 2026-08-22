import type { CacheMode } from '../../core/query.js';
import type { Config } from '../../runtime/config.js';
import { getJson, type HttpDeps } from '../../runtime/http.js';

/**
 * `ratePerSec` 는 호출자(어댑터)가 자기 capability 선언에서 직접 건네준다 — client.ts 가
 * `CTGOV_CAPABILITY` 를 import 하면 adapter.ts ↔ client.ts 순환 참조가 생기고, 이
 * 클라이언트가 ctgov 전용이 아니게 하려는 목적과도 어긋난다. getJson 에 그대로 실어
 * 보내면, cfg.ratePerSec(전역 오버라이드)이 없을 때 이 값이 쓰인다(http.ts 참고).
 */
export function makeClient(cfg: Config, ratePerSec: number, deps: HttpDeps = {}) {
  const base = { registry: 'ctgov' as const, baseUrl: cfg.ctgovBaseUrl, ratePerSec };
  return {
    studies: (params: Record<string, string | number | undefined>, cacheMode: CacheMode) =>
      getJson<{ studies?: unknown[]; totalCount?: number; nextPageToken?: string }>(
        cfg,
        { ...base, path: '/studies', params, cacheMode },
        deps,
      ),
    study: (nctId: string, params: Record<string, string | number | undefined>, cacheMode: CacheMode) =>
      getJson<unknown>(cfg, { ...base, path: `/studies/${nctId}`, params, cacheMode }, deps),
  };
}
export type CtgovClient = ReturnType<typeof makeClient>;
