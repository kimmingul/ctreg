import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CacheEntry<T> = { value: T; fetchedAt: string };
type StoredEntry<T> = CacheEntry<T> & { storedAt: number };

/**
 * 키는 파라미터 순서와 undefined 에 안정적이어야 한다 — 아니면 캐시가 사실상 동작하지 않는다.
 *
 * 정렬된 [key, value] 쌍을 JSON.stringify 로 직렬화해서 해시한다 — `k=v` 를
 * `&` 로 join 하는 방식은 값 자체에 `&` 나 `=` 가 들어 있으면(임상시험 스폰서명,
 * 자유텍스트 조건문 등에서 흔하다) 서로 다른 쿼리가 같은 문자열로 뭉개져 키가
 * 충돌한다 — 캐시가 다른 쿼리의 응답을 돌려주는 false hit 이 된다. JSON 이스케이프는
 * 구조(배열 경계, 구분자)와 값 내용을 구조적으로 분리하므로 값이 구분자를
 * 위조할 수 없다.
 *
 * String(v) 로 값을 문자열화하는 건 정밀도 손실이 아니라 의도다: 이 파라미터들은
 * HTTP 계층에서 searchParams.set(k, String(v)) 로 실제 요청을 만드는 데 쓰이므로,
 * 1 과 '1' 은 바이트 단위로 동일한 요청이 되고 캐시 키도 같아야 맞다.
 */
export function cacheKey(
  registry: string,
  endpoint: string,
  params: Record<string, unknown>,
): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, String(v)]);
  return createHash('sha256')
    .update(JSON.stringify([registry, endpoint, normalized]))
    .digest('hex');
}

const entryPath = (dir: string, key: string) => join(dir, `resp-${key}.json`);

/**
 * JSON.parse 가 성공했다고 해서 캐시 항목 모양이라는 보장은 없다 — 다른 프로그램이
 * 쓴 파일이거나 예전 스키마의 잔재일 수 있다. storedAt 이 숫자가 아니면
 * `now() - storedAt` 이 NaN 이 되고 `NaN > ttl` 은 항상 false 라서 절대 만료되지
 * 않는 유령 항목이 생긴다. 모양을 검증하지 않으면 손상된 캐시가 에러도 미스도
 * 아닌 "말도 안 되는 값을 진짜인 것처럼 돌려주는" 세 번째 상태가 되어버린다.
 */
function isStoredEntry(x: unknown): x is StoredEntry<unknown> {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.storedAt === 'number' && typeof o.fetchedAt === 'string' && 'value' in o;
}

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
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredEntry(parsed)) return undefined; // 파싱은 됐지만 캐시 항목 모양이 아니다 — 미스로 처리한다.
    const entry = parsed as StoredEntry<T>;
    // TTL 경계는 포함이다: storedAt 로부터 정확히 ttlSec 가 지난 순간까지는 아직
    // 유효하고, 그 다음 1ms 부터 미스다 (elapsed > ttl 일 때만 만료).
    if (now() - entry.storedAt > ttlSec * 1000) return undefined;
    // fetchedAt 은 원 응답 시각 그대로 돌려준다 — 저장 시각(storedAt)과 절대 섞지 않는다.
    return { value: entry.value, fetchedAt: entry.fetchedAt };
  } catch {
    return undefined; // 없거나 파싱 자체가 안 됨 — 둘 다 그냥 미스다, 에러가 아니다.
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
