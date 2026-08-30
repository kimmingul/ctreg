import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSupported } from '../../../src/cli/guard.js';
import { createIctrpAdapter, ICTRP_CAPABILITY } from '../../../src/adapters/ictrp/adapter.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../../src/core/query.js';
import type { CtregError } from '../../../src/runtime/errors.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');
const results = readFileSync(join(__dirname, '../../fixtures/ictrp/results-page1.html'), 'utf8');

const cfg = () => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ictrp-adapter-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
        crisBaseUrl: 'https://cris.example.test',
        ctisBaseUrl: 'https://ctis.example.test',
        ictrpAcknowledged: true,
});

/** GET 이면 폼을, POST 면 `resultsHtml` 을 낸다 — client.test.ts 의 스텁과 같은 모양이다. */
function stub(resultsHtml: string = results) {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    return new Response(method === 'GET' ? form : resultsHtml, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return fetchImpl;
}

/** 위 스텁과 같되 나간 POST 본문을 남긴다 — 어느 페이지를 실제로 요청했는지 보려면 필요하다. */
function recordingStub(resultsHtml: string = results) {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') bodies.push(String(init?.body ?? ''));
    return new Response(method === 'GET' ? form : resultsHtml, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

/**
 * 레코드는 많이 남았다고 말하면서 페이저 링크는 하나도 내지 않는 결과 페이지.
 * "다음 페이지가 있다(레코드가 남았다)" 와 "다음 페이지에 갈 수 있다(링크가 있다)" 는
 * 다른 사실이고, 이 둘이 갈리는 자리가 바로 잘못된 토큰이 만들어지던 곳이다.
 */
function noPagerResultsHtml(): string {
  const rows = Array.from(
    { length: 10 },
    (_, i) => `<tr><td>Recruiting</td><td>TEST${i}</td>` +
      `<td><span id="ctl00_ContentPlaceHolder1_GridViewSearch_ctl${String(i + 2).padStart(2, '0')}_Label1">` + `<a href="Trial2.aspx?TrialID=TEST${i}">합성 시험 ${i}</a></span></td><td>2026-01-01</td></tr>`,
  ).join('\n');
  return `<html><body><span>40635 records for 36264 trials found!</span><table>${rows}</table></body></html>`;
}

/**
 * 전체가 페이지 크기(10)보다 적은 결과 페이지를 인라인으로 합성한다. `parse.ts` 가
 * 실제로 보는 모양(건수 문구 + `TrialID=` 를 포함한 행 셀들)만 갖추면 되므로, 커밋된
 * 픽스처(`results-page1.html`)를 건드리지 않고도 "전체가 페이지보다 작을 때" 를
 * 재현할 수 있다.
 */
function smallResultsHtml(n: number): string {
  const rows = Array.from(
    { length: n },
    (_, i) => `<tr><td>Recruiting</td><td></td><td>TEST${i}</td>` +
      `<td><span id="ctl00_ContentPlaceHolder1_GridViewSearch_ctl${String(i + 2).padStart(2, '0')}_Label1">` + `<a href="Trial2.aspx?TrialID=TEST${i}">합성 시험 ${i}</a></span></td><td>2026-01-01</td></tr>`,
  ).join('\n');
  return `<html><body><span>${n} records for ${n} trials found!</span><table>${rows}</table></body></html>`;
}

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off', raw: false,
};

/**
 * `guard.ts` 의 `applyLimits` 는 요청이 상한(10)을 **넘을 때만** 경고한다. ICTRP 는
 * pageSize 를 실제로 받지 않고 항상 고정 크기(10)를 낸다(query.ts) — 그래서 10 아래로
 * 요청했는데 그보다 많이 돌아오면 축소 요청이 조용히 사라진 것이고, 그 경우를 알리는
 * 자리가 없으면 `applyLimits` 도 어댑터도 아무 말을 안 한다. `page_size_floor` 가 그
 * 빈 자리를 메운다 — `page_size_clamped`(위로 넘친 요청)와 방향이 정반대라 코드를
 * 분리했다(adapter.ts 참고).
 */
describe('ICTRP 어댑터 — 페이지 크기 하한 경고', () => {
  it('요청한 pageSize 보다 실제로 더 받으면 page_size_floor 경고가 붙는다', async () => {
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: stub(), sleep: async () => {} });
    const r = await adapter.search({ condition: 'diabetes', pageSize: 3 } as NormalizedQuery, fetchOpts);

    // 표본이 실제로 3건보다 많이 돌아오지 않으면 이 검사는 공허하게 통과한다.
    expect(r.data.length, '표본 응답이 3건 이하라 페이지 크기 하한을 검사할 수 없습니다.').toBeGreaterThan(3);

    const w = r.warnings.find((x) => x.code === 'page_size_floor');
    expect(w, 'page_size_floor 경고가 없습니다.').toBeDefined();
    expect(w?.registry).toBe('ictrp');
    // 요청한 수(3)와 이 레지스트리의 고정 크기(10) 둘 다 문구에 있어야 한다 —
    // 어느 쪽이 빠지면 호출자는 무엇을 요청했고 무엇을 받았는지 재구성할 수 없다.
    expect(w?.message).toContain('3');
    expect(w?.message).toContain('10');
  });

  /**
   * 흔한 경로: CLI 기본 pageSize 는 20 이고, `applyLimits` 가 이미 10 으로 깎아
   * `page_size_clamped` 를 냈다(guard.ts). 어댑터가 받는 `q.pageSize` 는 그 결과인
   * 10 이다 — 요청과 실제가 같으므로 `page_size_floor` 가 또 붙으면 같은 사실을
   * 두 번 다른 코드로 말하는 것이 된다.
   */
  it('이미 클램프된 pageSize(10)로는 page_size_floor 가 붙지 않는다', async () => {
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: stub(), sleep: async () => {} });
    const r = await adapter.search({ condition: 'diabetes', pageSize: 10 } as NormalizedQuery, fetchOpts);

    expect(r.warnings.some((w) => w.code === 'page_size_floor')).toBe(false);
  });

  /**
   * 리뷰가 재현한 것: 전체가 4건뿐인 질의에 `pageSize: 2` 를 요청하면 4건이 그대로
   * 돌아온다(자를 게 없다 — 이게 결과 전부다) — 그런데도 트리거(`data.length >
   * q.pageSize`)는 맞게 발화해야 한다("2보다 많이 받았다" 는 참이다). 문제는 문구
   * 였다: "언제나 10건" 이라고 단정하면 이 응답(4건)과 어긋나는 거짓말이 된다.
   * 트리거는 그대로 두고 문구만 "몇 건을 요청했더니 몇 건이 왔다" + "메커니즘은
   * 고정 페이지 크기다" 로 나눠 말해야 어떤 응답에 붙어도 참이다.
   */
  it('전체가 페이지 크기보다 적어도 경고 문구가 실제 응답과 어긋나는 수를 말하지 않는다', async () => {
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: stub(smallResultsHtml(4)), sleep: async () => {} });
    const r = await adapter.search({ condition: 'diabetes', pageSize: 2 } as NormalizedQuery, fetchOpts);

    expect(r.data.length, '합성 응답이 4건을 내지 않아 이 시나리오를 재현하지 못했습니다.').toBe(4);

    const w = r.warnings.find((x) => x.code === 'page_size_floor');
    expect(w, 'page_size_floor 경고가 없습니다 — 트리거(요청보다 많이 받음)는 여전히 참이어야 합니다.').toBeDefined();
    // 요청한 수(2)와 실제로 받은 수(4)는 문구에 있어야 한다 — 이 응답 자체에 대한 사실이다.
    expect(w?.message).toContain('2');
    expect(w?.message).toContain('4');
    // 이 응답은 4건만 실었다. "결과 페이지는 언제나 10건입니다" 류의, 이 응답과
    // 어긋나는 확정 문장이 있으면 안 된다 — 고정값(10)은 "페이지 크기 상한" 이라는
    // 메커니즘으로만 등장해야지, 이 응답이 실제로 낸 건수인 것처럼 말하면 안 된다.
    expect(w?.message).not.toMatch(/언제나\s*10\s*건(입니다|이\s*(돌아왔|있)습니다)/);
  });
});

