import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/cli/args.js';
import { TOOL_NAME } from '../../src/mcp/server.js';

/**
 * HTTP 진입점은 **네 번째 껍데기** 다(bin · 플러그인 스킬 · stdio MCP · HTTP MCP).
 * 코어는 여전히 하나이고, 여기서 검사하는 것은 껍데기가 지켜야 할 것 셋이다 —
 * 실제 포트에서 프로토콜이 도는가, 종료 코드 계약이 HTTP 를 건너 살아남는가,
 * 진입점이 설정 파일을 읽는가(stdio 에서 두 번 겪은 구멍).
 *
 * stdio 테스트와 같은 이유로 **자식 프로세스** 로 띄운다 — 진입점은 프로세스 경계라
 * 단위 테스트가 닿지 않는다.
 */
describe('ctreg-mcp-http 진입점 (실제 프로세스·실제 포트)', () => {
  let child: ChildProcess;
  let base = '';
  const xdg = mkdtempSync(join(tmpdir(), 'ctreg-http-xdg-'));

  beforeAll(async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(xdg, 'ctreg'), { recursive: true });
    writeFileSync(join(xdg, 'ctreg', '.env'), 'CTREG_CRIS_SERVICE_KEY=dummy-from-user-config\n');

    child = spawn(process.execPath, [join(__dirname, '../../dist/mcp/http.js')], {
      env: {
        ...process.env,
        CTREG_CRIS_SERVICE_KEY: undefined as unknown as string,
        XDG_CONFIG_HOME: xdg,
        CTREG_MCP_PORT: '0', // OS 가 빈 포트를 고른다 — 병렬 테스트와 충돌하지 않는다
        CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-http-')),
        CTREG_RATE_PER_SEC: '1000',
      },
      // cwd 를 저장소 밖으로 — 안 그러면 진입점이 저장소의 `./.env`(실제 키)를 읽어 테스트가
      // 실제 키로 남의 서버(Ollama)를 친다. 2026-09-11 에 /api/usage 가 501 대신 200 을 내며 드러났다.
      cwd: mkdtempSync(join(tmpdir(), 'ctreg-http-cwd-')),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 진입점은 뜨자마자 stderr 로 "listening <url>" 한 줄을 낸다 — 테스트가 포트를 알 유일한 길이다.
    base = await new Promise<string>((resolve, reject) => {
      let buf = '';
      child.stderr!.on('data', (d: Buffer) => {
        buf += d.toString();
        // 서버가 내는 줄에 /mcp 까지 들어 있다 — 여기 또 붙이면 /mcp/mcp 가 된다(실제로 그랬다).
        const m = /listening (http:\/\/\S+\/mcp)/.exec(buf);
        if (m) resolve(m[1]!);
      });
      child.on('exit', (c) => reject(new Error(`서버가 먼저 죽었다 (exit ${c}): ${buf}`)));
      setTimeout(() => reject(new Error(`listening 을 못 봤다: ${buf}`)), 15_000);
    });
  }, 30_000);

  afterAll(() => { child?.kill(); });

  const rpc = async (body: object, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // SSE 로 오면 data: 줄에서 JSON 을 꺼낸다. JSON 응답 모드면 그대로다.
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return { status: res.status, json: JSON.parse(line ? line.slice(5) : text) };
  };
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

  it('initialize 에 서버 정보로 답한다', async () => {
    const r = await rpc(init);
    expect(r.status).toBe(200);
    expect((r.json as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('ctreg');
  });

  it('도구 다섯을 광고한다', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (r.json as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
    expect(tools).toEqual(COMMANDS.map((c) => TOOL_NAME[c]).sort());
  });

  /** 종료 코드 계약이 HTTP 를 건너 살아남는가 — exit 3 은 오류가 아니다. */
  it('exit 3 을 본문에 싣고 isError 로 내지 않는다', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: TOOL_NAME.search, arguments: { registry: ['ctis'], condition: 'x', phase: ['phase_3'] } } });
    const result = (r.json as { result: { isError?: boolean; content: { text: string }[] } }).result;
    expect(result.isError).toBeFalsy();
    expect((JSON.parse(result.content[0]!.text) as { exitCode: number }).exitCode).toBe(3);
  }, 30_000);

  /** 진입점이 loadEnvFiles 를 부르는가 — stdio 에서 두 번 겪은 구멍. */
  it('사용자 설정 파일의 키를 읽는다', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: TOOL_NAME.count, arguments: { registry: ['cris'], term: 'x', 'no-cache': true } } });
    const result = (r.json as { result: { content: { text: string }[] } }).result;
    const body = JSON.parse(result.content[0]!.text) as { envelope: { registries: { error?: { message: string } }[] } };
    expect(body.envelope.registries[0]!.error?.message ?? '').not.toContain('인증키가 없습니다');
  }, 30_000);

  /**
   * **통계는 부르는 자리에서 쌓인다.** 모듈 자체는 단위 테스트가 덮지만, `callTool` 이
   * 실제로 `record` 를 부르는지는 여기서만 안다 — 위의 도구 호출들이 쌓였는지 본다.
   * 호출 순서에 기대지 않으려고 "0 보다 크다" 만 본다.
   */
  it('/stats 가 지금까지의 호출을 집계한다', async () => {
    const res = await fetch(new URL('/stats', base));
    expect(res.status).toBe(200);
    const a = (await res.json()) as { total: number; byTool: Record<string, number>; byExit: Record<string, number> };
    expect(a.total).toBeGreaterThan(0);
    expect(a.byTool.search).toBeGreaterThan(0);
    expect(a.byExit['3']).toBeGreaterThan(0); // 위 exit 3 테스트가 남긴 것
  });

  it('/stats 가 무엇이 도는지 말한다 — version 과 build', async () => {
    const a = (await (await fetch(new URL('/stats', base))).json()) as { version: string; build: string | null };
    expect(a.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(a).toHaveProperty('build');   // 배포 스크립트가 git 커밋을 싣는다; 로컬은 null
  });

  it('/stats 는 검색어를 담지 않는다', async () => {
    const text = await (await fetch(new URL('/stats', base))).text();
    expect(text).not.toContain('phase_3');
    expect(text).not.toContain('melanoma');
  });

  /**
   * **웹 API 는 MCP 와 같은 코어를 감싼다.** `/api/<커맨드>` 가 `callTool` 과 같은 봉투를 낸다 —
   * 페이지가 MCP 클라이언트가 아니라서 JSON-RPC 대신 평범한 POST 를 쓸 뿐이다. 같은 프로세스
   * 안이라 요청률 버킷도 공유한다: 웹 검색과 MCP 호출이 합쳐서 1 req/s 를 지킨다.
   */
  it('/api/<커맨드> 가 MCP 와 같은 봉투를 낸다 — exitCode 포함', async () => {
    const res = await fetch(new URL('/api/registries', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exitCode: number; envelope: { registries: unknown[] } };
    expect(body.exitCode).toBe(0);
    expect(body.envelope.registries).toHaveLength(5);
  });

  /** exit 3 이 HTTP 오류로 둔갑하면 안 된다 — 요청은 옳았고 레지스트리가 그렇게 못 물을 뿐이다. */
  it('/api 의 exit 3 은 HTTP 200 에 exitCode 3 이다', async () => {
    const res = await fetch(new URL('/api/search', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registry: ['ctis'], condition: 'x', phase: ['phase_3'] }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { exitCode: number }).exitCode).toBe(3);
  }, 30_000);

  /** 사용법 오류는 400 이다 — 페이지가 고쳐야 할 입력이다. */
  it('/api 의 exit 2 는 HTTP 400 이다', async () => {
    const res = await fetch(new URL('/api/search', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 'page-size': -1 }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { exitCode: number }).exitCode).toBe(2);
  });

  it('/api/<모르는 커맨드> 는 404 다', async () => {
    const res = await fetch(new URL('/api/nope', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(404);
  });

  /**
   * **페이지의 고급 검색 칸은 손으로 안 적는다.** `/api/schema` 가 OPTION_HELP 를 그대로
   * 낸다 — MCP 스키마와 --help 가 읽는 그 표다. 옵션이 늘면 페이지가 따라온다.
   */
  /** 에이전트 라우트 — SSE. 키 없는 서버는 501 (라우트가 묶여 있어야 이 답이 나온다). */
  it('/api/agent — 키 없는 서버는 501', async () => {
    const res = await fetch(new URL('/api/agent', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: '김민걸' }) });
    expect(res.status).toBe(501);
  });

  it('/api/usage — 키 없는 서버는 501 (라우트가 묶여 있어야 이 답이 나온다)', async () => {
    const res = await fetch(new URL('/api/usage', base));
    expect(res.status).toBe(501);
  });

  it('/api/schema 가 커맨드별 옵션과 설명을 낸다', async () => {
    const res = await fetch(new URL('/api/schema', base));
    expect(res.status).toBe(200);
    const schema = (await res.json()) as { commands: Record<string, { options: { name: string; help: string; type: string; multiple: boolean; values?: string[] }[]; summary: string }>; toolName: Record<string, string> };
    expect(Object.keys(schema.commands).sort()).toEqual([...COMMANDS].sort());
    const cond = schema.commands.search!.options.find((o) => o.name === 'condition');
    expect(cond?.help).toBeTruthy();
    const phase = schema.commands.search!.options.find((o) => o.name === 'phase');
    expect(phase?.values).toContain('phase_3');
    expect(phase?.multiple).toBe(true);
  });

  /** 루트는 이제 검색 페이지다 — 404 가 아니다. */
  it('/ 가 검색 페이지를 낸다', async () => {
    const res = await fetch(new URL('/', base));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('적격 판정이 아니다');   // 면책이 페이지에 보인다
    expect(html).toContain('/api/schema');          // 칸을 스키마에서 그린다
  });

  /**
   * **names 는 한 번에 하나만.** CRIS 후보를 하나씩 여는 데 1~3분이 걸리고, 그동안 요청률
   * 버킷(1 req/s)을 혼자 쓴다. 둘이 동시에 오면 둘 다 두 배로 늦어지고 다른 도구까지 막힌다.
   * 두 번째 요청은 기다리지 않고 429 로 바로 돌려보낸다 — 페이지가 "지금 다른 대조가 진행
   * 중" 을 보여줄 수 있게. 검사는 첫 요청을 붙들어 둔 채 두 번째를 쏘는 것으로 한다 —
   * 실제 CRIS 를 부르면 느리고 키가 필요하니 존재하지 않는 term 으로 exit 를 빨리 받는다.
   */
  it('/api/names 는 동시에 하나만 받는다 — 두 번째는 429', async () => {
    const call = () => fetch(new URL('/api/names', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ korean_name: '홍길동', term: 'zzz-nope' }) });
    const [a, b] = await Promise.all([call(), call()]);
    const codes = [a.status, b.status].sort();
    // 하나는 통과(200 이든 키 없어 4xx 가 아닌 봉투든), 하나는 429.
    expect(codes).toContain(429);
    expect(codes.filter((c) => c === 429)).toHaveLength(1);
  }, 60_000);

  it('/mcp · /stats · /api · / 밖은 404 다', async () => {
    const res = await fetch(new URL('/nope', base));
    expect(res.status).toBe(404);
  });
});
