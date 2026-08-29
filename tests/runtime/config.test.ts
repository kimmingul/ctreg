import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadEnvFile } from '../../src/runtime/config.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { CtregError } from '../../src/runtime/errors.js';

describe('설정', () => {
  it('환경변수가 없으면 스펙의 기본값을 쓴다', () => {
    const c = loadConfig({});
    expect(c.cacheTtlSec).toBe(3600);
    expect(c.timeoutMs).toBe(30000);
    expect(c.maxRetries).toBe(3);
    expect(c.ctgovBaseUrl).toBe('https://clinicaltrials.gov/api/v2');
    expect(c.ictrpBaseUrl).toBe('https://trialsearch.who.int');
    expect(c.cacheDir).toBe(`${homedir()}/.cache/ctreg`);
  });

  it('CTREG_ICTRP_BASE_URL 이 있으면 그것을 쓴다', () => {
    expect(loadConfig({ CTREG_ICTRP_BASE_URL: 'https://ictrp.example.test' }).ictrpBaseUrl).toBe(
      'https://ictrp.example.test',
    );
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

/**
 * 키를 `.env` 로 주는 것이 CRIS 어댑터의 전제다 — 셸 환경변수로만 받으면 사용자가
 * 매번 `export` 해야 하고, 히스토리에 키가 남는다.
 *
 * **환경변수가 파일을 이긴다.** 파일은 기본값이고 그때그때의 개입이 우선이라야,
 * 한 번 다른 키로 돌려 보는 일이 파일을 고쳤다 되돌리는 일이 되지 않는다.
 */
describe('.env 읽기', () => {
  const write = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ctreg-env-'));
    writeFileSync(join(dir, '.env'), body, 'utf8');
    return dir;
  };

  it('파일의 값을 읽어 온다', () => {
    const dir = write('CTREG_CRIS_SERVICE_KEY=FROM_FILE\n');
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(join(dir, '.env'), env);
    expect(env.CTREG_CRIS_SERVICE_KEY).toBe('FROM_FILE');
  });

  it('이미 있는 환경변수를 덮어쓰지 않는다', () => {
    const dir = write('CTREG_CRIS_SERVICE_KEY=FROM_FILE\n');
    const env: NodeJS.ProcessEnv = { CTREG_CRIS_SERVICE_KEY: 'FROM_SHELL' };
    loadEnvFile(join(dir, '.env'), env);
    expect(env.CTREG_CRIS_SERVICE_KEY).toBe('FROM_SHELL');
  });

  it('주석과 빈 줄과 따옴표를 다룬다', () => {
    const dir = write('# 주석\n\nA=1\nB="따옴표 안"\nC=\'홑따옴표\'\nD=값에=등호가=있다\n');
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(join(dir, '.env'), env);
    expect(env.A).toBe('1');
    expect(env.B).toBe('따옴표 안');
    expect(env.C).toBe('홑따옴표');
    // 첫 등호만 구분자다 — 값 안의 등호까지 자르면 키가 조용히 잘린다.
    expect(env.D).toBe('값에=등호가=있다');
  });

  it('파일이 없으면 아무 일도 하지 않는다 — 키가 필요 없는 사용자를 막지 않는다', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(() => loadEnvFile(join(tmpdir(), 'ctreg-no-such-dir-zz', '.env'), env)).not.toThrow();
    expect(Object.keys(env)).toEqual([]);
  });
});

/**
 * **기본값이 꺼짐인 것이 이 설정의 전부다.**
 *
 * ICTRP 어댑터는 사람이 쓰는 검색 화면을 조작하고, WHO 는 자동 조회를 합의된 파트너에게만
 * 연다(2026-08-29 확인). 그래서 아무 설정도 없는 사용자에게는 꺼져 있어야 한다.
 *
 * 어댑터 쪽 검사(`tests/adapters/ictrp/adapter.test.ts`)는 **꺼진 값이 주어졌을 때** 무슨
 * 일이 일어나는지를 본다 — 그 값이 어디서 오는지는 안 본다. 사보타주로 확인했다:
 * 기본값을 `true` 로 바꿔도 스위트가 통과했다. 그 구멍을 여기서 막는다.
 */
describe('ICTRP 자동 조회는 기본이 꺼짐이다', () => {
  it('아무 설정도 없으면 꺼져 있다', () => {
    expect(loadConfig({}).ictrpAcknowledged).toBe(false);
  });

  it('빈 문자열도 꺼짐이다 — 실수로 켜지지 않게', () => {
    expect(loadConfig({ CTREG_ICTRP_ACKNOWLEDGED: '' }).ictrpAcknowledged).toBe(false);
  });

  it('값이 있으면 켜진다', () => {
    expect(loadConfig({ CTREG_ICTRP_ACKNOWLEDGED: '1' }).ictrpAcknowledged).toBe(true);
    expect(loadConfig({ CTREG_ICTRP_ACKNOWLEDGED: 'yes' }).ictrpAcknowledged).toBe(true);
  });

  /** 나머지 셋은 이 설정과 무관해야 한다 — 하나를 끄려다 전부를 끄면 안 된다. */
  it('다른 레지스트리 설정을 건드리지 않는다', () => {
    const c = loadConfig({});
    expect(c.ctgovBaseUrl.length).toBeGreaterThan(0);
    expect(c.isrctnBaseUrl.length).toBeGreaterThan(0);
    expect(c.crisBaseUrl.length).toBeGreaterThan(0);
  });
});
