import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { agent, agentTools, systemPromptForAgent, type AgentEvent } from '../../src/mcp/agent.js';

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-agent-')), CTREG_RATE_PER_SEC: '1000', CTREG_LLM_API_KEY: 'k', CTREG_LLM_BASE_URL: 'https://llm.example/v1', CTREG_LLM_MODEL: 'm' });

type Msg = { role?: string; content?: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] };
const reply = (m: Msg, finish = m.tool_calls ? 'tool_calls' : 'stop') =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { role: 'assistant', content: m.content ?? null, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const tc = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });

/** callTool 흉내 — 무엇을 어떤 순서·동시성으로 불렀는지 남긴다. */
function fakeTools(handler: (cmd: string, args: Record<string, unknown>) => unknown) {
  const calls: { cmd: string; args: Record<string, unknown>; at: number }[] = [];
  let inflight = 0; let maxInflight = 0;
  const call = async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args, at: Date.now() });
    inflight += 1; maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 20));
    inflight -= 1;
    return { content: [], structuredContent: handler(cmd, args) as Record<string, unknown> };
  };
  return { call: call as unknown as Parameters<typeof agent>[0]['call'], calls, max: () => maxInflight };
}
const ok = (registry: string, data: unknown, total = Array.isArray(data) ? data.length : 0) => ({ exitCode: 0, exit: 'ok', envelope: { registries: [{ registry, status: 'ok', total }], warnings: [], data } });

/**
 * 에이전트 루프 — **Claude Code 가 MCP 로 하는 그대로.** 모델에게 MCP 와 같은 도구 여섯을 주고
 * "생각 → 도구 호출 → 결과 읽기 → 반복 → 답" 을 모델이 돌린다. 분류기와 손으로 짠 절차(ask.ts 의
 * nameOnly·문장 패턴)는 사고를 냈다 — 모델이 절차를 스스로 조립하게 둔다. 지침은 플러그인 SKILL.md
 * 그대로다: 같은 문서로 같은 규율.
 */
