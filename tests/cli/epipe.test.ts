import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const BIN = new URL('../../dist/cli/bin.js', import.meta.url).pathname;

/**
 * S6 원 커맨드(`ctreg search ... | head`, 큰 출력)는 단발로도 EPIPE 를 100% 재현한다.
 * 여기서 `registries` 하나만 쓰면 재현되지 않는 이유는 이 환경 자체가 아니라 출력
 * 크기다 — `registries` 출력(~970B)이 파이프 버퍼에 다 들어가서, node 가 한 번의
 * write() 로 다 쓰고 종료할 때까지 `head` 가 아직 읽는 중인 경우가 대부분이라 EPIPE 가
 * 안 난다. 같은 명령을 여러 번 연달아 흘려보내 누적 출력을 버퍼보다 키우면 신뢰성 있게
 * 재현된다(로컬에서 반복 재현 확인됨).
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

/** 빌드 산출물을 파이프 없이 직접 띄워 ctreg 자신의 종료 코드를 잡는다. */
function runBare(args: readonly string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = execFile('node', [BIN, ...args], () => {
      resolve(child.exitCode);
    });
  });
}

/**
 * 빌드 산출물을 `| head -c N` 뒤에서 띄워 파이프를 조기에 닫되, `head` 가 아니라
 * ctreg 자신의 종료 코드를 `PIPESTATUS`(bash 전용, `sh` 의 POSIX 모드에는 없다)로 잡는다.
 */
function runPiped(args: readonly string[], headBytes = 10): Promise<number | null> {
  return new Promise((resolve) => {
    const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const child = execFile(
      'bash',
      ['-c', `node ${BIN} ${quoted} | head -c ${headBytes} >/dev/null; exit \${PIPESTATUS[0]}`],
      () => {
        resolve(child.exitCode);
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

  it('파이프가 일찍 닫혀도 실패 종료 코드를 0 으로 덮지 않는다', async () => {
    // 이 CLI 의 계약은 실패를 성공처럼 보이지 않게 하는 것이다. 파이프가 닫혔다는
    // 이유로 코드를 0 으로 만들면 소비자가 실패를 성공으로 읽는다.
    for (const [args, expected] of [
      [['get', 'NOSUCHID'], 2],
      [['get', 'EUCTR:2020-000001-11'], 3],
    ] as const) {
      const direct = await runBare(args);
      const piped = await runPiped(args);
      expect(direct).toBe(expected);
      expect(piped).toBe(expected);
    }
  });

  it('EPIPE 가 실제로 발생하는 경로에서도 종료 코드를 보존한다', async () => {
    // 위 두 케이스는 출력이 작아(400B 대) 파이프 버퍼에 다 들어가므로 EPIPE 자체가 안
    // 날 수 있다 — 그래도 계약을 고정하는 값어치는 있다. 이 케이스는 잘못된 ID 를 대량
    // 으로(6000개) 넘겨 usage 오류 출력을 200KB 이상으로 부풀려, 파이프 버퍼보다 커진
    // 출력이 실제로 EPIPE 를 유발하는 경로를 확인한다(로컬에서 직접 재현 확인됨).
    const ids = Array.from({ length: 6000 }, (_, i) => `NOSUCHID${i}`);
    const direct = await runBare(['get', ...ids]);
    const piped = await runPiped(['get', ...ids]);
    expect(direct).toBe(2);
    expect(piped).toBe(2);
  }, 15000);
});
