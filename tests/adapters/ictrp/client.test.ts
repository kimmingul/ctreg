import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { makeClient } from '../../../src/adapters/ictrp/client.js';
import { FIELD } from '../../../src/adapters/ictrp/form.js';
import { EXIT } from '../../../src/cli/exit-codes.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');
const results = readFileSync(join(__dirname, '../../fixtures/ictrp/results-page1.html'), 'utf8');

const cfg = () => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ictrp-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
});

/** GET 이면 폼을, POST 면 결과를 낸다. 실제 흐름과 같은 순서다. */
function stub(resultsHtml: string = results) {
  const calls: { method: string; body?: string }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, ...(init?.body ? { body: String(init.body) } : {}) });
    return new Response(method === 'GET' ? form : resultsHtml, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/**
 * 페이저 링크를 `ctl01`..`ctl<maxIndex>` 까지만 렌더하는 결과 페이지를 합성한다.
 * 커밋된 픽스처(`results-page1.html`)는 `ctl01`..`ctl10` 을 내는데, 그 폭을 코드에
 * 박아 두면 "화면에서 읽는다" 는 성질 자체를 검사할 수 없다 — 폭이 다른 페이지에서
 * 상한이 따라 움직이는지를 보려면 폭을 마음대로 정할 수 있는 표본이 필요하다.
 */
function pagedResultsHtml(maxIndex: number): string {
  const rows = Array.from(
    { length: 10 },
    (_, i) => `<tr><td>Recruiting</td><td>TEST${i}</td>` +
      `<td><span id="ctl00_ContentPlaceHolder1_GridViewSearch_ctl${String(i + 2).padStart(2, '0')}_Label1">` + `<a href="Trial2.aspx?TrialID=TEST${i}">합성 시험 ${i}</a></span></td><td>2026-01-01</td></tr>`,
  ).join('\n');
  const links = Array.from({ length: maxIndex }, (_, i) => {
    const ctl = String(i + 1).padStart(2, '0');
    return `<a href="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;` +
      `ctl00$ContentPlaceHolder1$dlPager2$ctl${ctl}$lnkPageNo&quot;, &quot;&quot;))">${i + 2}</a>`;
  }).join('\n');
  return `<html><body><span>9999 records for 9000 trials found!</span>` +
    `<table>${rows}</table><table id="ctl00_ContentPlaceHolder1_dlPager2">${links}</table></body></html>`;
}

/**
 * `location` 은 한 번 죽어 있던 축이다 — `txtFreeCountry` 만 채우면 그 값이
 * `lstCountriesSelected` 로 옮겨지지 않아 필터가 서버에 도달하지 않았고, 필드테스트가
 * 그것을 잡아 축을 껐다(실측: 나라 셋이 전부 무필터 기준선과 같은 수).
 *
 * 되살리는 길은 `butAdd` 왕복이고 그것이 실제로 걸린다는 것도 실측했다(2026-08-26,
 * `condition=diabetes` · 상태 ALL): 기준선 36,264 → `Japan` 2,981.
 *
 * 함께 잰 것이 이 검사들의 이유다. `Seoul`(도시)과 `Zzzland`(오타)는 0건이라 눈에 보이게
 * 실패하지만, **`South Korea` 는 94건** 을 낸다 — 성공한 필터처럼 보이는데 표준 이름
 * `Korea, Republic of` 의 713건에 견주면 13% 다. 그래서 어댑터가 폼 페이지의 목록으로
 * 걸러 내고, 걸리면 exit 3 으로 거절한다.
 */
describe('ICTRP 전송 — 나라 필터', () => {
  it('butAdd 왕복을 한 뒤에 검색한다 — 그러지 않으면 필터가 죽는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes', location: 'Japan' }, 20, 1, 'off');

    // GET(폼) → POST(butAdd) → POST(검색). 나라를 쓸 때만 요청이 하나 는다.
    expect(s.calls.map((x) => x.method)).toEqual(['GET', 'POST', 'POST']);
    const add = new URLSearchParams(s.calls[1]?.body ?? '');
    expect(add.get(FIELD.country)).toBe('Japan');
    expect(add.has('ctl00$ContentPlaceHolder1$butAdd')).toBe(true);
  });

  it('나라를 안 쓰면 butAdd 왕복도 없다 — 요청이 늘지 않는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 1, 'off');
    expect(s.calls.map((x) => x.method)).toEqual(['GET', 'POST']);
  });

  it('표준 목록에 없는 이름은 요청을 내지 않고 exit 3 이다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    const err = await c.search({ condition: 'diabetes', location: 'South Korea' }, 20, 1, 'off')
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ exit: EXIT.UNSUPPORTED });
    // 가장 가까운 표준 이름을 알려 줘야 한 번 더 쳐서 고칠 수 있다.
    expect(`${(err as Error).message} ${(err as { hint?: string }).hint ?? ''}`)
      .toContain('Korea, Republic of');
  });

  it('대소문자는 무시한다 — 표기가 같으면 같은 나라다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes', location: 'japan' }, 20, 1, 'off');
    // 폼에는 포털이 가진 표기 그대로 실어야 한다.
    expect(new URLSearchParams(s.calls[1]?.body ?? '').get(FIELD.country)).toBe('Japan');
  });
});

