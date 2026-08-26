import type { Warning } from '../../core/capability.js';
import type { CacheMode, NormalizedQuery } from '../../core/query.js';
import type { Config } from '../../runtime/config.js';
import { getJson, postForm, type HttpDeps } from '../../runtime/http.js';
import { hiddenFields, pagerTarget } from './form.js';
import { parseResults, type IctrpPage } from './parse.js';
import { buildForm } from './query.js';

const PATH = '/AdvSearch.aspx';

/**
 * ICTRP 에는 REST API 가 없다. 검색은 ASP.NET 폼 왕복이다:
 * 폼을 GET → ViewState 를 실어 POST → (필요하면) 페이저 postback.
 *
 * **폼 GET 은 캐시하지 않는다.** ViewState 는 만료될 수 있고, 만료된 것을 캐시에서
 * 꺼내 쓰면 POST 가 조용히 거절된다. 캐시하는 것은 **결과 페이지** 이고 키는
 * 사용자가 준 질의 + 페이지 번호다 — ViewState 를 키에 넣으면 요청마다 달라져
 * 캐시가 영원히 미스다.
 */
export function makeClient(cfg: Config, ratePerSec: number, deps: HttpDeps = {}) {
  const base = { registry: 'ictrp' as const, baseUrl: cfg.ictrpBaseUrl, ratePerSec };

  return {
    /** `page` 는 1-기반. 2 이상이면 검색 뒤에 페이저 postback 을 그만큼 더 한다. */
    async search(
      q: NormalizedQuery,
      pageSize: number,
      page: number,
      cacheMode: CacheMode,
    ): Promise<{ page: IctrpPage; fetchedAt: string; warnings: Warning[] }> {
      const warnings: Warning[] = [];

      const formPage = await getJson<string>(
        cfg,
        { ...base, path: PATH, params: {}, cacheMode: 'off', accept: 'text/html', decode: (t) => t },
        deps,
      );
      warnings.push(...formPage.warnings);

      const query = buildForm(q, pageSize);
      const cacheKeyParams = { ...Object.fromEntries(query), page };

      // 배열로 쌓는 이유: `ListBoxPhase` 처럼 같은 키가 여러 번 나올 수 있는 필드를
      // 객체 스프레드로 합치면 뒤 값이 앞 값을 덮어써 조용히 사라진다(query.ts 참고).
      let html = await postForm<string>(
        cfg,
        {
          ...base,
          path: PATH,
          form: [...Object.entries(hiddenFields(formPage.value)), ...query],
          cacheKeyParams,
          cacheMode,
          decode: (t) => t,
        },
        deps,
      );
      warnings.push(...html.warnings);

      for (let p = 2; p <= page; p++) {
        const next = await postForm<string>(
          cfg,
          {
            ...base,
            path: PATH,
            form: [
              ...Object.entries(hiddenFields(html.value)),
              ['__EVENTTARGET', pagerTarget(p - 1)],
              ['__EVENTARGUMENT', ''],
            ],
            cacheKeyParams: { ...cacheKeyParams, page: p },
            cacheMode,
            decode: (t) => t,
          },
          deps,
        );
        warnings.push(...next.warnings);
        html = next;
      }

      return { page: parseResults(html.value), fetchedAt: html.fetchedAt, warnings };
    },
  };
}
export type IctrpClient = ReturnType<typeof makeClient>;
