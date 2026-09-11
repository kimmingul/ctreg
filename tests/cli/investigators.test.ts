import { describe, expect, it, vi } from 'vitest';
import { CRIS_CAPABILITY } from '../../src/adapters/cris/adapter.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { runInvestigators, type InvestigatorsResult } from '../../src/cli/commands/investigators.js';
import type { RegistryAdapter } from '../../src/core/capability.js';
import type { RegistryKey } from '../../src/core/registry.js';

/**
 * `investigators` — **순위 질문은 도구가 세야 한다.** 에이전트가 "당뇨 관련 우수한 연구자" 를 목록
 * 40건에서 후보를 뽑아 하나씩 센 실측(2026-09-12): 273건 중 40건만 봄, 간호·영양 중재는 모델이
 * 제외, 국문·영문 겹침 미확인, 17스텝 147초. 여기서는 어댑터(사본)가 전체를 연구책임자로 묶어 한
 * 번에 낸다. 공식 API 문에서는 불가능하다 — 목록에 연구책임자가 없다 — 그래서 exit 3 이다.
 */
/** rank 를 주면 사본 문(집계 지원)으로, 안 주면 공식 API 문(미지원)으로 흉내낸다. */
function adapters(rank?: RegistryAdapter['investigators']): Partial<Record<RegistryKey, RegistryAdapter>> {
  const cap = rank ? { ...CRIS_CAPABILITY, investigators: { supported: true, scope: '사본' } } : CRIS_CAPABILITY;
  return {
    cris: {
      key: 'cris', capability: () => cap,
      search: vi.fn(), get: vi.fn(), results: vi.fn(), count: vi.fn(),
      ...(rank ? { investigators: rank } : {}),
    } as unknown as RegistryAdapter,
  };
}
const sample = {
  matched: 276,
  items: [
    { name: '김난희', nameEn: 'Nan Hee Kim', affiliations: ['고려대학교의과대학부속안산병원'], trials: 10, latest: '2025/11/01', sampleIds: ['CRIS:KCT0011737'] },
    { name: '김재현', nameEn: 'Jae Hyeon Kim', affiliations: ['삼성서울병원', '분당서울대학교병원'], trials: 7, latest: '2025/10/01', sampleIds: ['CRIS:KCT0012402'] },
  ],
};

describe('investigators 커맨드', () => {
  it('--term 은 쉼표로 여럿 — 어댑터에 배열로 넘기고, 순위와 모수를 낸다', async () => {
    const rank = vi.fn(async () => ({ data: sample, warnings: [{ code: 'cris_mirror_copy', message: '사본', registry: 'cris' as const }] }));
    const env = await runInvestigators(parseCliArgs(['investigators', '--term', '당뇨, diabetes', '--page-size', '5']), adapters(rank));
    expect(rank).toHaveBeenCalledWith(expect.objectContaining({ terms: ['당뇨', 'diabetes'], limit: 5 }), expect.anything());
    expect(env.registries).toEqual([{ registry: 'cris', status: 'ok', total: 276 }]);
    const d = env.data as InvestigatorsResult;
    expect(d.items.map((x) => [x.name, x.trials])).toEqual([['김난희', 10], ['김재현', 7]]);
    expect(d.basis).toMatch(/등록 건수/);
    expect(env.warnings.map((w) => w.code)).toContain('cris_mirror_copy');   // 사본 경고를 버리지 않는다
  });

  it('--status 도 넘긴다', async () => {
    const rank = vi.fn(async () => ({ data: { matched: 0, items: [] }, warnings: [] }));
    await runInvestigators(parseCliArgs(['investigators', '--term', 'x', '--status', 'recruiting']), adapters(rank));
    expect(rank).toHaveBeenCalledWith(expect.objectContaining({ status: ['recruiting'] }), expect.anything());
  });

  it('어댑터가 이 축을 못 하면 exit 3 — 0건이 아니라 "그렇게 물어볼 수 없음"', async () => {
    const env = await runInvestigators(parseCliArgs(['investigators', '--term', '당뇨']), adapters(undefined));
    expect(env.registries[0]).toMatchObject({ registry: 'cris', status: 'unsupported' });
    expect(env.registries[0]!.error?.message).toMatch(/연구책임자|집계/);
    expect(env.data).toBeNull();
  });

  it('--term 이 없으면 사용법 오류다 — 전체 순위는 이 커맨드의 일이 아니다', () => {
    expect(() => parseCliArgs(['investigators'])).toThrow(/--term/);
  });

  it('레지스트리는 cris 로 고정이다', () => {
    expect(parseCliArgs(['investigators', '--term', 'x']).registries).toEqual(['cris']);
  });
});
