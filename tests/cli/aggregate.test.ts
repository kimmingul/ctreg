import { describe, expect, it, vi } from 'vitest';
import { CRIS_CAPABILITY } from '../../src/adapters/cris/adapter.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { AXES, runAggregate, type AggregateResult } from '../../src/cli/commands/aggregate.js';
import type { RegistryAdapter } from '../../src/core/capability.js';
import type { RegistryKey } from '../../src/core/registry.js';

/**
 * `aggregate` — 검색어에 걸린 시험 **전체**를 한 축으로 묶어 건수순으로. 축은 연구자·의뢰사·실시기관·
 * 연도·중재종류·의약품·질환. **순위·현황 질문은 도구가 세야 한다** — 에이전트가 목록 40건에서 후보를
 * 뽑아 하나씩 센 실측(2026-09-12)이 이 커맨드의 이유다. 처음엔 `investigators` 하나였고, 사용자가
 * "연구자별·의뢰사별·실시기관별·질환별·의약품별" 을 말해 축을 인자로 일반화했다.
 *
 * 할 수 있는 문이 CRIS 사본뿐이다(공식 API 문은 목록에 그 축이 없다) — 다른 문은 exit 3.
 */
function adapters(agg?: RegistryAdapter['aggregate']): Partial<Record<RegistryKey, RegistryAdapter>> {
  const cap = agg ? { ...CRIS_CAPABILITY, aggregate: { supported: true, scope: '사본', axes: [...AXES] } } : CRIS_CAPABILITY;
  return {
    cris: {
      key: 'cris', capability: () => cap,
      search: vi.fn(), get: vi.fn(), results: vi.fn(), count: vi.fn(),
      ...(agg ? { aggregate: agg } : {}),
    } as unknown as RegistryAdapter,
  };
}
const sample = {
  by: 'sponsor' as const, matched: 276, mapped: 0.74,
  provenance: '의뢰기관 항목표를 KCTIS 의뢰사 마스터로 묶음',
  items: [
    { key: 'S1', name: '아산사회복지재단 서울아산병원', nameEn: 'Asan Medical Center', trials: 16, mapped: true, extra: { sponsor_type: 'Academic' } },
    { key: 'S2', name: '고려대학교의과대학부속안산병원', trials: 15, mapped: true },
  ],
};

describe('aggregate 커맨드', () => {
  it('--by 축과 --term(쉼표 OR)을 어댑터에 넘기고 순위·모수·근거를 낸다', async () => {
    const agg = vi.fn(async () => ({ data: sample, warnings: [{ code: 'cris_mirror_copy', message: '사본', registry: 'cris' as const }] }));
    const env = await runAggregate(parseCliArgs(['aggregate', '--by', 'sponsor', '--term', '당뇨, diabetes', '--page-size', '5']), adapters(agg));
    expect(agg).toHaveBeenCalledWith(expect.objectContaining({ by: 'sponsor', terms: ['당뇨', 'diabetes'], limit: 5 }), expect.anything());
    expect(env.registries).toEqual([{ registry: 'cris', status: 'ok', total: 276 }]);
    const d = env.data as AggregateResult;
    expect(d.by).toBe('sponsor');
    expect(d.items.map((x) => [x.name, x.trials])).toEqual([['아산사회복지재단 서울아산병원', 16], ['고려대학교의과대학부속안산병원', 15]]);
    expect(d.provenance).toMatch(/마스터/);
    expect(d.basis).toMatch(/등록 건수/);
    expect(env.warnings.map((w) => w.code)).toContain('cris_mirror_copy');
  });

  it('--status 도 넘긴다', async () => {
    const agg = vi.fn(async () => ({ data: { ...sample, items: [] }, warnings: [] }));
    await runAggregate(parseCliArgs(['aggregate', '--by', 'year', '--term', 'x', '--status', 'recruiting']), adapters(agg));
    expect(agg).toHaveBeenCalledWith(expect.objectContaining({ by: 'year', status: ['recruiting'] }), expect.anything());
  });

  it('어댑터가 이 축을 못 하면 exit 3 — 0건이 아니라 "그렇게 물어볼 수 없음"', async () => {
    const env = await runAggregate(parseCliArgs(['aggregate', '--by', 'sponsor', '--term', '당뇨']), adapters(undefined));
    expect(env.registries[0]).toMatchObject({ registry: 'cris', status: 'unsupported' });
    expect(env.data).toBeNull();
  });

  it('능력 신고가 false 면 메서드가 있어도 부르지 않는다 — 신고가 계약이다', async () => {
    const agg = vi.fn(async () => ({ data: sample, warnings: [] }));
    const a = adapters(agg);
    (a.cris as { capability: () => unknown }).capability = () => ({ ...CRIS_CAPABILITY, aggregate: { supported: false, scope: '이 문은 못 한다' } });
    const env = await runAggregate(parseCliArgs(['aggregate', '--by', 'sponsor', '--term', '당뇨']), a);
    expect(agg).not.toHaveBeenCalled();
    expect(env.registries[0]!.error?.hint).toContain('이 문은 못 한다');
  });

  it('--by 가 없거나 모르는 축이면, --term 이 없으면 사용법 오류다', () => {
    expect(() => parseCliArgs(['aggregate', '--term', 'x'])).toThrow(/--by/);
    expect(() => parseCliArgs(['aggregate', '--by', 'planet', '--term', 'x'])).toThrow(/planet/);
    expect(() => parseCliArgs(['aggregate', '--by', 'sponsor'])).toThrow(/--term/);
  });

  it('레지스트리는 cris 로 고정이다', () => {
    expect(parseCliArgs(['aggregate', '--by', 'year', '--term', 'x']).registries).toEqual(['cris']);
  });

  it('축 목록이 하나의 정본이다 — 파서·도구 설명·능력 신고가 같은 것을 본다', () => {
    expect(AXES).toEqual(['investigator', 'sponsor', 'site', 'year', 'intervention_type', 'drug', 'condition']);
  });
});

