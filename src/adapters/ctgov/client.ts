import type { CacheMode } from '../../core/query.js';
import type { Config } from '../../runtime/config.js';
import { getJson, type HttpDeps } from '../../runtime/http.js';

export function makeClient(cfg: Config, deps: HttpDeps = {}) {
  const base = { registry: 'ctgov' as const, baseUrl: cfg.ctgovBaseUrl };
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
