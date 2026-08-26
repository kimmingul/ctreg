import type { Warning } from '../../core/capability.js';
import type { CacheMode, NormalizedQuery } from '../../core/query.js';
import type { Config } from '../../runtime/config.js';
import { unsupportedError, upstreamError } from '../../runtime/errors.js';
import { getJson, peekFormCache, postForm, type HttpDeps } from '../../runtime/http.js';
import { countryOptions, countrySelected, FIELD, hiddenFields, pagerLinks } from './form.js';
import { parseResults, type IctrpPage } from './parse.js';
import { buildForm } from './query.js';

const PATH = '/AdvSearch.aspx';

/**
 * ICTRP 에는 REST API 가 없다. 검색은 ASP.NET 폼 왕복이다:
 * 폼을 GET → ViewState 를 실어 POST → (필요하면) 페이저 postback.
 *
 * **캐시는 답을 담지 기계를 담지 않는다.** ViewState 는 만료될 수 있고, 만료된 것을
 * 캐시에서 꺼내 POST 에 실으면 서버가 조용히 거절한다 — 그렇게 돌아온 페이지에는 건수
 * 문구가 없어 `parse.ts` 가 `records = 0` 으로 읽고, 자기 고장 감지는 `records > 0` 일
 * 때만 걸리므로 **경고 없는 0건** 이 된다. 그래서 사슬의 중간 응답(폼 GET, 그리고 요청한
 * 페이지에 닿기 전의 모든 postback)은 캐시를 읽지도 쓰지도 않는다.
 *
 * 대신 **요청한 페이지의 답** 이 이미 캐시에 있으면 사슬 자체를 건너뛴다. 그래서 같은
 * `--page-token 5` 를 다시 물으면 요청이 0번이면서도, 캐시에서 나온 ViewState 가 POST 에
 * 실리는 일은 없다. 키는 사용자가 준 질의 + 페이지 번호다 — ViewState 를 키에 넣으면
 * 요청마다 달라져 캐시가 영원히 미스다.
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
    ): Promise<{
      page: IctrpPage;
      fetchedAt: string;
      warnings: Warning[];
      raw: string;
      /**
       * 이 화면에서 **다음 페이지로 갈 수 있는가.** 남은 레코드가 있느냐와는 다른 질문이고
       * (그건 `page.records` 가 답한다), 어댑터가 `nextPageToken` 을 만들지 말지를 이걸로
       * 정한다 — 아래 페이저 창 설명 참고.
       */
      nextPageReachable: boolean;
    }> {
      const warnings: Warning[] = [];

      const query = buildForm(q, pageSize);
      // 캐시 키는 **쌍을 뭉개지 않고** 만든다. `Object.fromEntries` 로 접으면 같은 이름이 여러 번
      // 나오는 축(다중 선택 phase)이 마지막 하나만 남아, 서로 다른 질의가 같은 키를 갖는다 —
      // 그러면 --phase phase_2 --phase phase_3 검색이 --phase phase_3 의 캐시를 조용히 돌려받는다.
      // 실제로 보내는 `query` 를 그대로 직렬화하므로 키가 요청과 어긋날 수 없다.
      const cacheKeyParams = { form: JSON.stringify(query), page };
      const cacheable = { ...base, path: PATH, cacheKeyParams, cacheMode };

      const done = (value: string, fetchedAt: string) => ({
        // `raw` 는 이 조회가 최종적으로 받은 결과 페이지 원문이다. `--raw` 가 레코드에
        // 실을 유일한 원문이므로(ICTRP 는 구조화된 응답이 없다) 여기서 그대로 넘긴다.
        page: parseResults(value), fetchedAt, warnings, raw: value,
        nextPageReachable: pagerLinks(value).has(page + 1),
      });

      // 답이 이미 있으면 사슬을 아예 시작하지 않는다 — 요청 0번. 사슬을 돌면서 그 중간
      // 응답을 캐시에서 꺼내는 것과는 다르다: 그쪽은 만료된 ViewState 를 POST 에 싣는다.
      const hit = await peekFormCache<string>(cfg, cacheable, deps);
      if (hit) return done(hit.value, hit.fetchedAt);

      const formPage = await getJson<string>(
        cfg,
        { ...base, path: PATH, params: {}, cacheMode: 'off', accept: 'text/html', decode: (t) => t },
        deps,
      );
      warnings.push(...formPage.warnings);

      /**
       * 나라는 **포털이 가진 표기여야 한다.** 아무 문자열이나 보내면 조용히 좁혀진다 —
       * 실측(2026-08-26, `condition=diabetes` · 상태 ALL): `Japan` 2,981건인데
       * `South Korea` 는 94건이고 표준 이름 `Korea, Republic of` 는 713건이다. 즉 비표준
       * 표기는 오류도 0건도 아닌 **그럴듯하게 좁혀진 수** 를 낸다. 도시(`Seoul`)와
       * 오타(`Zzzland`)는 0건이라 눈에 보이지만 이쪽은 보이지 않는다.
       *
       * 목록은 방금 받은 폼 페이지에서 읽는다 — 코드에 박으면 포털이 바꾸는 날 조용히
       * 틀려진다. 대조는 대소문자만 무시하고, 실어 보내는 것은 **포털의 표기** 다.
       */
      let country: string | undefined;
      if (q.location !== undefined && q.location !== '') {
        const options = countryOptions(formPage.value);
        country = options.find((o) => o.toLowerCase() === q.location!.toLowerCase());
        if (country === undefined) {
          const needle = q.location.toLowerCase();
          const near = options.filter((o) => {
            const s = o.toLowerCase();
            return s.includes(needle) || needle.split(/[\s,]+/).some((w) => w.length > 2 && s.includes(w));
          });
          throw unsupportedError(
            `WHO ICTRP 는 '${q.location}' 를 나라 이름으로 알지 못합니다`,
            (near.length > 0 ? `이런 이름을 찾으셨나요: ${near.slice(0, 5).join(' / ')}. ` : '') +
              'ICTRP 의 나라 필터는 포털이 가진 표기만 받습니다. 다른 표기를 보내면 오류가 아니라 ' +
              '조용히 좁혀진 결과가 나오므로(실측: South Korea 94건 vs Korea, Republic of 713건) ' +
              '여기서 막습니다. 도시나 기관 이름은 이 레지스트리가 아예 받지 않습니다.',
          );
        }
      }

      /**
       * 나라는 텍스트 상자에 적는 것만으로는 검색에 반영되지 않는다. `butAdd` 로 한 번
       * 왕복해 `lstCountriesSelected` 로 옮겨야 한다 — 그러지 않으면 필터가 통째로
       * 사라져 무필터 결과가 나온다(필드테스트가 그렇게 잡았다). 나라를 쓸 때만 이
       * 요청이 하나 는다.
       */
      let formHidden = hiddenFields(formPage.value);
      const selected: [string, string][] = [];
      if (country !== undefined) {
        const added = await postForm<string>(
          cfg,
          {
            ...base, path: PATH,
            form: [...Object.entries(formHidden), [FIELD.country, country], [FIELD.butAdd, '>>']],
            cacheKeyParams: { butAdd: country },
            // 이 응답은 답이 아니라 ViewState 를 나르는 기계다 — 캐시에서 꺼내면 만료된
            // 것이 POST 에 실린다(아래 사슬과 같은 이유).
            cacheMode: 'off',
            decode: (t) => t,
          },
          deps,
        );
        warnings.push(...added.warnings);
        formHidden = hiddenFields(added.value);
        for (const o of countrySelected(added.value)) selected.push([FIELD.countrySelected, o]);
      }

      // 배열로 쌓는 이유: `ListBoxPhase` 처럼 같은 키가 여러 번 나올 수 있는 필드를
      // 객체 스프레드로 합치면 뒤 값이 앞 값을 덮어써 조용히 사라진다(query.ts 참고).
      let html = await postForm<string>(
        cfg,
        {
          ...cacheable,
          form: [...Object.entries(formHidden),
              ...selected, ...query],
          // 이 응답이 요청한 페이지일 때만 캐시한다. 아닐 때는 사슬의 중간이고, 중간을
          // 캐시하면 다음 호출이 묵은 ViewState 를 꺼내 POST 에 싣게 된다.
          cacheMode: page === 1 ? cacheMode : 'off',
          decode: (t) => t,
        },
        deps,
      );
      warnings.push(...html.warnings);

      for (let p = 2; p <= page; p++) {
        /**
         * **없는 대상으로 postback 하지 않는다.** 결과 화면의 페이저는 전체 목록이 아니라
         * 창이고(픽스처: `ctl01`..`ctl10`), 이 루프는 절대 페이지 번호를 그대로 컨트롤
         * 인덱스로 쓴다. 창을 벗어난 대상을 받은 ASP.NET 은 오류를 내지 않고 **엉뚱한
         * 페이지** 를 낸다 — 실측(2026-08-26 필드테스트 「심화 관찰 A」): 12페이지 요청이
         * 한 질의에서는 전체의 마지막 페이지로 건너뛰었고, 다른 질의에서는 20행(페이지
         * 크기의 두 배)을 돌려주었다. 둘 다 경고 없이 exit 0 이었다.
         *
         * 그래서 보낼 대상이 **지금 보내려는 그 화면에** 실제로 있는지 먼저 확인하고,
         * 없으면 `parse.ts` 의 자기 고장 감지와 같은 방식으로 던진다 — 조용히 틀린 답
         * 대신 시끄러운 오류다. 상한은 화면에서 읽으므로 창의 폭이 바뀌면 따라 움직인다.
         */
        const links = pagerLinks(html.value);
        const target = links.get(p);
        if (target === undefined) {
          const deepest = Math.max(p - 1, ...links.keys());
          throw upstreamError(
            `ICTRP 의 ${page}페이지를 요청했지만 ${deepest}페이지까지만 갈 수 있습니다`,
            'ICTRP 는 커서를 주지 않아 결과 화면의 페이저 링크를 눌러 가며 페이지를 넘깁니다. ' +
              `그 화면이 내는 링크는 한 번에 몇 개뿐이라 ${deepest}페이지 너머로는 갈 수 없습니다 — ` +
              '예전에는 없는 링크를 누른 셈이 되어 요청한 것과 다른 페이지가 조용히 나왔습니다. ' +
              '질의를 더 좁히거나(예: 조건·단계 필터 추가) 다른 레지스트리를 쓰세요.',
          );
        }

        const next = await postForm<string>(
          cfg,
          {
            ...cacheable,
            form: [
              ...Object.entries(hiddenFields(html.value)),
              ['__EVENTTARGET', target],
              ['__EVENTARGUMENT', ''],
            ],
            // 위와 같은 이유 — 사슬의 마지막(요청한 페이지)만 캐시한다.
            cacheMode: p === page ? cacheMode : 'off',
            decode: (t) => t,
          },
          deps,
        );
        warnings.push(...next.warnings);
        html = next;
      }

      return done(html.value, html.fetchedAt);
    },
  };
}
export type IctrpClient = ReturnType<typeof makeClient>;
