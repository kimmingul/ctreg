import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import { run } from '../../src/cli/index.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-run-')), CTREG_RATE_PER_SEC: '1000' });

const stubFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('run()', () => {
  it('registries 는 네트워크 없이 capability 를 낸다', async () => {
    const c = capture();
    const f = stubFetch({});
    const code = await run(['registries'], c.io, env(), { http: { fetchImpl: f as unknown as typeof fetch } });
    expect(code).toBe(EXIT.OK);
    expect(f).not.toHaveBeenCalled();
    const parsed = JSON.parse(c.out());
    expect(parsed.data[0].key).toBe('ctgov');
    expect(parsed.data[0].search.geoNeedsCoords).toBe(true);
  });

  it('count 는 개수만 낸다', async () => {
    const c = capture();
    const f = stubFetch({ totalCount: 412 });
    const code = await run(['count', '--condition', 'NSCLC'], c.io, env(), {
      http: { fetchImpl: f as unknown as typeof fetch, sleep: async () => {} },
    });
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(c.out()).data).toEqual({ total: 412 });
  });

  it('모르는 커맨드는 exit 2 이고 사용법은 stderr 로 간다', async () => {
    const c = capture();
    const code = await run(['landscape'], c.io, env());
    expect(code).toBe(EXIT.USAGE);
    expect(c.err()).toContain('search');
    expect(c.out()).toBe('');
  });

  it('오류도 봉투 모양으로 stdout 에 나가고 힌트를 담는다', async () => {
    const c = capture();
    const code = await run(['search', '--radius', '100km'], c.io, env());
    expect(code).toBe(EXIT.USAGE);
    const parsed = JSON.parse(c.out());
    expect(parsed.error.code).toBe('usage');
    expect(parsed.error.hint).toContain('--near');
  });

  it('--help 는 exit 0 이고 사용법을 stdout 에 낸다', async () => {
    const c = capture();
    expect(await run(['--help'], c.io, env())).toBe(EXIT.OK);
    expect(c.out()).toContain('ctreg search');
  });

  it('로그는 stdout 을 오염시키지 않는다 — stdout 은 항상 파싱 가능해야 한다', async () => {
    const c = capture();
    await run(['registries'], c.io, env());
    expect(() => JSON.parse(c.out())).not.toThrow();
  });
});
