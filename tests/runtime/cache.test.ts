import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheKey, readCache, writeCache } from '../../src/runtime/cache.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctreg-cache-')); });

describe('응답 캐시', () => {
  it('키는 파라미터 순서에 안정적이다', () => {
    const a = cacheKey('ctgov', '/studies', { pageSize: 20, 'query.cond': 'NSCLC' });
    const b = cacheKey('ctgov', '/studies', { 'query.cond': 'NSCLC', pageSize: 20 });
    expect(a).toBe(b);
  });

  it('undefined 파라미터는 키에 영향을 주지 않는다', () => {
    const a = cacheKey('ctgov', '/studies', { 'query.cond': 'NSCLC' });
    const b = cacheKey('ctgov', '/studies', { 'query.cond': 'NSCLC', 'query.lead': undefined });
    expect(a).toBe(b);
  });

  it('레지스트리가 다르면 키가 다르다', () => {
    expect(cacheKey('ctgov', '/studies', {})).not.toBe(cacheKey('ictrp', '/studies', {}));
  });

  it('값 안에 구분자(&, =)가 있어도 다른 쿼리와 키가 충돌하지 않는다', () => {
    const a = cacheKey('ctgov', '/studies', { a: 'x&b=y' });
    const b = cacheKey('ctgov', '/studies', { a: 'x', b: 'y' });
    expect(a).not.toBe(b);
  });

  it('TTL 안에서는 읽히고 지나면 undefined 다', async () => {
    let t = 1_000_000;
    const now = () => t;
    await writeCache(dir, 'k1', { hello: 'world' }, '2026-08-22T00:00:00.000Z', now);
    expect((await readCache<{ hello: string }>(dir, 'k1', 60, now))?.value).toEqual({ hello: 'world' });
    t += 61_000;
    expect(await readCache(dir, 'k1', 60, now)).toBeUndefined();
  });

  it('TTL 경계는 포함이다 — 정확히 ttl 만큼 지난 시점은 아직 유효, 1ms 더 지나면 미스', async () => {
    let t = 1_000_000;
    const now = () => t;
    await writeCache(dir, 'kb', { v: 1 }, '2026-08-22T00:00:00.000Z', now);
    t = 1_000_000 + 60_000; // 정확히 60초 경과
    expect((await readCache(dir, 'kb', 60, now))?.value).toEqual({ v: 1 });
    t += 1; // 60초 + 1ms 경과
    expect(await readCache(dir, 'kb', 60, now)).toBeUndefined();
  });

  it('fetchedAt 은 원 응답 시각을 그대로 돌려준다 — 캐시 저장 시각이 아니다', async () => {
    const now = () => 1_000_000;
    await writeCache(dir, 'k2', { a: 1 }, '2026-08-01T12:34:56.000Z', now);
    expect((await readCache(dir, 'k2', 3600, now))?.fetchedAt).toBe('2026-08-01T12:34:56.000Z');
  });

  it('손상된 캐시 파일은 예외 대신 캐시 미스로 처리한다', async () => {
    const now = () => 1_000_000;
    await writeCache(dir, 'k3', { a: 1 }, '2026-08-22T00:00:00.000Z', now);
    const file = readdirSync(dir).find((f) => f.includes('k3')) ?? readdirSync(dir)[0]!;
    writeFileSync(join(dir, file), '{ not json');
    expect(await readCache(dir, 'k3', 3600, now)).toBeUndefined();
  });

  it('올바른 JSON 이지만 캐시 항목 모양이 아니면 미스로 처리한다', async () => {
    const now = () => 1_000_000;
    await writeCache(dir, 'k4', { a: 1 }, '2026-08-22T00:00:00.000Z', now);
    const file = readdirSync(dir).find((f) => f.includes('k4')) ?? readdirSync(dir)[0]!;
    writeFileSync(join(dir, file), JSON.stringify({ foo: 'bar' }));
    expect(await readCache(dir, 'k4', 3600, now)).toBeUndefined();
  });

  it('storedAt 이 없는 항목은 미스로 처리한다 — 없으면 NaN 비교가 되어 절대 만료되지 않는다', async () => {
    const now = () => 1_000_000;
    await writeCache(dir, 'k5', { a: 1 }, '2026-08-22T00:00:00.000Z', now);
    const file = readdirSync(dir).find((f) => f.includes('k5')) ?? readdirSync(dir)[0]!;
    writeFileSync(
      join(dir, file),
      JSON.stringify({ value: { a: 1 }, fetchedAt: '2026-08-22T00:00:00.000Z' }),
    );
    expect(await readCache(dir, 'k5', 3600, now)).toBeUndefined();
  });

  it('없는 키는 undefined 다', async () => {
    expect(await readCache(dir, 'missing', 3600)).toBeUndefined();
  });
});
