import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * kctis MCP 를 에이전트의 도구로 — 사용자 결정(2026-09-15): 국내(CRIS·식약처)와 ClinicalTrials.gov 의 대규모
 * 집계는 KCTIS 의 읽기 전용 SQL 도구(kctis 뷰 + AACT)로, ctreg 도구는 ISRCTN·CTIS 등 나머지로.
 *
 * 도구 정의는 **kctis 서버가 내는 것을 그대로** 가져온다(이름·설명·입력 스키마) — 손으로 다시 적으면 둘이
 * 갈린다. 이름에 `kctis_` 를 붙여 ctreg 도구와 구별하고, 실행은 MCP 클라이언트로 넘긴다. 자격은
 * KCTIS_MCP_URL·KCTIS_MCP_TOKEN — 로그·응답에 내지 않는다.
 */
export type OpenAiTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type KctisTools = {
  tools: OpenAiTool[];
  call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
};
/** SDK Client 의 우리가 쓰는 부분 — 테스트가 흉내내기 쉽게. */
export type KctisClientLike = {
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[] }>;
  callTool(p: { name: string; arguments: Record<string, unknown> }): Promise<{ content?: unknown; isError?: boolean }>;
};

export const KCTIS_PREFIX = 'kctis_';

export async function kctisToolsFrom(client: KctisClientLike): Promise<KctisTools> {
  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  return {
    tools: tools.map((t) => ({
      type: 'function' as const,
      function: { name: KCTIS_PREFIX + t.name, description: t.description ?? '', parameters: t.inputSchema },
    })),
    async call(name, args) {
      const bare = name.startsWith(KCTIS_PREFIX) ? name.slice(KCTIS_PREFIX.length) : name;
      if (!names.has(bare)) throw new Error(`없는 도구다: ${name}. kctis 도구: ${[...names].map((n) => KCTIS_PREFIX + n).join(', ')}`);
      const r = await client.callTool({ name: bare, arguments: args });
      const text = (Array.isArray(r.content) ? (r.content as { type?: string; text?: string }[]).find((c) => c.type === 'text')?.text : undefined) ?? '';
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = { text }; }
      const obj = (parsed !== null && typeof parsed === 'object' ? parsed : { text: String(parsed) }) as Record<string, unknown>;
      if (r.isError && !obj.error) obj.error = text || 'kctis 도구가 오류를 냈다.';
      return obj;
    },
  };
}

let cached: { key: string; at: number; tools: KctisTools } | undefined;

/** 설정이 있으면 kctis 에 붙어 도구 묶음을 낸다. 없으면 undefined — 에이전트는 ctreg 도구만으로 돈다. 5분 캐시. */
export async function connectKctis(env: NodeJS.ProcessEnv = process.env): Promise<KctisTools | undefined> {
  const url = env.KCTIS_MCP_URL;
  const token = env.KCTIS_MCP_TOKEN;
  if (!url || !token) return undefined;
  if (cached && cached.key === url && Date.now() - cached.at < 300_000) return cached.tools;
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'ctreg-agent', version: '0' });
  await client.connect(transport);
  const tools = await kctisToolsFrom(client as unknown as KctisClientLike);
  cached = { key: url, at: Date.now(), tools };
  return tools;
}