describe('ICTRP 전송', () => {
  it('폼을 먼저 받아 ViewState 를 실어 POST 한다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    const r = await c.search({ condition: 'diabetes' }, 20, 1, 'off');

    expect(r.page.rows.length).toBeGreaterThan(0);
    expect(s.calls[0]?.method).toBe('GET');
    expect(s.calls[1]?.method).toBe('POST');
    // ViewState 를 그대로 되돌려 보내지 않으면 서버가 거절한다.
    expect(s.calls[1]?.body).toContain('__VIEWSTATE=');
  });

  it('질의를 폼 본문에 싣는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 1, 'off');
    const body = new URLSearchParams(s.calls[1]?.body ?? '');
    expect(body.get(FIELD.condition)).toBe('diabetes');
    expect(body.get(FIELD.status)).toBe('ALL');
  });

  /**
   * 페이지 N 을 받으려면 검색을 처음부터 다시 몰아 그 페이지까지 postback 해야 한다 —
   * ICTRP 는 불투명 커서를 주지 않고, 프로세스가 매 호출마다 죽는 CLI 에서 세션을
   * 이어 붙일 방법이 없다. 요청 수가 페이지 수에 비례한다는 것이 그 대가다.
   */
  it('2페이지는 검색 뒤에 페이저 postback 을 한 번 더 한다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 2, 'off');

    expect(s.calls.map((x) => x.method)).toEqual(['GET', 'POST', 'POST']);
    expect(s.calls[2]?.body).toContain(encodeURIComponent('dlPager2$ctl01$lnkPageNo'));
  });

  it('1페이지는 페이저를 부르지 않는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 1, 'off');
    expect(s.calls).toHaveLength(2);
  });

  /**
   * `ListBoxPhase` 는 다중 선택이라 같은 키가 두 번 나와야 한다(query.ts 참고).
   * 이 테스트는 그 pair 가 `client.ts` 를 거쳐 실제 POST 본문까지 살아남는지 —
   * 즉 `buildForm` 이 낸 것을 `client.ts` 가 객체로 접지 않는지 — 를 확인한다.
   */
  it('다중 phase 를 POST 본문에 반복 키로 싣는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes', phase: ['phase_2', 'phase_3'] }, 20, 1, 'off');

    const body = new URLSearchParams(s.calls[1]?.body ?? '');
    expect(body.getAll(FIELD.phase)).toEqual(['Phase 2', 'Phase 3']);
  });

  /**
   * 캐시 키가 `Object.fromEntries` 로 phase pair 를 접으면, 서로 다른 phase 조합이
   * 같은 키를 갖게 되어 두 번째 검색이 첫 번째의 캐시를 조용히 돌려받는다 — 틀린
   * 결과인데 경고도, 실패도 없다. 두 번째 검색이 **여전히 POST 를 낸다** 는 것으로
   * 캐시 키가 실제 질의(반복 키 포함)를 구별한다는 것을 확인한다.
   */
  it('캐시 모드에서도 phase 조합이 다르면 서로 다른 캐시 키를 쓴다', async () => {
    const s = stub();
    // 같은 cacheDir 을 두 검색이 공유해야 캐시 충돌 여부를 볼 수 있다 — cfg() 를 두 번
    // 부르면 매번 새 임시 디렉터리가 나와 이 테스트가 아무것도 검증하지 못한다.
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });

    await c.search({ condition: 'diabetes', phase: ['phase_3'] }, 20, 1, 'use');
    expect(s.calls.filter((x) => x.method === 'POST')).toHaveLength(1);

    await c.search({ condition: 'diabetes', phase: ['phase_2', 'phase_3'] }, 20, 1, 'use');
    // 캐시를 얻어맞았다면 이 두 번째 검색은 POST 없이 끝났을 것이다.
    expect(s.calls.filter((x) => x.method === 'POST')).toHaveLength(2);
  });
});

