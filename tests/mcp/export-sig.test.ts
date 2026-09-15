import { describe, expect, it } from 'vitest';
import { exportSig, verifyExportSig } from '../../src/mcp/export-sig.js';

/** 내보내기 서명 — source|sql 에 대한 HMAC. 비밀은 KCTIS 토큰에서 파생(재배포해도 같다). 서명 없이는 임의 SQL 을 프록시로 못 보낸다. */
describe('exportSig', () => {
  const env = { KCTIS_MCP_TOKEN: 'secret' };
  it('같은 입력은 같은 서명, 다른 SQL·소스는 다른 서명', () => {
    const a = exportSig('kctis', 'SELECT 1', env);
    expect(exportSig('kctis', 'SELECT 1', env)).toBe(a);
    expect(exportSig('aact', 'SELECT 1', env)).not.toBe(a);
    expect(exportSig('kctis', 'SELECT 2', env)).not.toBe(a);
  });
  it('검증 — 맞으면 true, 한 글자만 달라도 false, 토큰이 없으면 false', () => {
    const sig = exportSig('kctis', 'SELECT 1', env);
    expect(verifyExportSig('kctis', 'SELECT 1', sig, env)).toBe(true);
    expect(verifyExportSig('kctis', 'SELECT 1 ', sig, env)).toBe(false);
    expect(verifyExportSig('kctis', 'SELECT 1', sig.slice(0, -1) + '0', env)).toBe(false);
    expect(verifyExportSig('kctis', 'SELECT 1', sig, {})).toBe(false);
  });
});
