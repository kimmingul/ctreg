#!/usr/bin/env node
import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, loadEnvFiles } from '../runtime/config.js';
import { aggregate, readAll, record } from './stats.js';
import { usage } from './usage.js';
import { agent } from './agent.js';
import { verifyExportSig } from './export-sig.js';
import { readVersion } from '../cli/version.js';
import { api, page, schema } from './web.js';
import { createServer } from './server.js';

/**
 * HTTP 진입점 — **네 번째 껍데기** 다(bin · 플러그인 스킬 · stdio MCP · 이것). 코어는
 * 여전히 `run()` 하나이고, 이 파일은 요청을 받아 그것을 부를 뿐이다.
 *
 * **stateless 다** (`sessionIdGenerator: undefined`). 공개 서버는 요청마다 독립이어야
 * 여러 대로 늘려도 되고 세션 저장소가 필요 없다. **요청마다 서버·전송을 새로 만든다** —
 * 격리를 위해서다. 만드는 비용은 도구 다섯 등록뿐이라 무시할 만하다.
 *
 * (처음에는 "재사용하면 두 번째 요청이 죽는다" 고 적었는데 **틀렸다** — 사보타주로 재사용해
 * 보니 세 요청 다 200 이었다. 응답이 끝날 때 `close()` 가 전송을 떼므로 다음 `connect` 가
 * 된다. 새로 만드는 이유는 죽어서가 아니라 요청 사이에 아무것도 공유하지 않기 위해서다.
 * 검증 안 한 근거를 적으면 다음 사람이 없는 제약을 지키느라 시간을 쓴다.)
 *
 * **`/`(검색 페이지) · `/api/*` · `/mcp` · `/stats` 를 서빙한다.** 나머지는 404 다.
 *
 * **이 서버가 하지 않는 것**(README 의 「공개 서버」 절이 정본이다):
 * - 인증 — URL 을 아는 누구나 쓴다. 앞단(리버스 프록시)에서 걸어야 한다.
 * - 사용자별 요청률 — 요청률 버킷은 **이 프로세스 전체** 가 나눠 쓴다. 레지스트리에 대한
 *   예의는 "서버 한 대 = 클라이언트 하나" 로 잡혀 있고, 그것은 이 서버를 공개하기 전에
 *   각 레지스트리의 정책으로 다시 봐야 한다.
 * - CRIS 키의 상업적 이용 — 공공누리 제2유형이라 **비영리에서만** 쓸 수 있다.
 *
 * `bin.ts` 와 같은 규칙: 프로세스 경계에는 부르는 줄만 남긴다. 이 파일은 자식 프로세스로
 * 띄워 실제 포트로 검사한다(`tests/mcp/http.test.ts`).
 */
loadEnvFiles();

/**
 * 내보내기 상한 — IP 당 분당 5회, 동시 2건. 메모리 창(인스턴스 하나 전제). 맵은 분마다 비운다(무한히 자라지 않게).
 * 클라이언트 IP 는 Fly 뒤에서만 `fly-client-ip`(프록시가 덮어쓴다)를 믿고, 아니면 소켓 주소 — 헤더는 위조된다.
 */
const exportHits = new Map<string, number[]>();
let exportInFlight = 0;
const EXPORT_CONCURRENCY = 2;
const EXPORT_BODY_MAX = 64_000;
setInterval(() => { const now = Date.now(); for (const [ip, hits] of exportHits) { const live = hits.filter((t) => now - t < 60_000); if (live.length) exportHits.set(ip, live); else exportHits.delete(ip); } }, 60_000).unref();
function exportAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (exportHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 5) { exportHits.set(ip, hits); return false; }
  hits.push(now); exportHits.set(ip, hits); return true;
}
function clientIp(req: import('node:http').IncomingMessage): string {
  const fly = process.env.FLY_APP_NAME ? req.headers['fly-client-ip'] : undefined;
  return String((Array.isArray(fly) ? fly[0] : fly) ?? req.socket.remoteAddress ?? '?');
}

