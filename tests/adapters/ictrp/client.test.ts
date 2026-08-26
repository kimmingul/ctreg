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
});
