import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CacheEntry<T> = { value: T; fetchedAt: string };
type StoredEntry<T> = CacheEntry<T> & { storedAt: number };

/** 키는 파라미터 순서와 undefined 에 안정적이어야 한다 — 아니면 캐시가 사실상 동작하지 않는다. */
export function cacheKey(
  registry: string,
  endpoint: string,
  params: Record<string, unknown>,
): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return createHash('sha256').update(`${registry}|${endpoint}|${normalized}`).digest('hex');
}

const entryPath = (dir: string, key: string) => join(dir, `resp-${key}.json`);

/**
 * 락을 쓰지 않는다: 캐시 항목은 입력의 해시로 주소가 정해지는 write-once
 * 불변 값이라 두 프로세스가 같은 키를 써도 같은 바이트를 쓴다 — 잃어버릴
 * 갱신이 없으니 상호 배제가 필요 없다. 필요한 건 원자성뿐이고, 그건
 * writeCache 의 temp-file + rename 이 POSIX 에서 보장한다 (throttle.ts 의
 * 버킷과 달리 read-modify-write 상태가 아니다).
 */
export async function readCache<T>(
  dir: string,
  key: string,
  ttlSec: number,
  now: () => number = Date.now,
): Promise<CacheEntry<T> | undefined> {
  try {
    const raw = await readFile(entryPath(dir, key), 'utf8');
    const entry = JSON.parse(raw) as StoredEntry<T>;
    if (now() - entry.storedAt > ttlSec * 1000) return undefined;
    // fetchedAt 은 원 응답 시각 그대로 돌려준다 — 저장 시각(storedAt)과 절대 섞지 않는다.
    return { value: entry.value, fetchedAt: entry.fetchedAt };
  } catch {
    return undefined; // 없거나 손상됨 — 둘 다 그냥 미스다, 에러가 아니다.
  }
}

export async function writeCache(
  dir: string,
  key: string,
  value: unknown,
  fetchedAt: string,
  now: () => number = Date.now,
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const target = entryPath(dir, key);
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const entry: StoredEntry<unknown> = { value, fetchedAt, storedAt: now() };
  // 임시 파일에 쓴 뒤 rename — 원자적 교체라 동시에 읽는 다른 프로세스가
  // 반쯤 쓰인 내용을 보는 torn read 가 구조적으로 불가능하다.
  await writeFile(tmp, JSON.stringify(entry));
  await rename(tmp, target);
}
