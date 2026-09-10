import { describe, expect, it, vi } from 'vitest';
import { CRIS_CAPABILITY } from '../../src/adapters/cris/adapter.js';
import { CRIS_PI_ROLE } from '../../src/adapters/cris/map.js';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { runNames, type NamesResult } from '../../src/cli/commands/names.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { exitFor } from '../../src/cli/output.js';
import type { RegistryAdapter } from '../../src/core/capability.js';
import type { TrialRecord } from '../../src/core/record.js';
import type { RegistryKey } from '../../src/core/registry.js';

const AT = '2026-09-10T00:00:00.000Z';

/** CRIS 상세가 내는 모양 그대로 — 국문·영문 연락처가 나란히, 역할은 연구책임자. */
const crisTrial = (id: string, names: string[]): TrialRecord => ({
  id: `CRIS:${id}`, registry: 'cris', registryId: id,
  url: `https://trialsearch.who.int/Trial2.aspx?TrialID=${id}`,
  title: `시험 ${id}`, status: 'completed', studyType: 'interventional', conditions: [],
  contacts: names.map((name) => ({ name, role: CRIS_PI_ROLE })),
  fetchedAt: AT,
});

function adapters(crisData: TrialRecord[], ctgovCounts: Record<string, number> = {}): Partial<Record<RegistryKey, RegistryAdapter>> {
  return {
    cris: {
      key: 'cris', capability: () => CRIS_CAPABILITY,
      search: vi.fn(async () => ({ data: crisData, warnings: [], total: crisData.length })),
      get: vi.fn(), results: vi.fn(),
      count: vi.fn(async () => ({ data: crisData.length, warnings: [] })),
    } as unknown as RegistryAdapter,
    ctgov: {
      key: 'ctgov', capability: () => CTGOV_CAPABILITY,
      search: vi.fn(), get: vi.fn(), results: vi.fn(),
      // 표기별 건수 — 실측한 모양을 흉내낸다: 'Min-Gul Kim' 45, 'Mingul Kim' 17.
      count: vi.fn(async (q: { investigator?: string }) => ({ data: ctgovCounts[q.investigator ?? ''] ?? 0, warnings: [] })),
    } as unknown as RegistryAdapter,
  };
}

/**
 * `names` — 한국어 이름을 **실제로 등록된** 로마자 표기로. CRIS 는 국문·영문을 나란히
 * 싣는 이중언어 레지스트리라 대조표가 된다. 새 API 를 부르는 것이 아니라 `search
 * --investigator` 가 이미 내는 연락처에서 영문을 뽑아 세는 것이다 — 코어를 새로 쓰지 않는다.
 *
 * 왜 도구가 따로 필요한가. 로마자 표기가 결과를 가른다(실측: `Min-Gul Kim` 45건 대
 * `Mingul Kim` 17건, ctgov). 모델이 이 절차를 세 번 부르며 조립하던 것을 한 번으로 만든다.
 */
