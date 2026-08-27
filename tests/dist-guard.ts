/**
 * `dist/` 를 실행하는 테스트(`cli/epipe.test.ts`, `runtime/throttle.process.test.ts`)의
 * 선결 조건.
 *
 * **왜 있는가.** `tsc` 는 `dist/` 를 한 파일씩 쓴다. 빌드가 도는 동안 `dist` 는 내부적으로
 * 어긋난 상태이고(한 파일은 새 판, 옆 파일은 아직 옛 판), 그때 `node dist/cli/bin.js` 를
 * 띄우면 모듈 로드가 깨진다. 그 SyntaxError 스택트레이스에는 `node:internal` 이 들어 있어
 * 「스택트레이스를 내지 않는다」 같은 단언이 실패하는데 — **그 테스트가 주장하는 것과
 * 무관한 이유로** 실패한다.
 *
 * 이 저장소는 그 실패를 세 번 보고 세 번 다 이름을 못 잡았다(O3·O4). 그때마다 "벽시계
 * 의존 플레이크" 로 분류했지만 원인은 타이밍이 아니라 **빌드와 테스트가 같은 산출물을
 * 두고 벌이는 경쟁** 이었다(2026-08-27 확정: 동시 빌드 15회 중 2회 실패, 동시 빌드 없이
 * 30회 전부 통과).
 *
 * **고치는 것이 아니라 이름 붙이는 장치다.** 누가 동시에 빌드하는 것을 막을 수는 없다.
 * 막을 수 있는 것은 그 실패가 **자기가 왜 실패했는지 거짓으로 말하는 것** 이고,
 * 이 저장소는 "제목이 거짓말하는 테스트는 없는 것보다 나쁘다" 를 규칙으로 적어 두었다.
 */

/**
 * 반쯤 쓰인 `dist/` 를 실행했을 때의 출력인가. 맞으면 사람이 읽을 진단을, 아니면 `undefined`.
 *
 * **좁게 잡는 것이 이 함수의 안전 조건이다.** 넓게 잡으면 진짜 결함(ctreg 가 스택트레이스를
 * 흘리는 것)을 "빌드 경쟁" 으로 오진해 조용히 덮는다 — 그래서 `node:internal` 이나
 * `SyntaxError` 만으로는 판정하지 않고, **`dist/` 경로가 함께 있고** 모듈 해석 단계의
 * 실패임이 드러난 경우에만 참이라고 말한다.
 */
export function distLoadFailure(output: string): string | undefined {
  if (!output.includes('/dist/')) return undefined;
  const moduleLoad =
    output.includes('does not provide an export named') ||
    output.includes('ERR_MODULE_NOT_FOUND') ||
    output.includes('Cannot find module');
  if (!moduleLoad) return undefined;

  return (
    '이 테스트는 `dist/` 를 실행하는데 그 `dist/` 가 온전하지 않습니다 — 모듈 로드가 깨졌습니다.\n' +
    '거의 언제나 원인은 **빌드가 동시에 돌고 있는 것** 입니다: `tsc` 는 dist 를 한 파일씩 쓰므로\n' +
    '그 사이 dist 는 내부적으로 어긋나 있습니다(한 파일은 새 판, 옆 파일은 옛 판).\n' +
    '`npm run build` 가 끝난 뒤에 다시 돌리세요. 이 실패는 테스트가 주장하는 내용과 무관합니다.\n' +
    '--- 실제 출력 ---\n' +
    output.trim().split('\n').slice(0, 6).join('\n')
  );
}

/** 진단이 있으면 던진다. 없으면 아무 일도 하지 않는다. */
export function assertDistLoadable(output: string): void {
  const msg = distLoadFailure(output);
  if (msg !== undefined) throw new Error(msg);
}
