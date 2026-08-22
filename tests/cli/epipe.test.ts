import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const BIN = new URL('../../dist/cli/bin.js', import.meta.url).pathname;

/**
 * 빌드 산출물을 실제 프로세스로 띄워 파이프를 조기에 닫는다.
 *
 * 단발 `registries | head -c 10` 는 이 환경에서 신뢰성 있게 재현되지 않았다: `registries`
 * 출력(~970B)이 파이프 버퍼보다 훨씬 작아서, node 가 쓰기를 마치고 종료할 때까지 `head`
 * 가 아직 읽는 중인 경우가 대부분이라 EPIPE 가 발생하지 않는다. 같은 명령을 여러 번
 * 연달아 파이프에 흘려보내면 첫 프로세스가 끝난 뒤에도 뒤따르는 프로세스들이 이미 닫힌
 * 파이프에 쓰게 되어 EPIPE 가 안정적으로 재현된다(로컬에서 반복 재현 확인됨).
 */
function pipeThroughHead(): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      'sh',
      ['-c', `for i in $(seq 1 5); do node ${BIN} registries; done | head -c 10`],
      (_e, _o, stderr) => {
        resolve({ code: child.exitCode, stderr });
      },
    );
  });
}

describe('출력 파이프가 일찍 닫힐 때', () => {
  it('스택트레이스를 내지 않는다', async () => {
    const { stderr } = await pipeThroughHead();
    expect(stderr).not.toContain('EPIPE');
    expect(stderr).not.toContain('node:internal');
  });
});
