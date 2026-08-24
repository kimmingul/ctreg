/**
 * `exhaustive` 선언을 실측과 대조하는 규칙. 두 필드테스트 스크립트가 공유한다.
 *
 * 설계 문서(§5)는 "스크립트가 선언과 실측이 어긋나면 실패한다. 즉 `exhaustive` 를
 * 낙관적으로 `true` 로 적어 두면 CI 가 잡는다" 고 약속했지만, 두 스크립트는 합을
 * 계산해 표에 찍고 멈췄다 — 선언은 읽지도 않았다. `exhaustive` 는 그동안 **출처
 * 이야기를 걸친 손으로 적은 불리언** 이었다. 여기가 그 약속을 지키는 자리다.
 *
 * 규칙을 스크립트 안에 인라인으로 두지 않는 이유: 테스트할 수 없고, 두 스크립트가
 * 서로 다른 규칙으로 갈라져도 아무도 모른다. 실제로 갈렸었다 — ISRCTN 쪽은 총계가
 * 하한이라는 것을 알면서 `sum >= total` 로 `true` 를 결론지었다.
 */

/** 실측 판정. `true`/`false` 는 확정, `null` 은 **이 측정으로는 결론이 안 난다** 는 뜻이다. */
export type Measured = boolean | null;

export type Judgement = { verdict: 'pass' | 'fail' | 'inconclusive'; note: string };

/**
 * 값별 건수의 합과 전체 총계로 덮개 여부를 판정한다.
 *
 * **편향은 항상 `false` 쪽으로 흐른다.** 덮는다고 잘못 말하면 사용자는 `count` 로 센
 * 값별 분포를 전체로 믿게 되고, 못 덮는다고 잘못 말하면 필요 없는 경고를 하나 더 볼
 * 뿐이다. 두 오류의 값이 다르므로 판정도 대칭이 아니다.
 *
 * - `sum < total` → **확정 `false`.** 총계가 하한이고(진짜 총계는 더 클 수 있다) 합이
 *   중복을 포함해도(덮인 레코드 수는 합보다 작거나 같다) 이 부등호는 방향이 유지된다.
 * - `sum >= total` → 총계가 정확하고 축이 분할일 때만 `true`. 둘 중 하나라도 깨지면
 *   `null` 이다 — "덮는 것처럼 보인다" 는 덮는다는 뜻이 아니다.
 */
export function judgeExhaustive(m: {
  /** 값별 건수의 합. 겹치는 축에서는 중복이 포함된다. */
  sum: number;
  /** 비교 대상 총계. */
  total: number;
  /** 총계가 정확한 수가 아니라 **하한** 인가. 하한이면 낮춰 잡힌 총계가 덮개를 부풀린다. */
  totalIsFloor: boolean;
  /** 한 레코드가 여러 값에 걸릴 수 있는가. 그러면 합은 분할이 아니라 중복 계수다. */
  overlapping: boolean;
}): Measured {
  if (m.sum < m.total) return false;
  if (m.totalIsFloor || m.overlapping) return null;
  return true;
}

/** `judgeExhaustive` 의 결과를 사람이 읽는 한 마디로. */
export function describeMeasured(measured: Measured, m: { totalIsFloor: boolean; overlapping: boolean }): string {
  if (measured === false) return '`false` (합 < 총계)';
  if (measured === true) return '`true` (분할 축 · 정확한 총계)';
  const why = [
    m.overlapping ? '한 시험이 여러 값에 걸려 합이 분할이 아니다' : undefined,
    m.totalIsFloor ? '총계가 하한이라 진짜 총계는 더 클 수 있다' : undefined,
  ].filter((s): s is string => s !== undefined);
  return `판정 불가 (${why.join(' · ')})`;
}

/**
 * 선언과 실측을 대조한다.
 *
 * 어긋나면 **실패** 다 — 표에 찍고 마는 것이 아니라 집계에 들어가고 종료 코드를 바꾼다.
 * 실측이 `null`(판정 불가)일 때만 방향에 따라 갈린다: 좁게 신고한 `false` 는 실측이
 * 부정하지 못하므로 불확정이고, `true` 는 증명되지 않았으므로 실패다. 이 비대칭이
 * "증명할 수 없으면 덜 신고한다" 는 규칙을 코드로 만든 것이다.
 *
 * `null` 신고는 실측이 무엇이든 **실패** 다. 두 호출 지점이 먹이는 것은 닫힌 어휘 축의
 * 선언뿐이고, 거기서 `null` 은 "덜 신고했다" 가 아니라 **신고하지 않았다** 이다. 위의
 * 비대칭은 부정할 신고가 있을 때의 이야기라 부재에는 적용되지 않는다 — 적용하면 실측이
 * 흐린 축(overlapping 이라 늘 판정 불가인 ctgov `phase` 같은)에서 신고 누락이 영영
 * ⚠️ 로 통과한다. 계약 스위트가 같은 것을 선언 쪽에서 막는다('지원되는 닫힌 어휘 축은
 * exhaustive 를 신고한다'); 여기는 업스트림을 실제로 치는 쪽의 같은 방어선이다.
 */
export function compareDeclared(declared: boolean | null, measured: Measured): Judgement {
  const shown = declared === null ? '`null`' : `\`${declared}\``;
  if (declared === null) {
    return {
      verdict: 'fail',
      note: '**닫힌 어휘 축인데 `exhaustive` 를 신고하지 않았습니다(`null`).** `null` 은 자유 텍스트 축의 모양이라, 가드도 이 대조도 침묵합니다 — 증명하지 못했으면 `false` 로 신고하세요.',
    };
  }
  if (measured === null) {
    if (declared === true) {
      return {
        verdict: 'fail',
        note: '**실측이 `true` 를 증명하지 못했는데 `true` 로 신고했습니다.** 이 측정으로는 덮개를 결론지을 수 없습니다 — 증명될 때까지 `false` 로 신고하세요.',
      };
    }
    return {
      verdict: 'inconclusive',
      note: `이 측정으로는 덮개를 결론지을 수 없습니다. 신고 ${shown} 는 실측이 부정하지 못하는 쪽이라 실패로 세지 않습니다.`,
    };
  }
  if (declared === measured) {
    return { verdict: 'pass', note: `신고 ${shown} 가 실측과 같습니다.` };
  }
  return {
    verdict: 'fail',
    note: `**선언과 실측이 어긋납니다** — 신고 ${shown}, 실측 \`${measured}\`. capability 의 \`exhaustive\` 를 실측에 맞추세요.`,
  };
}
