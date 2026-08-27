/**
 * `dist/` 를 실행하는 테스트가 **왜 실패했는지 거짓말하지 않게** 하는 장치.
 *
 * 2026-08-27 에 확정된 원인: `tsc` 는 `dist/` 를 한 파일씩 쓴다. 그 사이 `dist` 는 내부적으로
 * 어긋난 상태이고(`adapter.js` 는 새 판, `map.js` 는 아직 옛 판), 그때 `node dist/cli/bin.js`
 * 를 띄우면 모듈 로드가 깨진다. 그 SyntaxError 스택트레이스에 `node:internal` 이 들어 있어
 * `epipe.test.ts` 의 「스택트레이스를 내지 않는다」가 실패하는데 — **그 테스트가 주장하는
 * 것과 무관한 이유로** 실패한다. 세 번 목격하고 세 번 다 이름을 못 잡은 것이 이것이다.
 *
 * 아래 표본은 실제로 잡은 출력이다(재현: 동시 빌드 15회 중 2회 실패).
 */
import { describe, expect, it } from 'vitest';
import { distLoadFailure } from './dist-guard.js';

/** 실제로 잡은 출력. 손으로 지어낸 것이 아니다. */
const REAL = `file:///Users/min/Projects/ctreg/dist/adapters/isrctn/adapter.js:5
import { mapTrial } from './map.js';
         ^^^^^^^^
SyntaxError: The requested module './map.js' does not provide an export named 'mapTrial'
    at #asyncInstantiate (node:internal/modules/esm/module_job:463:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:561:5)
`;

describe('dist 선결 조건', () => {
  it('반쯤 쓰인 dist 를 알아보고 원인을 이름 붙인다', () => {
    const msg = distLoadFailure(REAL);
    expect(msg).toBeDefined();
    // 다음 사람이 읽고 무엇을 해야 할지 알아야 한다 — 원인과 대처가 다 있어야 한다.
    expect(msg).toContain('빌드');
    expect(msg).toContain('dist');
  });

  it('모듈을 아예 못 찾는 경우도 알아본다', () => {
    expect(distLoadFailure(
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/min/Projects/ctreg/dist/cli/output.js'",
    )).toBeDefined();
  });

  /**
   * **이것이 이 헬퍼의 핵심 위험이다.** 너무 넓게 잡으면 진짜 결함(ctreg 가 스택트레이스를
   * 흘리는 것)을 "빌드 경쟁" 으로 오진해 조용히 덮는다. 원래 잡으려던 실패는 그대로 잡혀야 한다.
   */
  it('ctreg 자신이 흘린 스택트레이스는 빌드 경쟁으로 오진하지 않는다', () => {
    expect(distLoadFailure(
      'Error: write EPIPE\n    at afterWriteDispatched (node:internal/stream_base_commons:161:15)',
    )).toBeUndefined();
  });

  it('깨끗한 출력에는 아무 말도 하지 않는다', () => {
    expect(distLoadFailure('')).toBeUndefined();
    expect(distLoadFailure('{"registries":[]}')).toBeUndefined();
  });
});
