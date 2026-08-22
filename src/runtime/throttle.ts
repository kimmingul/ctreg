import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

export type ThrottleOpts = {
  dir: string;
  registry: string;
  ratePerSec: number;
  /**
   * proper-lockfile 의 `retries.maxTimeout` 에 그대로 전달되는 값 — 락 획득
   * 재시도 "한 번당" backoff 상한이다. 총 대기시간의 상한이 아니다: 하드코딩된
   * `retries: 10` 회와 결합해 실제로는 이보다 훨씬 오래 걸릴 수 있다.
   */
  lockRetryMaxMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type BucketState = { nextAvailableAt: number; blockedUntil?: number };

export function bucketPath(dir: string, registry: string): string {
  return join(dir, `bucket-${registry}.json`);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 락을 잡기 전에 파일이 존재하는지만 보장한다 — `proper-lockfile` 은 잠글 대상이
 * 있어야 하기 때문이다. 'a' 로 열면 없으면 만들고 있으면 절대 비우지 않는다.
 * 절대 여기서 내용을 읽거나 쓰지 않는다: 상태를 다루는 모든 read-modify-write 는
 * 락 안에서만 일어나야 다른 프로세스가 쓰는 중인 파일을 이 프로세스가 락 없이
 * 덮어써버리는 경합이 사라진다.
 */
function ensureFileExists(path: string, dir: string): void {
  mkdirSync(dir, { recursive: true });
  closeSync(openSync(path, 'a'));
}

/**
 * 락을 쥔 상태에서만 호출한다. 파일이 없거나 방금 `ensureFileExists` 로 막
 * 생성되어 비어 있으면 최초 호출이므로 가장 관대한 초기 상태에서 시작한다.
 * 반대로 내용은 있는데 파싱이 안 되면 진짜 손상이다 — 마지막 요청 시각을 알
 * 수 없으므로 "즉시 허용"(nextAvailableAt: 0) 대신 `conservative` 를 돌려줘
 * 최소한 한 간격만큼은 대가를 치르게 한다. 손상 복구가 가장 관대한 상태를
 * 내놓으면 이 파일이 막으려는 바로 그 thundering herd 를 초래한다.
 */
function readBucketLocked(path: string, conservative: BucketState): BucketState {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { nextAvailableAt: 0 };
  }
  if (raw.length === 0) return { nextAvailableAt: 0 };
  try {
    return JSON.parse(raw) as BucketState;
  } catch {
    return conservative;
  }
}

/**
 * 임시 파일에 쓴 뒤 rename 한다. rename 은 원자적이라 다른 프로세스가 읽는
 * 도중에 이 파일의 절반만 쓰인 내용을 보는 "torn read" 가 구조적으로
 * 불가능하다 — 락에 의존하는 것과 별개의 방어선이다.
 */
function writeBucketAtomic(path: string, state: BucketState): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

/**
 * 다음 요청 슬롯을 예약한다. 락은 상태를 읽고 갱신하는 동안에만 잡고,
 * 실제 대기는 락을 놓은 뒤에 한다 — 그래야 다른 프로세스가 뒤 슬롯을 즉시 예약한다.
 */
export async function reserveSlot(
  o: ThrottleOpts,
): Promise<{ waitedMs: number; lockTimedOut: boolean }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const intervalMs = Math.ceil(1000 / o.ratePerSec);
  const path = bucketPath(o.dir, o.registry);
  ensureFileExists(path, o.dir);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(path, {
      realpath: false,
      stale: 10_000,
      retries: { retries: 10, minTimeout: 20, maxTimeout: o.lockRetryMaxMs ?? 500 },
    });
  } catch {
    // fail-open 금지. 단독 진행하되 최소 간격만큼은 반드시 기다린다.
    await sleep(intervalMs);
    return { waitedMs: intervalMs, lockTimedOut: true };
  }

  let target: number;
  const start = now();
  try {
    const state = readBucketLocked(path, { nextAvailableAt: start + intervalMs });
    target = Math.max(start, state.nextAvailableAt, state.blockedUntil ?? 0);
    writeBucketAtomic(path, { ...state, nextAvailableAt: target + intervalMs });
  } finally {
    await release();
  }

  const waitedMs = Math.max(0, target - start);
  if (waitedMs > 0) await sleep(waitedMs);
  return { waitedMs, lockTimedOut: false };
}

/** 429 를 받은 프로세스가 나머지 프로세스에게 대기를 알린다. 늦추기만 하고 앞당기지 않는다. */
export async function shareBackoff(o: ThrottleOpts, untilEpochMs: number): Promise<void> {
  const now = o.now ?? Date.now;
  const intervalMs = Math.ceil(1000 / o.ratePerSec);
  const path = bucketPath(o.dir, o.registry);
  ensureFileExists(path, o.dir);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(path, { realpath: false, stale: 10_000, retries: 5 });
  } catch {
    return; // 알리지 못해도 본인의 백오프는 유효하다.
  }
  try {
    const start = now();
    const state = readBucketLocked(path, { nextAvailableAt: start + intervalMs });
    const blockedUntil = Math.max(state.blockedUntil ?? 0, untilEpochMs);
    writeBucketAtomic(path, { ...state, blockedUntil });
  } finally {
    await release();
  }
}
