import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/runtime/config.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { CtregError } from '../../src/runtime/errors.js';

describe('설정', () => {
  it('환경변수가 없으면 스펙의 기본값을 쓴다', () => {
    const c = loadConfig({});
    expect(c.cacheTtlSec).toBe(3600);
    expect(c.timeoutMs).toBe(30000);
    expect(c.maxRetries).toBe(3);
    expect(c.ctgovBaseUrl).toBe('https://clinicaltrials.gov/api/v2');
    expect(c.cacheDir).toBe(`${homedir()}/.cache/ctreg`);
  });

  it('CTREG_RATE_PER_SEC 이 없으면 ratePerSec 는 undefined 다 — 전역 오버라이드가 아니라 각 어댑터의 선언값을 쓰라는 신호다', () => {
    expect(loadConfig({}).ratePerSec).toBeUndefined();
  });

  it('CTREG_CACHE_DIR 이 XDG_CACHE_HOME 보다 우선한다', () => {
    expect(loadConfig({ CTREG_CACHE_DIR: '/tmp/a', XDG_CACHE_HOME: '/tmp/b' }).cacheDir).toBe('/tmp/a');
    expect(loadConfig({ XDG_CACHE_HOME: '/tmp/b' }).cacheDir).toBe('/tmp/b/ctreg');
  });

  it('숫자 환경변수를 반영한다', () => {
    expect(loadConfig({ CTREG_CACHE_TTL_SEC: '60', CTREG_RATE_PER_SEC: '2' })).toMatchObject({
      cacheTtlSec: 60, ratePerSec: 2,
    });
  });

  it('숫자가 아닌 값은 조용히 넘기지 않고 exit 2 로 알린다', () => {
    try {
      loadConfig({ CTREG_MAX_RETRIES: 'many' });
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).message).toContain('CTREG_MAX_RETRIES');
    }
  });
});