/**
 * 필드테스트 실측(2026-08-26): 국가 세 개를 각각 걸어도 세 번 다 미적용 기준선과
 * 같은 건수가 나왔다 — `txtFreeCountry` 는 채워지지만 `butAdd` postback 없이는
 * `lstCountriesSelected` 로 옮겨지지 않아 필터가 서버까지 가지 않는다. `location`
 * 을 `off()` 로 돌린 결정을 여기 못박는다 — 이 테스트가 없으면 나중에 누군가
 * "폼에 필드가 있으니" 하고 `free()` 로 되돌릴 수 있고, 그러면 이 축은 다시
 * 조용히 전 세계를 돌려주는 축으로 돌아간다.
 */
/**
 * 이 축은 한 번 꺼졌다가 다시 켜졌다. 끈 이유는 `txtFreeCountry` 만 채우면 필터가 서버에
 * 도달하지 않아 **조용히 무필터 결과** 가 나왔기 때문이고(필드테스트가 잡았다), 켤 수 있게
 * 된 이유는 `butAdd` 왕복이 실제로 필터를 건다는 것을 실측했기 때문이다(2026-08-26:
 * 기준선 36,264 → 왕복 후 `Japan` 2,981).
 *
 * 예전 검사 둘은 축이 꺼져 있다는 것을 고정하고 있었다. 사실이 바뀌었으므로 검사도 바꾼다 —
 * 다만 **약화하지 않는다**: 이제 고정하는 것은 "축이 켜졌다" 가 아니라 "켜졌고, 값 검증이
 * 그대로 붙어 있다" 이다. 검증이 없으면 `South Korea` 가 713건 대신 94건을 조용히 낸다.
 */