/**
 * 집계 API 가 없는 레지스트리 — **검색을 끝까지 받아 서버가 센다.** ctgov 는 쪽당 200건, 상한 1,000건.
 * 모수가 상한을 넘으면 그만큼만 세고 잘렸다고 말한다. 조용히 앞 200건으로 답하지 않는다.
 */
describe('aggregate — 집계 API 가 없는 레지스트리는 검색을 걸어 센다', () => {
  function ctgov(total: number): { adapter: RegistryAdapter; calls: unknown[] } {
    const calls: unknown[] = [];
    const page = (n: number, size: number) => Array.from({ length: Math.min(size, total - (n - 1) * size) }, (_, i) => ({
      id: `CTGOV:NCT${String((n - 1) * size + i).padStart(8, '0')}`, registry: 'ctgov', registryId: 'x', url: '', title: 't', status: 'completed', phase: [], studyType: 'interventional',
      conditions: [(n - 1) * size + i < total / 2 ? 'Diabetes' : 'Obesity'], sponsor: { lead: i % 2 ? 'Pfizer' : 'Novo' }, fetchedAt: 'x',
    }));
    const adapter = {
      key: 'ctgov', capability: () => ({ ...CRIS_CAPABILITY, key: 'ctgov', limits: { maxPageSize: 200, ratePerSec: 1, maxBatchIds: 50 } }),
      search: vi.fn(async (q: { pageToken?: string; pageSize?: number }) => {
        calls.push(q);
        const n = q.pageToken ? Number(q.pageToken) : 1; const size = q.pageSize ?? 20;
        const data = page(n, size);
        return { data, warnings: [], total, ...(n * size < total ? { nextPageToken: String(n + 1) } : {}) };
      }),
      get: vi.fn(), results: vi.fn(), count: vi.fn(),
    } as unknown as RegistryAdapter;
    return { adapter, calls };
  }

  it('쪽을 끝까지 걸어 전체를 센다 — 모수 350 이면 두 쪽', async () => {
    const { adapter, calls } = ctgov(350);
    const env = await runAggregate(parseCliArgs(['aggregate', '--by', 'condition', '--term', 'diabetes', '--registry', 'ctgov']), { ctgov: adapter });
    expect(calls).toHaveLength(2);
    expect((calls[0] as { pageSize: number }).pageSize).toBe(200);
    const d = env.data as AggregateResult;
    expect(d.matched).toBe(350);
    expect(d.items.map((x) => [x.name, x.trials])).toEqual([['Diabetes', 175], ['Obesity', 175]]);
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'ok', total: 350 });
    expect(env.warnings.some((w) => w.code === 'aggregate_truncated')).toBe(false);
  });

  it('상한(1,000)을 넘으면 그만큼만 세고 잘렸다고 말한다', async () => {
    const { adapter, calls } = ctgov(2500);
    const env = await runAggregate(parseCliArgs(['aggregate', '--by', 'sponsor', '--term', 'diabetes', '--registry', 'ctgov']), { ctgov: adapter });
    expect(calls).toHaveLength(5);
    const d = env.data as AggregateResult;
    expect(d.matched).toBe(2500);
    expect(d.items.reduce((a, x) => a + x.trials, 0)).toBe(1000);
    const w = env.warnings.find((x) => x.code === 'aggregate_truncated');
    expect(w?.message).toMatch(/1,?000/);
    expect(w?.message).toMatch(/2,?500/);
  });

  it('검색 축이 없는 레지스트리(예: ctis 의 investigator)는 exit 3', async () => {
    const { adapter } = ctgov(10);
    (adapter as { capability: () => unknown }).capability = () => ({ ...CRIS_CAPABILITY, key: 'ctis', search: { ...CRIS_CAPABILITY.search, term: { supported: false, values: null, exhaustive: null, scope: 'x' } } });
    const env = await runAggregate(parseCliArgs(['aggregate', '--by', 'sponsor', '--term', 'x', '--registry', 'ctis']), { ctis: adapter });
    expect(env.registries[0]).toMatchObject({ registry: 'ctis', status: 'unsupported' });
  });
});
