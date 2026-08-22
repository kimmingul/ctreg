import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY, createCtgovAdapter } from '../../../src/adapters/ctgov/adapter.js';
import { CapabilitySchema } from '../../../src/core/capability.js';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';
import type { Config } from '../../../src/runtime/config.js';

const page = JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov/search-page.json'), 'utf8'));

let cfg: Config;
beforeEach(() => {
  cfg = {
    cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-adapter-')),
    cacheTtlSec: 3600,
    timeoutMs: 5000,
    maxRetries: 3,
    ratePerSec: 1000,
    ctgovBaseUrl: 'https://example.test/api/v2',
  };
});

const opts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off',
  raw: false,
};

const respond = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

const deps = (f: ReturnType<typeof respond>) => ({ fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

describe('CT.gov 어댑터', () => {
  it('capability 선언이 계약 스키마를 통과한다', () => {
    expect(() => CapabilitySchema.parse(CTGOV_CAPABILITY)).not.toThrow();
    expect(CTGOV_CAPABILITY.search.geoNeedsCoords).toBe(true);
  });

  it('search 는 레코드·총계·다음 커서를 낸다', async () => {
    const f = respond({ ...page, totalCount: 412, nextPageToken: 'tok-1' });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.search({ condition: 'NSCLC' }, opts);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.total).toBe(412);
    expect(r.nextPageToken).toBe('tok-1');
    expect(r.data[0]!.registry).toBe('ctgov');
  });

  it('search 는 쿼리 조립 경고를 그대로 올려보낸다', async () => {
    const f = respond({ studies: [], totalCount: 0 });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.search({ updatedSince: '2025-01-01' }, opts);
    expect(r.warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('count 는 페이로드를 받지 않는다 — pageSize 0', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ totalCount: 99 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const a = createCtgovAdapter(cfg, deps(f as unknown as ReturnType<typeof respond>));
    const r = await a.count({ condition: 'NSCLC' }, opts);
    expect(r.data).toBe(99);
    expect(seen[0]).toContain('pageSize=0');
    expect(seen[0]).toContain('countTotal=true');
  });

  it('get 은 배치 상한을 넘으면 여러 호출로 쪼갠다', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `NCT${String(i).padStart(8, '0')}`);
    const f = vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const a = createCtgovAdapter(cfg, deps(f as unknown as ReturnType<typeof respond>));
    await a.get(ids, opts);
    expect(f).toHaveBeenCalledTimes(2); // maxBatchIds 50
  });

  it('찾지 못한 ID 는 전체를 실패시키지 않고 경고가 된다', async () => {
    const f = respond({ studies: [] });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.get(['NCT00000001'], opts);
    expect(r.data).toHaveLength(0);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
    expect(r.warnings[0]!.id).toBe('CTGOV:NCT00000001');
  });

  it('다른 레지스트리의 ID 를 주면 거부한다', async () => {
    const a = createCtgovAdapter(cfg, deps(respond({ studies: [] })));
    await expect(a.get(['ISRCTN:12345678'], opts)).rejects.toMatchObject({ code: 'unsupported' });
  });

  // 브리프에는 없는 케이스: mapStudy 가 nctId 없는 study 를 만나면 예외를 던지도록
  // 고쳐졌다(리뷰 발견). 어댑터는 study 단위로 이를 잡아 경고로 격하해야 한다 —
  // 페이지 하나에 든 오염된 레코드 하나가 페이지 전체를 죽이면 안 된다.
  it('한 study 의 매핑이 실패해도 나머지 study 는 살아남고 실패는 경고가 된다', async () => {
    const good = page.studies[0];
    const malformed = { protocolSection: { identificationModule: {} } }; // nctId 없음 → mapStudy 가 throw
    const f = respond({ studies: [good, malformed], totalCount: 2 });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.search({ condition: 'NSCLC' }, opts);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.registryId).toBe('NCT03831932');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.message.length > 0)).toBe(true);
  });

  it('get 에서도 매핑 실패한 study 하나가 나머지 결과를 막지 않는다', async () => {
    const good = page.studies[0];
    const malformed = { protocolSection: { identificationModule: {} } };
    const f = respond({ studies: [good, malformed] });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.get(['NCT03831932'], opts);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.registryId).toBe('NCT03831932');
  });
});