describe('ICTRP 어댑터 — location 축은 되살아났다', () => {
  it('location 을 쓰면 이제 가드가 막지 않는다', () => {
    expect(() =>
      assertSupported(ICTRP_CAPABILITY, { location: 'Japan' } as NormalizedQuery, fetchOpts),
    ).not.toThrow();
  });

  it('자유 텍스트 축의 모양(values: null)이다 — 목록은 요청 시점에 포털에서 읽는다', () => {
    expect(ICTRP_CAPABILITY.search.location.supported).toBe(true);
    expect(ICTRP_CAPABILITY.search.location.values).toBeNull();
  });

  it('scope 가 나라만 본다는 것과 표기 제약을 함께 말한다', () => {
    const scope = ICTRP_CAPABILITY.search.location.scope;
    expect(scope).toContain('나라');
    // 도시·기관을 못 본다는 것과, 표기가 틀리면 거절된다는 것 둘 다 말해야 한다.
    expect(scope).toMatch(/도시/);
    expect(scope).toMatch(/exit 3|거절/);
  });
});

/**
 * ICTRP 의 페이지 토큰은 불투명 커서가 아니라 **페이지 번호** 다(설계 §3.2 — ViewState 는
 * 11.7KB 이상이라 봉투에 실을 수 없다). 그래서 다른 레지스트리의 토큰이나 사람이 손으로 쓴
 * 값이 그대로 들어올 수 있는데, `Number()` 는 그것들을 조용히 삼킨다. 리뷰가 픽스처로
 * 재현한 것들:
 *
 * - ctgov 모양의 `'CAESBnNvbWV0'` → NaN. 1페이지가 나가고 `nextPageToken` 이 `"NaN"` 이
 *   되어, 토큰을 따라가는 호출자는 1페이지를 영원히 되풀이한다.
 * - `'0'` → 1페이지, 다음 토큰 `"1"`. `'-3'` → 1페이지, 다음 토큰 `"-2"`.
 * - `'2.7'` → 2페이지 행들이 `2.7` 페이지인 양 나가고 다음 토큰은 `"3.7"`.
 *
 * 넷 다 경고 없이 exit 0 이었다 — 요청한 것과 다른 페이지를 조용히 내주는 자리다.
 * 인자 자체가 잘못된 경우이므로 exit 2(usage)로 낸다.
 */
describe('ICTRP 어댑터 — pageToken 검증', () => {
  it('정수 페이지 번호는 그 페이지의 postback 까지 간다', async () => {
    const s = recordingStub();
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await adapter.search({ condition: 'diabetes', pageToken: '2' } as NormalizedQuery, fetchOpts);

    // 2페이지는 검색 POST 뒤에 페이저 postback 한 번이다(form.ts: 2페이지가 ctl01).
    expect(s.bodies).toHaveLength(2);
    expect(s.bodies[1]).toContain(encodeURIComponent('dlPager2$ctl01$lnkPageNo'));
  });

  const 잘못된토큰: [string, string][] = [
    ['ctgov 모양의 불투명 커서', 'CAESBnNvbWV0'],
    ['0 — 페이지 번호는 1부터다', '0'],
    ['음수', '-3'],
    ['소수', '2.7'],
  ];
  for (const [설명, token] of 잘못된토큰) {
    it(`${설명}(${token})은 exit 2 로 거부한다 — 조용히 다른 페이지를 내지 않는다`, async () => {
      const s = recordingStub();
      const adapter = createIctrpAdapter(cfg(), { fetchImpl: s.fetchImpl, sleep: async () => {} });

      await expect(
        adapter.search({ condition: 'diabetes', pageToken: token } as NormalizedQuery, fetchOpts),
      ).rejects.toMatchObject({ code: 'usage', exit: 2 });
      // 거부는 요청을 내기 **전에** 끝나야 한다 — 틀린 토큰으로 업스트림을 두드릴 이유가 없다.
      expect(s.bodies).toHaveLength(0);
    });
  }

  it('토큰이 없으면 1페이지다 — 기존 동작 그대로', async () => {
    const s = recordingStub();
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: s.fetchImpl, sleep: async () => {} });
    const r = await adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts);

    expect(s.bodies).toHaveLength(1); // 검색 POST 하나뿐 — 페이저를 부르지 않았다.
    expect(r.data.length).toBeGreaterThan(0);
  });
});

