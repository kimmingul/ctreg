import { describe, expect, it, vi } from 'vitest';
import { kctisToolsFrom, type KctisClientLike } from '../../src/mcp/kctis-tools.js';

/**
 * kctis MCP 를 에이전트의 도구로. 사용자 결정(2026-09-15): 국내(CRIS·식약처)와 ClinicalTrials.gov 의 대규모
 * 집계는 KCTIS 의 읽기 전용 SQL 도구(kctis MCP: kctis 뷰 + AACT)로, ctreg 도구는 ISRCTN·CTIS 등 나머지로.
 * 도구 정의는 **kctis 서버가 내는 것을 그대로**(이름·설명·스키마) — 손으로 다시 적으면 둘이 갈린다.
 * 이름에 `kctis_` 를 붙여 ctreg 도구와 구별하고, 실행은 MCP 클라이언트로 넘긴다.
 */
const fake: KctisClientLike = {
  listTools: vi.fn(async () => ({ tools: [
    { name: 'describe_schema', description: '스키마', inputSchema: { type: 'object', properties: { source: { type: 'string', enum: ['kctis', 'aact'] } }, required: ['source'] } },
    { name: 'query_sql', description: 'SQL', inputSchema: { type: 'object', properties: { source: { type: 'string' }, sql: { type: 'string' } }, required: ['source', 'sql'] } },
  ] })),
  callTool: vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => ({
    content: [{ type: 'text', text: JSON.stringify(name === 'query_sql' ? { columns: ['n'], rows: [{ n: 43 }], row_count: 1, truncated: false, elapsed_ms: 3, source_note: `CRIS 사본 · ${args.source}` } : '# 스키마') }],
  })),
};

describe('kctis 도구', () => {
  it('서버의 도구 정의를 그대로 가져오되 이름에 kctis_ 를 붙인다', async () => {
    const t = await kctisToolsFrom(fake);
    expect(t.tools.map((x) => x.function.name)).toEqual(['kctis_describe_schema', 'kctis_query_sql']);
    expect(t.tools[1]!.function.parameters).toMatchObject({ type: 'object', required: ['source', 'sql'] });
    expect(t.tools[0]!.function.description).toContain('스키마');
  });
  it('실행은 MCP 로 — 접두사를 떼고 부르고, 결과 JSON 을 그대로 돌려준다', async () => {
    const t = await kctisToolsFrom(fake);
    const r = await t.call('kctis_query_sql', { source: 'kctis', sql: 'SELECT 1' });
    expect(fake.callTool).toHaveBeenCalledWith({ name: 'query_sql', arguments: { source: 'kctis', sql: 'SELECT 1' } });
    expect(r).toMatchObject({ rows: [{ n: 43 }], source_note: expect.stringContaining('CRIS') });
  });
  it('모르는 도구는 거부한다', async () => {
    const t = await kctisToolsFrom(fake);
    await expect(t.call('kctis_drop_everything', {})).rejects.toThrow(/없는 도구/);
  });
  it('isError 응답은 error 로 돌려준다 — 조용히 빈 결과가 되지 않는다', async () => {
    const c: KctisClientLike = { ...fake, callTool: vi.fn(async () => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: '읽기 전용이다' }) }] })) };
    const t = await kctisToolsFrom(c);
    const r = await t.call('kctis_query_sql', { source: 'kctis', sql: 'DELETE' });
    expect(r).toMatchObject({ error: expect.stringContaining('읽기 전용') });
  });
});
