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

  it('/stats 는 검색어를 담지 않는다', async () => {
    const text = await (await fetch(new URL('/stats', base))).text();
    expect(text).not.toContain('phase_3');
    expect(text).not.toContain('melanoma');
  });

  it('/mcp 밖은 404 다 — 서버가 다른 것을 서빙하지 않는다', async () => {
    const res = await fetch(new URL('/', base));
    expect(res.status).toBe(404);
  });
});