/**
 * 필드테스트 실측(2026-08-26, `docs/ictrp-field-test-2026-08-26.md` 「심화 관찰 A」):
 * 12페이지를 요청했더니 `condition=diabetes` 는 **전체의 마지막 페이지**(4행)로 건너뛰었고
 * `title=covid` 는 재현 가능하게 **20행**(페이지 크기의 두 배)을 돌려주었다. 둘 다 오류
 * 없이 exit 0 이었다 — 요청한 것과 다른 페이지를 조용히 내주는, 이 CLI 가 없애려는 실패다.
 *
 * 원인: 결과 페이지가 렌더하는 페이저 링크는 창(window)이라 `ctl01`..`ctl10` 뿐인데
 * `client.ts` 는 절대 페이지 번호를 그대로 컨트롤 인덱스로 써서(`pagerTarget(p-1)`)
 * 그 창 밖의 대상으로 postback 한다. 없는 대상을 받은 ASP.NET 은 오류를 내지 않는다.
 */
/**
 * 창의 **마지막 링크는 페이지 번호가 아니라 "Last"** 다. 커밋된 픽스처를 열어 보면
 * `ctl00`→`1` … `ctl09`→`10`, 그리고 `ctl10`→`Last` 다.
 *
 * 그래서 컨트롤 인덱스만 세면 한 칸이 남는다: `ctl10` 이 있으니 11페이지도 갈 수 있다고
 * 판단하고, 실제로는 "Last" 를 눌러 **전체의 마지막 페이지를 11페이지라고 내준다.**
 * 결과가 적은 질의일수록 빨리 닿는다 — 링크가 `ctl01`..`ctl03`(2~4페이지) + `ctl04`=Last
 * 라면 5페이지 요청이 그렇게 된다.
 *
 * 라벨이 화면에 있으므로 구별할 근거가 있다. 컨트롤이 아니라 **라벨** 로 판단한다.
 */
describe('ICTRP 전송 — 창의 마지막 링크가 Last 면 그 자리는 페이지가 아니다', () => {
  it('픽스처의 창에서 11페이지는 갈 수 없다 — ctl10 은 Last 다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await expect(c.search({ condition: 'diabetes' }, 20, 11, 'off')).rejects.toMatchObject({
      exit: EXIT.UPSTREAM,
    });
  });

  it('같은 창에서 10페이지는 갈 수 있다 — ctl09 의 라벨이 10 이다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await expect(c.search({ condition: 'diabetes' }, 20, 10, 'off')).resolves.toBeDefined();
  });
});

