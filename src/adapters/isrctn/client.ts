import type { CacheMode } from '../../core/query.js';
import type { Config } from '../../runtime/config.js';
import { getJson, type HttpDeps } from '../../runtime/http.js';
import { upstreamError } from '../../runtime/errors.js';
import { parseIsrctnXml } from './xml.js';

/** WHO 포맷 응답의 최상위. 시험이 없으면 `<trials/>` 라서 `trial` 이 아예 없다. */
export type WhoResponse = { trials?: { trial?: unknown[] } };

/**
 * `default` 포맷을 `limit=0` 으로 부르면 `<allTrials totalCount="1118"/>` 만 온다 —
 * 실측 80바이트다. 총계를 얻는 데 시험 본문을 한 건도 받지 않아도 된다는 뜻이라,
 * `count` 커맨드는 물론 `search` 의 total 도 거의 공짜로 채울 수 있다.
 */
export type CountResponse = { allTrials?: { '@totalCount'?: string } };

export function makeClient(cfg: Config, ratePerSec: number, deps: HttpDeps = {}) {
  const base = { registry: 'isrctn' as const, baseUrl: cfg.isrctnBaseUrl, ratePerSec, accept: 'application/xml' };

  return {
    /** 레코드 본문. WHO 포맷이라야 상태·시작일이 있다 — map.ts 의 주석 참고. */
    who: (q: string, limit: number, cacheMode: CacheMode) =>
      getJson<WhoResponse>(
        cfg,
        {
          ...base,
          path: '/api/query/format/who',
          params: { q, limit },
          cacheMode,
          decode: (text) => parseIsrctnXml(text) as WhoResponse,
        },
        deps,
      ),

    /** 총계만. 본문을 받지 않는다. */
    total: async (q: string, cacheMode: CacheMode) => {
      const res = await getJson<CountResponse>(
        cfg,
        {
          ...base,
          path: '/api/query/format/default',
          params: { q, limit: 0 },
          cacheMode,
          decode: (text) => parseIsrctnXml(text) as CountResponse,
        },
        deps,
      );
      const raw = res.value.allTrials?.['@totalCount'];
      const total = raw === undefined ? undefined : Number(raw);
      if (total === undefined || !Number.isFinite(total)) {
        // 총계를 못 읽었는데 0 을 돌려주면 "해당 시험이 없다" 가 된다. 못 읽은 것은
        // 실패다 — ISRCTN 이 200 안에 오류를 숨기는 레지스트리라 더욱 그렇다.
        throw upstreamError(
          'ISRCTN 응답에서 totalCount 를 읽지 못했습니다',
          '업스트림 응답 형식이 바뀌었을 수 있습니다. --raw 로 원문을 확인하세요.',
        );
      }
      return { ...res, total };
    },
  };
}
export type IsrctnClient = ReturnType<typeof makeClient>;
