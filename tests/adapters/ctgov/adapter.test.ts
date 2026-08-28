import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY, createCtgovAdapter } from '../../../src/adapters/ctgov/adapter.js';
import { CapabilitySchema } from '../../../src/core/capability.js';
import { CAPS, type FetchOpts, type ResultsOpts } from '../../../src/core/query.js';
import type { Config } from '../../../src/runtime/config.js';
import { bucketPath } from '../../../src/runtime/throttle.js';

const page = JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov/search-page.json'), 'utf8'));
// results.test.ts 와 같은 시험(NCT04280705)을 쓴다 — resultsSection 이 있는 픽스처는
// 이거 하나뿐이고, 같은 시험을 여러 테스트가 서로 다른 전제로 쓰는 드리프트를 피한다.
const fullStudy = JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov/study-full.json'), 'utf8'));

let cfg: Config;
beforeEach(() => {
  cfg = {
    cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-adapter-')),
    cacheTtlSec: 3600,
    timeoutMs: 5000,
    maxRetries: 3,
    ratePerSec: 1000,
    ctgovBaseUrl: 'https://example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
        ictrpBaseUrl: 'https://ictrp.example.test',
        crisBaseUrl: 'https://cris.example.test',
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
    // count 의 존재 이유는 "값싼 요청 한 번" 이다 — fields 를 실어 보내면 그 전제가
    // 깨진다. 오늘은 구현상 당연히 참이지만, 나중에 fields 를 다시 채우는 수정이
    // 들어와도 다른 어떤 검증도 이를 잡지 못하므로 여기서 직접 막는다.
    expect(seen[0]).not.toContain('fields=');
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

  /**
   * C1 회귀. `--raw` 의 source 는 정규화기의 작업용 투영이 아니라 업스트림이 실제로
   * 준 문서여야 한다. fields 를 걸면 source 는 CORE_FIELDS 가 요청한 leaf 만 담게
   * 되어, 스키마가 담지 못한 것을 보러 온 호출자에게 정확히 스키마가 담은 것만
   * 돌려준다. 여기서는 투영이 절대 요청하지 않는 모듈(descriptionModule 등)이
   * source 에 실제로 실려 오는지로 확인한다 — fields 를 다시 채우면 이 테스트가 깨진다.
   */
  it('--raw 는 투영이 제외하는 모듈까지 담은 원문을 source 로 낸다', async () => {
    const seen: string[] = [];
    const upstream = {
      studies: [
        {
          ...page.studies[0],
          protocolSection: {
            ...page.studies[0].protocolSection,
            // 투영(CORE_FIELDS/SECTION_FIELDS)이 어느 --include 조합으로도 요청하지 않는 모듈.
            descriptionModule: { briefSummary: 'only present when fields is omitted' },
          },
          derivedSection: { miscInfoModule: { versionHolder: '2026-08-22' } },
        },
      ],
    };
    const f = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(upstream), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const a = createCtgovAdapter(cfg, deps(f as unknown as ReturnType<typeof respond>));
    const r = await a.search({ condition: 'NSCLC' }, { ...opts, raw: true });

    expect(seen[0]).not.toContain('fields=');
    const source = r.data[0]!.source as Record<string, any>;
    expect(source.protocolSection.descriptionModule.briefSummary).toBe('only present when fields is omitted');
    expect(source.derivedSection).toBeDefined();
  });

  it('--raw 없이는 fields 투영을 유지한다 — 기본 경로의 페이로드는 그대로다', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const a = createCtgovAdapter(cfg, deps(f as unknown as ReturnType<typeof respond>));
    const r = await a.search({ condition: 'NSCLC' }, opts);
    expect(seen[0]).toContain('fields=');
    expect(r.data[0]!.source).toBeUndefined();
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

  const resultsOpts = (over: Partial<ResultsOpts> = {}): ResultsOpts => ({
    sections: ['outcomes', 'adverse', 'flow', 'baseline'],
    full: false,
    cacheMode: 'off',
    ...over,
  });

  // 리뷰에서 지적: adapter.test.ts 에 results() 를 부르는 테스트가 하나도 없었다.
  // client.study → extractResults 배선이 코드만 읽어서는 "맞는 것 같다" 였을 뿐,
  // 어느 테스트도 고정하지 않았다. 이 테스트는 두 가지를 동시에 확인한다:
  //   1) client 가 낸 경고(락 타임아웃)와 extractResults 가 낸 경고(요약)가
  //      *둘 다* AdapterResult.warnings 에 합쳐져 나온다 — 리뷰가 열어둔 질문이기도
  //      하다: HTTP 계층의 throttle_lock_timeout 경고가 실제로 어댑터 출력까지
  //      전달되는지는 search 의 쿼리 조립 경고와 "구조적으로 같다" 는 추론으로만
  //      뒷받침돼 있었다. 여기서 직접 확인한다.
  //   2) 추출된 결과 자체가 제대로 온다 (hasResults, id, outcomes.total).
  it(
    'results 는 client 경고와 추출 경고를 모두 담아 결과를 낸다',
    async () => {
      const path = bucketPath(cfg.cacheDir, 'ctgov');
      writeFileSync(path, JSON.stringify({ nextAvailableAt: 0 }));
      // http.test.ts 와 같은 기법: 실제 proper-lockfile 락을 쥔 채로 유지해
      // reserveSlot 이 끝내 락을 못 잡게 만들고, throttle_lock_timeout 경고를 강제한다.
      const release = await lockfile.lock(path, { realpath: false });
      try {
        const f = respond(fullStudy);
        const a = createCtgovAdapter(cfg, deps(f));
        const r = await a.results('NCT04280705', resultsOpts());

        expect(r.data.id).toBe('CTGOV:NCT04280705');
        expect(r.data.hasResults).toBe(true);
        expect(r.data.sections.outcomes!.total).toBeGreaterThan(0);

        const codes = r.warnings.map((w) => w.code);
        expect(codes).toContain('throttle_lock_timeout'); // client (getJson) 발
        expect(codes).toContain('results_summarized'); // extractResults 발
      } finally {
        await release();
      }
    },
    15_000, // reserveSlot 의 락 재시도 상한(500ms) x 10회 재시도라 실시간으로 몇 초 걸린다.
  );

  /**
   * I1(`count.ts` → `applyLimits`)·I2(`args.ts` → `locationTerm`)와 같은 형태의 세 번째
   * 인스턴스(R1). `createCtgovAdapter` 는 `makeClient(cfg, CTGOV_CAPABILITY.limits.ratePerSec,
   * deps)` 를 부른다고 주석이 말하지만, 그 배선을 검사하는 테스트가 없었다 — 이 줄을
   * `makeClient(cfg, 1, deps)` 로 하드코딩해도 스위트가 조용했다. `cfg.ratePerSec`(전역
   * 오버라이드, http.ts 참고)가 있으면 그게 이겨서 선언값이 실제로 쓰이는지 가려지므로
   * 이 테스트만 그것을 끈다. 기대 간격은 숫자를 적지 않고 `CTGOV_CAPABILITY.limits.ratePerSec`
   * 에서 유도한다 — 그래야 선언이 바뀌어도 이 테스트가 같이 따라가고, 배선이 끊긴
   * 순간(하드코딩)만 잡는다.
   */
  it('선언한 ratePerSec 의 간격만큼 연속 요청 사이에 실제로 대기한다', async () => {
    cfg.ratePerSec = undefined; // 전역 오버라이드를 끄고 어댑터가 넘긴 선언값이 쓰이는지 본다
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    const now = () => 1_000_000; // 고정 시각 — 매 호출마다 예약된 슬롯만큼 그대로 대기해야 한다
    const f = respond({ ...page, totalCount: 1 });
    const a = createCtgovAdapter(cfg, { fetchImpl: f as unknown as typeof fetch, sleep, now });

    await a.search({ condition: 'x' }, opts);
    await a.search({ condition: 'x' }, opts);

    const expectedIntervalMs = Math.ceil(1000 / CTGOV_CAPABILITY.limits.ratePerSec);
    expect(waits).toContain(expectedIntervalMs);
  });
});
