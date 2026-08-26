import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSupported } from '../../../src/cli/guard.js';
import { createIctrpAdapter, ICTRP_CAPABILITY } from '../../../src/adapters/ictrp/adapter.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../../src/core/query.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');
const results = readFileSync(join(__dirname, '../../fixtures/ictrp/results-page1.html'), 'utf8');

const cfg = () => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ictrp-adapter-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
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
      `<td><a href="Trial2.aspx?TrialID=TEST${i}">합성 시험 ${i}</a></td><td>2026-01-01</td></tr>`,
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
describe('ICTRP 어댑터 — location 축은 죽어 있다', () => {
  it('location 을 쓰면 assertSupported 가 exit 3 으로 거부한다', () => {
    expect(() =>
      assertSupported(ICTRP_CAPABILITY, { location: 'Korea' } as NormalizedQuery, fetchOpts),
    ).toThrowError(/location/);
  });

  it('location 은 supported:false 이고 자유 텍스트 축의 모양(values: null)을 유지한다', () => {
    expect(ICTRP_CAPABILITY.search.location.supported).toBe(false);
    expect(ICTRP_CAPABILITY.search.location.values).toBeNull();
  });
});