/**
 * 토큰은 **다음 페이지에 실제로 갈 수 있을 때만** 나와야 한다. 레코드가 남았다는 것만 보고
 * 매 페이지 토큰을 찍어내면, 그 사슬을 따라간 호출자는 페이저 창 밖으로 걸어 나가
 * 요청한 것과 다른 페이지를 받는다(client.test.ts 의 「도달할 수 없는 페이지」 참고).
 * 잘못된 곳으로 데려가는 토큰은 없는 토큰보다 나쁘다.
 */
describe('ICTRP 어댑터 — nextPageToken 은 갈 수 있는 곳만 가리킨다', () => {
  it('다음 페이지에 갈 수 있으면 토큰을 낸다', async () => {
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: stub(), sleep: async () => {} });
    const r = await adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts);

    expect(r.nextPageToken).toBe('2');
  });

  it('레코드가 남았어도 갈 수 없으면 토큰 대신 경고를 낸다', async () => {
    const adapter = createIctrpAdapter(cfg(), { fetchImpl: stub(noPagerResultsHtml()), sleep: async () => {} });
    const r = await adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts);

    // 남은 레코드는 분명히 있다 — 그런데도 토큰을 만들면 안 된다.
    expect(r.total).toBe(36264);
    expect(r.nextPageToken).toBeUndefined();
    // 침묵으로 끝내면 "이게 전부" 로 읽힌다 — 왜 여기서 멈췄는지는 말해야 한다.
    const depth = r.warnings.find((w) => w.code === 'pagination_depth_limit');
    expect(depth).toBeDefined();
    /**
     * **어느 수를 말하는지가 중요하다.** 페이지는 시험 위를 걷는다 — 남은 쪽을 세는
     * 것도 시험 수(36,264)여야 하고, 레코드 수(40,635)를 말하면 사용자가 실제보다 훨씬
     * 많이 놓친 것으로 읽는다. 이 픽스처는 두 수가 다르므로 그 차이가 드러난다.
     */
    expect(depth?.message).toContain('36264');
    expect(depth?.message).not.toContain('40635');
  });
});

/**
 * **페이지가 무엇 위를 걷는가.** ICTRP 화면은 두 수를 낸다 — 실측 2026-08-28:
 * `593 records for 383 trials`. 본 그리드는 한 쪽에 **시험** 열 개를 싣고(같은 시험의
 * 다른 등록은 접히는 패널 안에 들어간다), 그래서 페이지는 **시험** 위를 걷는다.
 *
 * 페이지 경계를 `records` 로 재면 있지도 않은 페이지가 남은 것처럼 보인다. 593/10 은
 * 60 쪽인데 실제로는 383/10 = 39 쪽뿐이다. 마지막 쪽에서 토큰이 끊길 때 나오는 경고가
 * "593건 중 39페이지까지만" 이라고 말하면, **다 받은 사용자에게 아직 남았다고 거짓말** 한다.
 *
 * (이 어긋남은 파서를 고치기 전에는 드러나지 않았다. 그때는 한 쪽이 패널 속 등록까지
 * 섞어 16행쯤을 냈고, 그 합이 우연히 `records` 에 가까웠다.)
 */
