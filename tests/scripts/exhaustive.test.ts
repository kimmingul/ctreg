/**
 * 필드테스트 스크립트가 `exhaustive` 선언을 실측과 대조하는 규칙.
 *
 * 이 판정이 스크립트 안에 인라인으로 있으면 테스트할 수 없고, 테스트할 수 없으면
 * 두 스크립트가 서로 다른 규칙으로 갈라져도 아무도 모른다. 실제로 그렇게 갈렸었다 —
 * 한쪽은 총계를 하한으로 알고 다른 쪽은 레지스트리 전체로 단정했다.
 */
import { describe, expect, it } from 'vitest';
import { compareDeclared, judgeExhaustive } from '../../scripts/exhaustive.js';

describe('judgeExhaustive — 실측 판정', () => {
  it('합이 총계보다 작으면 덮지 못한다 — 총계가 하한이고 값이 겹쳐도 이 방향은 안전하다', () => {
    // 합은 중복을 포함하므로 실제로 덮인 레코드 수보다 크거나 같고, 총계는 하한이므로
    // 진짜 총계보다 작거나 같다. 그런데도 합 < 총계면 어디에도 안 걸리는 레코드가 있다.
    expect(judgeExhaustive({ sum: 10, total: 20, totalIsFloor: true, overlapping: true })).toBe(false);
  });

  it('분할 축이고 총계가 정확하면 합이 총계 이상일 때 덮는다', () => {
    expect(judgeExhaustive({ sum: 20, total: 20, totalIsFloor: false, overlapping: false })).toBe(true);
  });

  it('겹치는 축은 합이 총계 이상이어도 결론을 못 낸다 — 합은 분할이 아니다', () => {
    expect(judgeExhaustive({ sum: 25, total: 20, totalIsFloor: false, overlapping: true })).toBeNull();
  });

  it('총계가 하한이면 합이 총계 이상이어도 결론을 못 낸다 — 진짜 총계가 더 클 수 있다', () => {
    expect(judgeExhaustive({ sum: 25, total: 20, totalIsFloor: true, overlapping: false })).toBeNull();
  });
});

describe('compareDeclared — 선언과 실측의 대조', () => {
  it('실측 false 를 false 로 신고했으면 통과', () => {
    expect(compareDeclared(false, false).verdict).toBe('pass');
  });

  it('실측 true 를 true 로 신고했으면 통과', () => {
    expect(compareDeclared(true, true).verdict).toBe('pass');
  });

  it('실측이 false 인데 true 로 신고하면 실패 — 낙관적 true 를 여기서 잡는다', () => {
    expect(compareDeclared(true, false).verdict).toBe('fail');
  });

  it('실측이 true 인데 false 로 신고해도 실패 — 안전한 방향이어도 어긋난 것은 어긋난 것이다', () => {
    expect(compareDeclared(false, true).verdict).toBe('fail');
  });

  it('판정 불가인데 true 로 신고하면 실패 — 증명되지 않은 true 는 신고할 수 없다', () => {
    expect(compareDeclared(true, null).verdict).toBe('fail');
  });

  it('판정 불가이고 false 로 신고했으면 불확정 — 좁게 신고하는 쪽은 실패가 아니다', () => {
    expect(compareDeclared(false, null).verdict).toBe('inconclusive');
  });

  it('실측이 났는데 null 로 신고하면 실패 — 닫힌 어휘 축에 null 은 신고 누락이다', () => {
    expect(compareDeclared(null, false).verdict).toBe('fail');
  });

  it('판정 불가이고 null 로 신고했으면 불확정 — 실측이 아무것도 부정하지 못한다', () => {
    expect(compareDeclared(null, null).verdict).toBe('inconclusive');
  });

  it('모든 판정에 사람이 읽을 근거가 붙는다', () => {
    for (const declared of [true, false, null]) {
      for (const measured of [true, false, null]) {
        expect(compareDeclared(declared, measured).note.length).toBeGreaterThan(0);
      }
    }
  });
});