describe('ICTRP 전송 — 도달할 수 없는 페이지는 조용히 다른 페이지를 내지 않는다', () => {
  it('픽스처가 내는 페이저 창(번호 링크 2~10) 너머를 요청하면 오류로 낸다', async () => {
    const c = makeClient(cfg(), 1000, { fetchImpl: stub().fetchImpl, sleep: async () => {} });

    // 요청한 페이지(12)와 갈 수 있는 가장 깊은 페이지(10)가 둘 다 문구에 있어야 한다 —
    // 어느 한쪽이 빠지면 사용자는 무엇을 얼마나 줄여야 하는지 알 수 없다.
    // 10 인 이유: 창의 번호 링크는 2~10 이고 ctl10 은 Last 라 페이지가 아니다.
    const err = await c.search({ condition: 'diabetes' }, 20, 12, 'off').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'upstream' });
    expect((err as Error).message).toContain('12');
    expect((err as Error).message).toContain('10');
  });

  /**
   * 이 검사는 예전에 11페이지를 요청하고 마지막 postback 이 `ctl10` 인지 보았다. 그것이
   * 바로 버그였다 — `ctl10` 은 11페이지가 아니라 `Last` 다. 의도(창 안쪽은 막지 않는다)는
   * 그대로 두고, 창의 **진짜** 끝인 10페이지로 바꾼다.
   */
  it('창 안쪽(10페이지)은 그대로 간다 — 도달 가능한 깊이까지는 막지 않는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    const r = await c.search({ condition: 'diabetes' }, 20, 10, 'off');

    expect(r.page.rows.length).toBeGreaterThan(0);
    // 마지막 postback 은 10페이지의 링크(ctl09)여야 한다 — Last(ctl10)가 아니다.
    expect(s.calls.at(-1)?.body).toContain(encodeURIComponent('dlPager2$ctl09$lnkPageNo'));
    expect(s.calls.at(-1)?.body).not.toContain(encodeURIComponent('dlPager2$ctl10$lnkPageNo'));
  });

  /** 상한은 코드에 박힌 11 이 아니라 **그 화면이 실제로 낸 링크** 에서 나와야 한다. */
  it('페이저 창이 좁은 화면에서는 상한도 그만큼 좁아진다', async () => {
    const c = makeClient(cfg(), 1000, { fetchImpl: stub(pagedResultsHtml(3)).fetchImpl, sleep: async () => {} });

    const err = await c.search({ condition: 'diabetes' }, 20, 5, 'off').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'upstream' });
    expect((err as Error).message).toContain('5');
    expect((err as Error).message).toContain('4');

    // 창 안쪽(4페이지)은 같은 화면에서도 통과한다.
    const ok = makeClient(cfg(), 1000, { fetchImpl: stub(pagedResultsHtml(3)).fetchImpl, sleep: async () => {} });
    await expect(ok.search({ condition: 'diabetes' }, 20, 4, 'off')).resolves.toBeDefined();
  });

  /** 다음 페이지에 갈 수 있는지를 어댑터가 알 수 있어야 `nextPageToken` 을 멈출 수 있다. */
  it('다음 페이지 도달 가능 여부를 화면에서 읽어 함께 낸다', async () => {
    const c = makeClient(cfg(), 1000, { fetchImpl: stub().fetchImpl, sleep: async () => {} });
    // 픽스처는 ctl01..ctl10 을 낸다 — 1페이지에서 2페이지(ctl01)로는 갈 수 있다.
    expect((await c.search({ condition: 'diabetes' }, 20, 1, 'off')).nextPageReachable).toBe(true);

    const narrow = makeClient(cfg(), 1000, {
      fetchImpl: stub(pagedResultsHtml(0)).fetchImpl, sleep: async () => {},
    });
    // 페이저 링크가 하나도 없는 화면에서는 다음 페이지로 갈 방법이 없다.
    expect((await narrow.search({ condition: 'diabetes' }, 20, 1, 'off')).nextPageReachable).toBe(false);
  });
});

/**
 * 이 파일 맨 위 `client.ts` 의 머리말은 폼 GET 을 캐시하지 않는 이유를 적어 두었다:
 * 만료된 ViewState 를 캐시에서 꺼내 POST 하면 서버가 조용히 거절하고, 그렇게 돌아온
 * 페이지에는 건수 문구가 없어 `parse.ts` 가 `records = 0` 으로 읽는다 — 자기 고장 감지는
 * `records > 0` 일 때만 걸리므로 **경고 없는 0건** 이 된다. 그런데 페이저 사슬은 그
 * 금지사항을 그대로 하고 있었다: 최대 `cacheTtlSec`(기본 1시간) 묵은 캐시 히트일 수 있는
 * 중간 응답에서 `hiddenFields` 를 뽑아 다음 POST 에 실었다.
 *
 * 규칙: 캐시는 **답** 을 담지 **기계** 를 담지 않는다. 요청한 페이지가 캐시에 있으면
 * 사슬 자체를 건너뛰고, 없으면 사슬의 중간 요청은 캐시를 읽지도 쓰지도 않는다.
 */
describe('ICTRP 전송 — 캐시는 답만 담는다', () => {
  it('같은 페이지를 다시 요청하면 사슬 전체를 건너뛴다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });

    await c.search({ condition: 'diabetes' }, 20, 2, 'use');
    expect(s.calls.map((x) => x.method)).toEqual(['GET', 'POST', 'POST']);

    await c.search({ condition: 'diabetes' }, 20, 2, 'use');
    // 요청이 하나라도 늘었다면 답이 아니라 기계를 다시 얻으러 간 것이다.
    expect(s.calls).toHaveLength(3);
  });

  it('다른 페이지를 요청하면 중간 응답을 캐시에서 꺼내지 않는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });

    await c.search({ condition: 'diabetes' }, 20, 2, 'use');
    expect(s.calls).toHaveLength(3);

    await c.search({ condition: 'diabetes' }, 20, 3, 'use');
    // 3페이지 사슬은 GET + 검색 POST + postback 2번이다. 중간(2페이지) 응답을 캐시에서
    // 꺼내 쓰면 여기서 요청이 하나 줄고, 그때 실리는 ViewState 는 최대 1시간 묵은 것이다.
    expect(s.calls.slice(3).map((x) => x.method)).toEqual(['GET', 'POST', 'POST', 'POST']);
  });
});