const port = Number(process.env.CTREG_MCP_PORT ?? '3000');
const host = process.env.CTREG_MCP_HOST ?? '127.0.0.1';

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // 검색 페이지와 그 API — web.ts 가 정본이다. 여기는 라우팅뿐이다.
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
    return;
  }
  /**
   * 에이전트 — Claude Code 가 MCP 로 하는 그대로를 서버가 돈다. 진행을 SSE 로 흘린다: 페이지가
   * 도구 호출 하나하나를 실시간으로 그리고(오래 걸리는 질의가 죽은 것처럼 보이지 않게), 마지막
   * `final` 에 답·스텝·근거 레코드가 실린다. 키가 없으면 501.
   */
  if (url.pathname === '/api/agent' && req.method === 'POST') {
    if (!loadConfig().llmApiKey) {
      res.writeHead(501, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'ai_mode_off', message: 'AI 모드가 아직 켜져 있지 않다 — 서버에 LLM 키가 없다.' }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let q = '';
    try { q = String((JSON.parse(raw || '{}') as { q?: unknown }).q ?? '').trim(); } catch { /* 아래 400 */ }
    if (q === '') { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'empty' })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (type: string, data: unknown) => { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
    const keepalive = setInterval(() => res.write(': ping\n\n'), 15_000);   // 프록시가 놀고 있는 연결을 끊지 않게
    const started = Date.now();
    try {
      const r = await agent({ q, onEvent: (e) => { if (e.type !== 'final') send(e.type, e); } });
      record(loadConfig().cacheDir, { at: new Date().toISOString(), tool: 'agent', exitCode: r.error ? 4 : 0, ms: Date.now() - started, registries: [] });
      send('final', r);
    } catch (e) {
      send('error', { message: (e as Error).message });
    } finally {
      clearInterval(keepalive);
      res.end();
    }
    return;
  }
  /**
   * CSV 전체 내보내기 — 페이지가 표의 SQL 을 보내면 KCTIS 의 `/api/export` 로 넘겨 CSV 를 그대로 흘린다. kctis MCP 의
   * 200행 상한을 넘는 목록을 파일로 받는 길이다. 토큰은 여기(서버)에만 있다 — 페이지는 SQL 만 안다. 같은 읽기 전용
   * 게이트를 KCTIS 가 건다. 남용은 IP 당 분당 5회로 막는다.
   */
  if (url.pathname === '/api/export' && req.method === 'POST') {
    let raw = '';
    let tooBig = false;
    for await (const chunk of req) { raw += chunk; if (raw.length > EXPORT_BODY_MAX) { tooBig = true; break; } }
    if (tooBig) { res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'too_large' })); return; }
    let body: { source?: unknown; sql?: unknown; sig?: unknown };
    try { body = JSON.parse(raw) as { source?: unknown; sql?: unknown; sig?: unknown }; } catch { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'body must be JSON' })); return; }
    if (typeof body.sql !== 'string' || typeof body.source !== 'string') { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'source, sql required' })); return; }
    // 에이전트가 돌린 SQL 만 — 서명이 증표다. 없거나 틀리면 403: 이 프록시로 임의 SQL 을 보낼 수 없다.
    if (!verifyExportSig(body.source, body.sql, String(body.sig ?? ''))) { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'unsigned', message: '내보내기는 이 페이지의 결과 표에서만 된다.' })); return; }
    const base = process.env.KCTIS_MCP_URL;
    const token = process.env.KCTIS_MCP_TOKEN;
    if (!base || !token) { res.writeHead(501, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'no_kctis', message: '이 서버에는 KCTIS 가 붙어 있지 않다.' })); return; }
    if (!exportAllowed(clientIp(req))) { res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'rate', message: '내보내기는 분당 5회까지다. 잠시 뒤 다시.' })); return; }
    if (exportInFlight >= EXPORT_CONCURRENCY) { res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'busy', message: '내보내기가 진행 중이다. 잠시 뒤 다시.' })); return; }
    const target = new URL(base); target.pathname = target.pathname.replace(/\/api\/mcp\/?$/, '/api/export');
    exportInFlight += 1;
    try {
      const up = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ source: body.source, sql: body.sql }), signal: AbortSignal.timeout(60_000) });
      if (!up.ok || !up.body) { const text = await up.text(); res.writeHead(up.status === 400 ? 400 : 502, { 'content-type': 'application/json; charset=utf-8' }).end(text || JSON.stringify({ error: 'upstream' })); return; }
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': up.headers.get('content-disposition') ?? 'attachment; filename="export.csv"' });
      for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      res.end();
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'upstream', message: (e as Error).message }));
    } finally {
      exportInFlight -= 1;
    }
    return;
  }
  if (url.pathname === '/api/usage' && req.method === 'GET') {
    const r = await usage();
    res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(r.body));
    return;
  }
  if (url.pathname === '/api/schema' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(schema()));
    return;
  }
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { status, body } = await api(url.pathname, raw);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    return;
  }
  if (url.pathname === '/stats') {
    // 개인정보가 없으므로 인증 없이 낸다 — 도구·레지스트리·종료코드·소요시간 집계뿐이다.
    // version 은 package.json, build 는 배포 스크립트가 실은 git 커밋 — 무엇이 도는지 밖에서 확인하는 자리.
    const body = JSON.stringify({ version: readVersion(), build: process.env.CTREG_BUILD ?? null, ...aggregate(readAll(loadConfig().cacheDir)) }, null, 2);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(`${body}\n`);
    return;
  }
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found\n');
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcp = createServer();
  // 응답이 끝나면 정리한다 — stateless 라 요청 하나의 수명이 곧 서버 객체의 수명이다.
  res.on('close', () => { void transport.close(); void mcp.close(); });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(port, host, () => {
  const addr = httpServer.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  // stdout 이 아니라 stderr 다 — 프로토콜 채널을 더럽히지 않는다. 테스트가 이 줄로 포트를 안다.
  process.stderr.write(`ctreg-mcp-http listening http://${host}:${actual}/mcp\n`);
});
