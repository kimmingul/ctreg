import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

export type ThrottleOpts = {
  dir: string;
  registry: string;
  ratePerSec: number;
  lockTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type BucketState = { nextAvailableAt: number; blockedUntil?: number };

export function bucketPath(dir: string, registry: string): string {
  return join(dir, `bucket-${registry}.json`);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ensureBucket(path: string, dir: string): BucketState {
  mkdirSync(dir, { recursive: true });
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BucketState;
  } catch {
    // 없거나 손상됨 — 보수적으로 빈 상태에서 시작한다.
    const fresh: BucketState = { nextAvailableAt: 0 };
    writeFileSync(path, JSON.stringify(fresh));
    return fresh;
  }
}

/**
 * 다음 요청 슬롯을 예약한다. 락은 상태를 갱신하는 동안에만 잡고,
 * 실제 대기는 락을 놓은 뒤에 한다 — 그래야 다른 프로세스가 뒤 슬롯을 즉시 예약한다.
 */
export async function reserveSlot(
  o: ThrottleOpts,
): Promise<{ waitedMs: number; lockTimedOut: boolean }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const intervalMs = Math.ceil(1000 / o.ratePerSec);
  const path = bucketPath(o.dir, o.registry);
  ensureBucket(path, o.dir);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(path, {
      realpath: false,
      stale: 10_000,
      retries: { retries: 10, minTimeout: 20, maxTimeout: o.lockTimeoutMs ?? 500 },
    });
  } catch {
    // fail-open 금지. 단독 진행하되 최소 간격만큼은 반드시 기다린다.
    await sleep(intervalMs);
    return { waitedMs: intervalMs, lockTimedOut: true };
  }

  let target: number;
  const start = now();
  try {
    const state = ensureBucket(path, o.dir);
    target = Math.max(start, state.nextAvailableAt, state.blockedUntil ?? 0);
    writeFileSync(path, JSON.stringify({ ...state, nextAvailableAt: target + intervalMs }));
  } finally {
    await release();
  }

  const waitedMs = Math.max(0, target - start);
  if (waitedMs > 0) await sleep(waitedMs);
  return { waitedMs, lockTimedOut: false };
}

/** 429 를 받은 프로세스가 나머지 프로세스에게 대기를 알린다. 늦추기만 하고 앞당기지 않는다. */
export async function shareBackoff(o: ThrottleOpts, untilEpochMs: number): Promise<void> {
  const path = bucketPath(o.dir, o.registry);
  ensureBucket(path, o.dir);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(path, { realpath: false, stale: 10_000, retries: 5 });
  } catch {
    return; // 알리지 못해도 본인의 백오프는 유효하다.
  }
  try {
    const state = ensureBucket(path, o.dir);
    const blockedUntil = Math.max(state.blockedUntil ?? 0, untilEpochMs);
    writeFileSync(path, JSON.stringify({ ...state, blockedUntil }));
  } finally {
    await release();
  }
}
