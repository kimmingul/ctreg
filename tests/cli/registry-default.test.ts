import { describe, expect, it, vi } from 'vitest';

/**
 * `--registry` 의 기본값이 "등록된 모든 키" 가 아니라 이름 붙은 하나(ctgov)여야 한다는
 * 계약(스펙 §4.1: `--registry <key>...  기본 ctgov`)을 지킨다.
 *
 * 어댑터가 하나뿐인 오늘은 두 구현이 같은 값을 낸다 — 그래서 이 테스트는 두 번째
 * 레지스트리가 등록된 상황을 흉내 낸다. 그것이 이 결함이 실제로 터지는 유일한
 * 조건이기 때문이다: 기본값이 REGISTRY_KEYS 를 따라가면, 어댑터를 하나 더 붙이는
 * 순간 `--registry` 를 한 번도 쓴 적 없는 기존 호출자 전원의 기본 동작이 조용히
 * 2-레지스트리 팬아웃으로 바뀐다 (업스트림 요청 2배, 데이터 품질이 다른 레코드가
 * 섞임, count 는 중복 합계). 어댑터 아래가 아니라 위에서 동작이 바뀌는 것이므로
 * "레지스트리 #2 는 어댑터 디렉터리 하나 + 등록 두 줄" 이라는 이 슬라이스의 전제
 * 자체가 깨진다.
 */
vi.mock('../../src/core/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/registry.js')>();
  const KEYS = ['ctgov', 'probe'] as const;
  return {
    ...actual,
    REGISTRY_KEYS: KEYS,
    isRegistryKey: (v: string) => (KEYS as readonly string[]).includes(v),
  };
});

const { parseCliArgs } = await import('../../src/cli/args.js');
const { DEFAULT_REGISTRY, REGISTRY_KEYS } = await import('../../src/core/registry.js');

describe('--registry 기본값', () => {
  it('레지스트리가 둘 등록돼도 기본값은 ctgov 하나다', () => {
    expect(parseCliArgs(['search', '--condition', 'x']).registries).toEqual(['ctgov']);
    expect(parseCliArgs(['count']).registries).toEqual([DEFAULT_REGISTRY]);
  });

  /**
   * C2 의 거울상. 팬아웃이 틀린 자리에서 기본 팬아웃을 막았더니, 팬아웃이 존재
   * 이유인 자리에서도 막혔다 — `registries` 는 capability 덤프이고 §4.5 는
   * `--registry <key>` 를 *좁히는* 옵션으로 규정한다. 스킬은 요청을 조립하기 전에
   * 이 커맨드를 부르라고 안내받으므로, 여기서 좁히면 스킬이 두 번째 레지스트리의
   * 존재를 영영 알 수 없다 (README 도 "두 번째 레지스트리가 붙어도 이 커맨드로
   * 능력 차이를 알 수 있게 설계했다" 고 적고 있다).
   *
   * 위 테스트와 같은 이유로 두 키가 등록된 상황에서 검사한다 — 어댑터가 하나인
   * 동안에는 두 동작이 구별되지 않는다.
   */
  it('registries 는 좁히지 않는다 — 등록된 키 전부를 덤프한다', () => {
    expect(parseCliArgs(['registries']).registries).toEqual([...REGISTRY_KEYS]);
    expect(parseCliArgs(['registries']).registries).toEqual(['ctgov', 'probe']);
  });

  it('registries 도 --registry 로는 좁혀진다 — 좁히는 것이 옵션이다', () => {
    expect(parseCliArgs(['registries', '--registry', 'probe']).registries).toEqual(['probe']);
  });

  it('조회 커맨드는 registries 의 예외에 휩쓸리지 않는다', () => {
    for (const cmd of [['search', '--condition', 'x'], ['count'], ['get', 'NCT00000001'], ['results', 'NCT00000001']]) {
      expect(parseCliArgs(cmd).registries).toEqual([DEFAULT_REGISTRY]);
    }
  });

  it('명시하면 그 키만 쓴다 — 기본값이 끼어들지 않는다', () => {
    expect(parseCliArgs(['search', '--registry', 'probe']).registries).toEqual(['probe']);
    expect(parseCliArgs(['search', '--registry', 'probe', '--registry', 'ctgov']).registries)
      .toEqual(['probe', 'ctgov']);
  });
});