describe('에이전트 루프', () => {
  it('도구 호출을 실행해 결과를 돌려주고, 모델이 답을 내면 끝난다 — 레코드는 근거로 모인다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('c1', 'resolve_korean_investigator_name', { korean_name: '김민걸' })] }))
      .mockResolvedValueOnce(reply({ tool_calls: [tc('c2', 'search_trials_multi_registry', { registry: ['ctgov'], investigator: 'Min-Gul Kim' })] }))
      .mockResolvedValueOnce(reply({ content: '김민걸 교수는 ctgov 에 2건 [CTGOV:A][CTGOV:B].' }));
    const t = fakeTools((cmd) => cmd === 'names'
      ? ok('cris', { korean: '김민걸', crisMatched: 2, variants: [{ name: 'Min-Gul Kim', crisTrials: 2 }] })
      : ok('ctgov', [{ id: 'CTGOV:A', title: 'a' }, { id: 'CTGOV:B', title: 'b' }]));
    const events: AgentEvent[] = [];
    const r = await agent({ q: '김민걸 교수 연구', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: (e) => events.push(e) });
    expect(r.answer).toMatch(/2건/);
    expect(t.calls.map((c) => c.cmd)).toEqual(['names', 'search']);
    expect(r.records.map((x) => x.id)).toEqual(['CTGOV:A', 'CTGOV:B']);
    expect(r.steps).toHaveLength(2);
    // 진행 이벤트 — 페이지가 실시간으로 그린다
    expect(events.map((e) => e.type)).toEqual(['call', 'result', 'call', 'result', 'final']);
    // 도구 결과가 모델에게 tool 메시지로 돌아갔다
    const last = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string) as { messages: { role: string; tool_call_id?: string; content?: string }[]; tools: unknown[] };
    expect(last.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1', 'c2']);
    expect(last.messages.find((m) => m.tool_call_id === 'c1')?.content).toContain('Min-Gul Kim');
    expect(last.tools).toHaveLength(6);
  });

  it('한 턴의 도구 호출 여럿은 동시에 돈다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('a', 'count_trials', { registry: ['ctgov'], condition: 'x' }), tc('b', 'count_trials', { registry: ['cris'], term: 'x' }), tc('c', 'list_registries_and_capabilities', {})] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools((cmd) => (cmd === 'count' ? ok('ctgov', { total: 1 }, 1) : ok('ctgov', [])));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(t.calls).toHaveLength(3);
    expect(t.max()).toBe(3);
  });

  it('모델이 낸 인자를 정규화하고 거른다 — 대문자 레지스트리, 모르는 키, 모르는 도구', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('a', 'count_trials', { registry: ['CRIS', 'CTGov'], condition: 'x', evil: 1 }), tc('b', 'delete_everything', {})] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ok('cris', { total: 0 }));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.args).toEqual({ registry: ['cris', 'ctgov'], condition: 'x' });
    // 모르는 도구는 실행하지 않고 모델에게 그렇다고 돌려준다
    const second = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: { role: string; tool_call_id?: string; content?: string }[] };
    expect(second.messages.find((m) => m.tool_call_id === 'b')?.content).toMatch(/없는 도구|unknown/i);
  });

  it('스텝 상한에 닿으면 멈추고 그때까지의 결과로 답하게 한다 — 조용히 무한히 돌지 않는다', async () => {
    // 도구를 주는 동안은 늘 도구를 부르고, 도구를 빼면(상한) 답을 낸다
    const f = vi.fn(async (_u: string, init: RequestInit) => (JSON.parse(init.body as string) as { tools?: unknown }).tools
      ? reply({ tool_calls: [tc('z', 'count_trials', { registry: ['ctgov'], condition: 'x' })] })
      : reply({ content: '상한까지 본 것: 3건' }));
    const t = fakeTools(() => ok('ctgov', { total: 1 }, 1));
    const r = await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {}, maxSteps: 3 });
    expect(t.calls).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.answer).toMatch(/상한/);
    const last = JSON.parse((f.mock.calls.at(-1)![1] as RequestInit).body as string) as { tools?: unknown; messages: { role: string; content?: string }[] };
    expect(last.tools).toBeUndefined();   // 마지막 호출은 도구 없이
    expect(last.messages.at(-1)?.content).toMatch(/상한/);
  });

  it('도구 실패(exit 2·3·4)는 모델에게 그대로 돌아간다 — 0건으로 둔갑하지 않는다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('a', 'search_trials_multi_registry', { registry: ['ctis'], investigator: 'x' })] }))
      .mockResolvedValueOnce(reply({ content: 'CTIS 는 그렇게 물어볼 수 없다.' }));
    const t = fakeTools(() => ({ exitCode: 3, exit: 'unsupported', envelope: { registries: [{ registry: 'ctis', status: 'unsupported', error: { message: "EU CTIS: 'investigator' 검색을 지원하지 않습니다" } }], warnings: [], data: [] } }));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    const second = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: { role: string; content?: string }[] };
    expect(second.messages.find((m) => m.role === 'tool')?.content).toMatch(/unsupported|지원하지 않습니다/);
  });

  it('도구 정의는 MCP 와 같은 여섯이고, 지침은 플러그인 SKILL.md 에서 온다', () => {
    const tools = agentTools();
    expect(tools.map((t) => t.function.name).sort()).toEqual(['count_trials', 'get_trial_by_id', 'get_trial_results', 'list_registries_and_capabilities', 'resolve_korean_investigator_name', 'search_trials_multi_registry']);
    expect(tools.find((t) => t.function.name === 'count_trials')!.function.parameters).toMatchObject({ type: 'object' });
    const p = systemPromptForAgent();
    expect(p).toMatch(/경고를 반드시 읽어라/);
    expect(p).toMatch(/추측했다고 답에 밝혀라/);
    expect(p).toMatch(/범주별 건수를 더하지 마라/);
  });

  it('LLM 이 죽으면 그때까지의 스텝과 함께 오류를 낸다', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const t = fakeTools(() => ok('ctgov', []));
    const r = await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(r.error).toMatch(/500/);
    expect(r.answer).toBeUndefined();
  });
});
