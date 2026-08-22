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
const { DEFAULT_REGISTRY } = await import('../../src/core/registry.js');

describe('--registry 기본값', () => {
  it('레지스트리가 둘 등록돼도 기본값은 ctgov 하나다', () => {
    expect(parseCliArgs(['search', '--condition', 'x']).registries).toEqual(['ctgov']);
    expect(parseCliArgs(['count']).registries).toEqual([DEFAULT_REGISTRY]);
  });

  it('명시하면 그 키만 쓴다 — 기본값이 끼어들지 않는다', () => {
    expect(parseCliArgs(['search', '--registry', 'probe']).registries).toEqual(['probe']);
    expect(parseCliArgs(['search', '--registry', 'probe', '--registry', 'ctgov']).registries)
      .toEqual(['probe', 'ctgov']);
  });
});
