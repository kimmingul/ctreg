import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

/**
 * 빌드는 **여기서 하지 않는다.** 예전에는 이 자리에서 `bun run build` 를 돌렸는데,
 * vitest 가 파일을 병렬로 돌리는 탓에 그 빌드가 `cli/epipe.test.ts` 의 dist 실행과 겹쳐
 * 모듈 로드를 깨뜨렸다 — O3·O4 로 세 번 기록된 "플레이크" 의 정체가 그것이다.
 * 지금은 `tests/global-setup.ts` 가 모든 파일보다 먼저 한 번 빌드한다.
 */
beforeAll(() => {
  expect(existsSync(join(ROOT, 'dist/runtime/throttle.js'))).toBe(true);
});

describe('교차 프로세스 요청률', () => {
  it('동시에 뜬 4개 프로세스가 1 req/s 를 함께 지킨다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctreg-proc-'));
    const log = join(dir, 'stamps.txt');
    writeFileSync(log, '');

    // 동시에 띄운다 — 이것이 참조 구현의 인메모리 큐가 무너지는 시나리오다.
    // execFileSync 로 4번 부르면 순차 실행이라 진짜 동시성을 만들지 못한다 — spawn
    // 으로 전부 먼저 띄우고 전부 종료될 때까지 기다려야 온디스크 버킷이 실제로
    // 경합 상황에서 직렬화하는지가 드러난다.
    const runAll = () =>
      Promise.all(
        Array.from({ length: 4 }, () =>
          new Promise<void>((resolve, reject) => {
            const p = spawn(process.execPath, [join(ROOT, 'scripts/throttle-probe.mjs'), dir, log, '1'], {
              cwd: ROOT,
            });
            p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}`))));
            p.on('error', reject);
          }),
        ),
      );
    await runAll();

    const stamps = readFileSync(log, 'utf8').trim().split('\n').map(Number).sort((a, b) => a - b);
    expect(stamps).toHaveLength(4);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(950);
    }
  }, 60_000);
});
