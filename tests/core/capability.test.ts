import { describe, expect, it } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { ISRCTN_CAPABILITY } from '../../src/adapters/isrctn/adapter.js';
import { type Capability, CapabilitySchema } from '../../src/core/capability.js';

/**
 * 실제 선언을 그대로 검사한다. 손으로 적은 사본을 두면 스키마가 바뀔 때마다 두 곳을
 * 고쳐야 하고, 사본만 최신인 채로 통과하는 초록 스위트가 남는다 — 이 저장소에서
 * 이미 두 번 난 사고다.
 */
const cap: Capability = CTGOV_CAPABILITY;

describe('Capability 계약', () => {
  it('완전한 선언을 받는다', () => {
    expect(CapabilitySchema.parse(cap).key).toBe('ctgov');
  });

  it('search 축을 하나라도 빠뜨리면 거부한다 — 미신고는 곧 미지원 판단 불가', () => {
    const { geo: _drop, ...rest } = cap.search;
    expect(() => CapabilitySchema.parse({ ...cap, search: rest })).toThrow();
  });

  it('등록되지 않은 레지스트리 키는 거부한다', () => {
    expect(() => CapabilitySchema.parse({ ...cap, key: 'ictrp' })).toThrow();
  });
});

describe('축 선언은 내용을 말한다', () => {
  const cap = CTGOV_CAPABILITY;

  it('닫힌 어휘 축은 값 목록을 신고한다', () => {
    expect(cap.search.status.values).toContain('recruiting');
    expect(cap.search.phase.values).toContain('phase_3');
  });

  /**
   * 자유 텍스트 축의 `values` 는 `null` 이고 지원하지 않는 닫힌 어휘 축은 `[]` 다.
   * 둘을 같은 값으로 두면 "아무 값이나 받는다" 와 "아무 값도 못 받는다" 가 같아진다.
   */
  it('자유 텍스트 축은 values 가 null 이다 — 빈 배열과 다르다', () => {
    expect(cap.search.term.values).toBeNull();
    expect(cap.search.condition.values).toBeNull();
  });

  it('모든 축이 비어 있지 않은 scope 를 갖는다', () => {
    for (const [name, axis] of Object.entries(cap.search)) {
      expect(axis.scope.length, `'${name}' 축의 scope 가 비어 있습니다`).toBeGreaterThan(0);
    }
  });

  /** F14: 불리언이 무엇에 대한 참인지 말하지 않아 "결과 유무로 검색 가능" 으로 읽혔다. */
  it('results 는 그것이 서브커맨드 지원이라는 것을 말한다', () => {
    expect(cap.results.supported).toBe(true);
    expect(cap.results.scope).toContain('서브커맨드');
  });

  it('지원하지 않는 닫힌 어휘 축은 values 가 빈 배열이고 exhaustive 는 null 이다', () => {
    expect(ISRCTN_CAPABILITY.search.status.supported).toBe(false);
    expect(ISRCTN_CAPABILITY.search.status.values).toEqual([]);
    expect(ISRCTN_CAPABILITY.search.status.exhaustive).toBeNull();
  });
});
