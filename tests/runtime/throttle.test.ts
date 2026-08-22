import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { beforeEach, describe, expect, it } from 'vitest';
import { bucketPath, reserveSlot, shareBackoff } from '../../src/runtime/throttle.js';

/** sleep 이 시계를 앞으로 감는 가짜 시계 — 실시간 대기 없이 결정적으로 검증한다. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, set: (v: number) => { t = v; } };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctreg-throttle-')); });

describe('온디스크 토큰버킷', () => {
  it('첫 호출은 대기하지 않는다', async () => {
    const c = fakeClock();
    const r = await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(r.waitedMs).toBe(0);
    expect(r.lockTimedOut).toBe(false);
  });

  it('연속 호출은 요청률 간격만큼 누적 대기한다', async () => {
    const c = fakeClock();
    const o = { dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep };
    expect((await reserveSlot(o)).waitedMs).toBe(0);
    expect((await reserveSlot(o)).waitedMs).toBe(1000);
    expect((await reserveSlot(o)).waitedMs).toBe(1000);
  });

  it('상태가 디스크에 남아 다음 프로세스가 이어받는다', async () => {
    const c = fakeClock();
    await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    const state = JSON.parse(readFileSync(bucketPath(dir, 'ctgov'), 'utf8'));
    expect(state.nextAvailableAt).toBe(1_000_000 + 1000);
  });

  it('공유된 백오프가 미래면 그때까지 기다린다 — 한 프로세스의 429 를 나머지가 안다', async () => {
    const c = fakeClock();
    writeFileSync(
      bucketPath(dir, 'ctgov'),
      JSON.stringify({ nextAvailableAt: 0, blockedUntil: 1_005_000 }),
    );
    const r = await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(r.waitedMs).toBe(5000);
  });

  it('shareBackoff 는 blockedUntil 을 앞당기지 않고 늦추기만 한다', async () => {
    const o = { dir, registry: 'ctgov', ratePerSec: 1 };
    await shareBackoff(o, 2_000_000);
    await shareBackoff(o, 1_500_000);
    const state = JSON.parse(readFileSync(bucketPath(dir, 'ctgov'), 'utf8'));
    expect(state.blockedUntil).toBe(2_000_000);
  });

  it('레지스트리마다 버킷 파일이 분리된다', async () => {
    const c = fakeClock();
    await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    const other = await reserveSlot({ dir, registry: 'ictrp', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(other.waitedMs).toBe(0);
    expect(bucketPath(dir, 'ctgov')).not.toBe(bucketPath(dir, 'ictrp'));
  });

  it('락을 잡지 못하면 fail-open 하지 않고 최소 간격만큼 대기한다', async () => {
    const c = fakeClock();
    const path = bucketPath(dir, 'ctgov');
    writeFileSync(path, JSON.stringify({ nextAvailableAt: 0 }));
    const release = await lockfile.lock(path, { realpath: false });
    try {
      const r = await reserveSlot({
        dir, registry: 'ctgov', ratePerSec: 1, lockRetryMaxMs: 50, now: c.now, sleep: c.sleep,
      });
      expect(r.lockTimedOut).toBe(true);
      expect(r.waitedMs).toBe(1000);
    } finally {
      await release();
    }
  });

  it('손상된(파싱 불가) 버킷 파일은 즉시 허용이 아니라 한 간격만큼 대기하게 한다', async () => {
    const c = fakeClock();
    const path = bucketPath(dir, 'ctgov');
    writeFileSync(path, '{이것은 유효한 JSON 이 아니다');
    const r = await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(r.waitedMs).toBe(1000);
  });
});
