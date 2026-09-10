#!/usr/bin/env node
import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadEnvFiles } from '../runtime/config.js';
import { createServer } from './server.js';

/**
 * HTTP 진입점 — **네 번째 껍데기** 다(bin · 플러그인 스킬 · stdio MCP · 이것). 코어는
 * 여전히 `run()` 하나이고, 이 파일은 요청을 받아 그것을 부를 뿐이다.
 *
 * **stateless 다** (`sessionIdGenerator: undefined`). 공개 서버는 요청마다 독립이어야
 * 여러 대로 늘려도 되고 세션 저장소가 필요 없다. 그래서 **요청마다 서버·전송을 새로
 * 만든다** — MCP 서버 객체는 전송 하나에만 붙을 수 있어서, 재사용하면 두 번째 요청이
 * "already connected" 로 죽는다. 만드는 비용은 도구 다섯 등록뿐이라 무시할 만하다.
 *
 * **`/mcp` 하나만 서빙한다.** 나머지는 404 다 — 이 프로세스가 다른 것을 내주는 것처럼
 * 보이면 안 된다.
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

const port = Number(process.env.CTREG_MCP_PORT ?? '3000');
const host = process.env.CTREG_MCP_HOST ?? '127.0.0.1';

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
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
