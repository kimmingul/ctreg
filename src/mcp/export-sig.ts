import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 내보내기 서명 — `/api/export` 는 **에이전트가 실제로 돌린 SQL 만** 받는다. 보안 리뷰(2026-09-16)가 짚은 대로,
 * 서명이 없으면 누구나 임의 SQL 을 프록시로 KCTIS/AACT 에 보내 2만 행씩 뽑을 수 있었다. 에이전트가 표를 낼 때
 * `source|sql` 의 HMAC 을 붙이고, 페이지가 그것을 함께 보낸다. 비밀은 KCTIS 토큰에서 파생한다 — 재배포해도
 * 같아서 배포 직전에 받은 표도 내려받을 수 있다. 토큰이 없으면 서명도 검증도 안 된다(내보내기 자체가 없다).
 */
export function exportSig(source: string, sql: string, env: NodeJS.ProcessEnv = process.env): string {
  const token = env.KCTIS_MCP_TOKEN ?? '';
  return createHmac('sha256', `ctreg-export:${token}`).update(`${source}\n${sql}`).digest('hex');
}

export function verifyExportSig(source: string, sql: string, sig: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.KCTIS_MCP_TOKEN || typeof sig !== 'string') return false;
  const want = Buffer.from(exportSig(source, sql, env), 'hex');
  const got = Buffer.from(sig, 'hex');
  return want.length === got.length && got.length > 0 && timingSafeEqual(want, got);
}
