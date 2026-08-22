import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

beforeAll(() => {
  execSync('bun run build', { cwd: ROOT, stdio: 'inherit' });
  expect(existsSync(join(ROOT, 'dist/runtime/throttle.js'))).toBe(true);
}, 120_000);

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