describe('names 커맨드', () => {
  it('영문 표기를 빈도와 함께 낸다 — 많이 쓴 표기가 먼저', async () => {
    const data = [
      crisTrial('KCT1', ['김민걸', 'Min-Gul Kim']),
      crisTrial('KCT2', ['김민걸', 'Min-Gul Kim']),
      crisTrial('KCT3', ['김민걸', 'Min Gul Kim']),
    ];
    const env = await runNames(parseCliArgs(['names', '김민걸', '--term', '전북대']), adapters(data));
    const r = env.data as NamesResult;
    expect(r.korean).toBe('김민걸');
    expect(r.variants.map((v) => v.name)).toEqual(['Min-Gul Kim', 'Min Gul Kim']);
    expect(r.variants[0]!.crisTrials).toBe(2);
    expect(r.variants[1]!.crisTrials).toBe(1);
  });

  /**
   * **같은 표기의 대소문자·공백 차이는 합치지 않는다.** `Min Gul KIm`(오타)은 실측에서
   * 실제로 나왔다. 합쳐 버리면 사용자는 그 오타가 등록돼 있다는 것을 모르고, ctgov 에
   * 그 오타로 물어야 걸리는 시험을 놓친다. 이 도구의 존재 이유가 "표기가 다르면 다른
   * 사람" 이므로 원문을 그대로 보존한다.
   */
  it('오타도 별개 표기로 보존한다 — 합치면 그 표기로만 걸리는 시험을 놓친다', async () => {
    const data = [crisTrial('KCT1', ['김민걸', 'Min Gul Kim']), crisTrial('KCT2', ['김민걸', 'Min Gul KIm'])];
    const r = (await runNames(parseCliArgs(['names', '김민걸', '--term', 'x']), adapters(data))).data as NamesResult;
    expect(r.variants.map((v) => v.name).sort()).toEqual(['Min Gul KIm', 'Min Gul Kim']);
  });

  it('한국어 이름 자신은 표기 목록에 넣지 않는다', async () => {
    const data = [crisTrial('KCT1', ['김민걸', 'Min-Gul Kim', '김민걸'])];
    const r = (await runNames(parseCliArgs(['names', '김민걸', '--term', 'x']), adapters(data))).data as NamesResult;
    expect(r.variants.map((v) => v.name)).toEqual(['Min-Gul Kim']);
  });

  /**
   * **--ctgov 를 주면 표기마다 ctgov 건수를 함께 낸다.** 이것이 이 도구가 답하려는 물음
   * 그 자체다 — "어느 표기로 물어야 하나". 요청이 표기 수만큼 늘어서 기본은 끈다.
   */
  it('--ctgov 를 주면 표기별 ctgov 건수를 함께 낸다', async () => {
    const data = [crisTrial('KCT1', ['김민걸', 'Min-Gul Kim']), crisTrial('KCT2', ['김민걸', 'Mingul Kim'])];
    const env = await runNames(parseCliArgs(['names', '김민걸', '--term', 'x', '--ctgov']), adapters(data, { 'Min-Gul Kim': 45, 'Mingul Kim': 17 }));
    const r = env.data as NamesResult;
    expect(r.variants.find((v) => v.name === 'Min-Gul Kim')!.ctgovTrials).toBe(45);
    expect(r.variants.find((v) => v.name === 'Mingul Kim')!.ctgovTrials).toBe(17);
  });

  it('--ctgov 가 없으면 ctgov 를 부르지 않는다', async () => {
    const a = adapters([crisTrial('KCT1', ['김민걸', 'Min-Gul Kim'])]);
    await runNames(parseCliArgs(['names', '김민걸', '--term', 'x']), a);
    expect(a.ctgov!.count).not.toHaveBeenCalled();
  });

  /**
   * **0건은 오류가 아니다 — 그러나 "없다" 도 아니다.** CRIS 에서 못 찾은 것은 그 사람이
   * 국내에 등록한 적 없거나, --term 이 그 사람의 시험에 닿지 않은 것이다. 둘 중 무엇인지
   * 도구는 모르고, 그래서 봉투가 그 한계를 말해야 한다.
   */
  it('못 찾으면 빈 목록과 exit 0, 그리고 왜 비었을 수 있는지 경고', async () => {
    const env = await runNames(parseCliArgs(['names', '홍길동', '--term', 'x']), adapters([]));
    expect((env.data as NamesResult).variants).toEqual([]);
    expect(exitFor(env)).toBe(EXIT.OK);
    expect(env.warnings.some((w) => w.code === 'names_none_found')).toBe(true);
  });

  /** CRIS 의 --investigator 는 --term 없이는 성립하지 않는다(후보를 좁힐 축이 없다). */
  it('--term 이 없으면 사용법 오류다', () => {
    expect(() => parseCliArgs(['names', '김민걸'])).toThrow(/--term/);
  });

  it('이름이 없으면 사용법 오류다', () => {
    expect(() => parseCliArgs(['names', '--term', 'x'])).toThrow();
  });
});
