import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIctrpAdapter } from '../../../src/adapters/ictrp/adapter.js';
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

/** GET 이면 폼을, POST 면 결과를 낸다 — client.test.ts 의 스텁과 같은 모양이다. */
function stub() {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    return new Response(method === 'GET' ? form : results, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return fetchImpl;
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
});
