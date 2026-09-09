#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnvFiles } from '../runtime/config.js';
import { createServer } from './server.js';

/**
 * MCP 진입점. `bin.ts` 와 같은 규칙이다 — **프로세스 경계에는 부르는 줄만 남긴다.**
 * 설정 파일 읽기와 서버 조립은 각각 테스트가 닿는 모듈에 있다.
 *
 * stdio 전송이므로 **stdout 은 프로토콜 채널이다.** 여기서 `console.log` 를 하면
 * JSON-RPC 스트림이 깨진다. 진단은 stderr 로만 낸다.
 */
loadEnvFiles();

const server = createServer();
await server.connect(new StdioServerTransport());
