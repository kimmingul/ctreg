import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { makeClient } from '../../../src/adapters/ictrp/client.js';
import { FIELD } from '../../../src/adapters/ictrp/form.js';

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
function stub() {
  const calls: { method: string; body?: string }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, ...(init?.body ? { body: String(init.body) } : {}) });
    return new Response(method === 'GET' ? form : results, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

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