describe('ICTRP 페이지는 레코드가 아니라 시험 위를 걷는다', () => {
  /** 레코드는 많고 시험은 한 쪽에 다 들어가는 결과 페이지. 페이저 링크는 있다. */
  function recordsExceedTrialsHtml(): string {
    const rows = Array.from(
      { length: 10 },
      (_, i) => `<tr><td>Recruiting</td><td></td>` +
        `<td><span id="ctl00_ContentPlaceHolder1_GridViewSearch_ctl${String(i + 2).padStart(2, '0')}_Label1">` +
        `<a href="Trial2.aspx?TrialID=TEST${i}">합성 시험 ${i}</a></span></td><td>2026-01-01</td></tr>`,
    ).join('\n');
    const link =
      `<a href="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;` +
      `ctl00$ContentPlaceHolder1$dlPager2$ctl01$lnkPageNo&quot;, &quot;&quot;))">2</a>`;
    // 시험 10개가 1쪽에 다 들어간다. 레코드는 100개다(같은 시험의 여러 등록).
    return `<html><body><span>100 records for 10 trials found!</span><table>${rows}</table>${link}</body></html>`;
  }

  it('시험이 한 쪽에 다 들어가면 레코드가 남아 있어도 토큰을 내지 않는다', async () => {
    const adapter = createIctrpAdapter(cfg(), {
      fetchImpl: stub(recordsExceedTrialsHtml()),
      sleep: async () => {},
    });
    const r = await adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts);

    expect(r.total).toBe(10);
    expect(r.data).toHaveLength(10);
    // 2쪽 링크가 화면에 있어도, 걸어야 할 시험이 더 없으면 데려갈 곳이 없다.
    expect(r.nextPageToken).toBeUndefined();
    // 다 받았으므로 "아직 남았는데 못 간다" 는 경고도 나오면 안 된다.
    expect(r.warnings.map((w) => w.code)).not.toContain('pagination_depth_limit');
  });
});

/**
 * **ICTRP 는 기본으로 꺼져 있다.**
 *
 * 이 어댑터는 사람이 쓰는 검색 화면을 포스트백으로 조작한다. WHO 가 자동 접근을 위해
 * 제공하는 것은 둘인데(Web Service, Crawling Service) **둘 다 사무국과의 합의와 비용을
 * 요구하고**, `trialsearch.who.int/robots.txt` 는 `Disallow: /` 다. 크롤 서비스 이용
 * 조건도 "an **agreed partner** website" 라고 못박는다(2026-08-29 확인).
 *
 * 그래서 기본값을 끈다. 지우지는 않는다 — 합의가 있는 사용자에게서 기능을 뺏을 이유가 없다.
 * **끄는 방식이 중요하다**: 0건이 아니라 exit 3 이어야 한다. 0건으로 끄면 "그런 시험이
 * 없다" 와 구별되지 않는다.
 */
describe('ICTRP 는 합의를 확인하기 전에는 조회하지 않는다', () => {
  const noAck = () => ({ ...cfg(), ictrpAcknowledged: false });

  it('합의 표시가 없으면 exit 3 으로 막는다 — 0건이 아니다', async () => {
    const adapter = createIctrpAdapter(noAck(), { fetchImpl: stub(), sleep: async () => {} });
    await expect(
      adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('요청을 아예 보내지 않는다', async () => {
    const { fetchImpl, bodies } = recordingStub();
    const adapter = createIctrpAdapter(noAck(), { fetchImpl, sleep: async () => {} });
    await adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts).catch(() => {});
    expect(bodies).toEqual([]);
  });

  it('메시지가 무엇을 해야 하는지 말한다 — 연락처와 켜는 법', async () => {
    const adapter = createIctrpAdapter(noAck(), { fetchImpl: stub(), sleep: async () => {} });
    try {
      await adapter.count({ condition: 'diabetes' } as NormalizedQuery, fetchOpts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as CtregError;
      const all = `${err.message} ${err.hint ?? ''}`;
      expect(all).toContain('ictrpinfo@who.int');
      expect(all).toContain('CTREG_ICTRP_ACKNOWLEDGED');
    }
  });

  it('capability 는 키 없이도 읽을 수 있다 — registries 가 막히면 안 된다', () => {
    const adapter = createIctrpAdapter(noAck(), { fetchImpl: stub(), sleep: async () => {} });
    expect(adapter.capability().key).toBe('ictrp');
  });

  it('합의를 표시하면 그대로 동작한다', async () => {
    const adapter = createIctrpAdapter(
      { ...cfg(), ictrpAcknowledged: true },
      { fetchImpl: stub(), sleep: async () => {} },
    );
    const r = await adapter.search({ condition: 'diabetes' } as NormalizedQuery, fetchOpts);
    expect(r.data.length).toBeGreaterThan(0);
  });
});
