import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { agent, agentTools, loadPlaybook, playbooks, systemPromptForAgent, type AgentEvent } from '../../src/mcp/agent.js';

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
    expect(last.tools).toHaveLength(8);   // MCP 일곱 + load_playbook
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

  it('names 의 term 이 이름 자체면 버린다 — 이름은 좁힐 말이 아니다 (실측: 0건이 됐다)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('a', 'resolve_korean_investigator_name', { korean_name: '김민걸', term: '김민걸', ctgov: true })] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ok('cris', { korean: '김민걸', crisMatched: 0, variants: [] }));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(t.calls[0]!.args).toEqual({ korean_name: '김민걸', ctgov: true });
  });

  it('CRIS 사본이 있으면 names 의 term 은 어떤 값이든 버린다 — 이름이 축이라 좁히면 잃기만 한다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('a', 'resolve_korean_investigator_name', { korean_name: '김민걸', term: '전북대학교병원' })] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ok('cris', { korean: '김민걸', crisMatched: 0, variants: [] }));
    await agent({ q: 'x', env: { ...env(), CTREG_CRIS_MIRROR_URL: 'https://kctis.example.test' }, fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(t.calls[0]!.args).toEqual({ korean_name: '김민걸' });
  });

  it('지침이 페이지의 역할을 말한다 — 레코드 나열은 페이지가, 답은 요약만; ISRCTN 본문 검색', () => {
    const p = systemPromptForAgent();
    expect(p).toMatch(/나열하지 마라|표로 나열/);
    // ISRCTN 본문검색 같은 시나리오 지식은 프롬프트가 아니라 플레이북에 산다
    expect(loadPlaybook('investigator-korean')!.body).toMatch(/ISRCTN[^\n]*본문/);
  });

  /**
   * **상한은 턴(모델 호출)으로 센다, 도구 호출 수가 아니라.** 처음엔 도구 호출 10번이었고, 한 턴에 14개를
   * 동시에 부르면 3 → 17 로 넘어가 다음 턴에 잘렸다(실측 2026-09-12) — 병렬을 권하면서 병렬을 벌점으로
   * 센 것. 이제 턴 8 · 턴당 병렬 20 · 4분. 병렬 호출은 비용도 시간도 한 턴치다.
   */
  it('한 턴의 병렬 호출은 상한을 한 턴만 먹는다', async () => {
    let turn = 0;
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const withTools = Boolean((JSON.parse(init.body as string) as { tools?: unknown }).tools);
      turn += 1;
      if (withTools && turn === 1) return reply({ tool_calls: Array.from({ length: 14 }, (_, i) => tc('c' + i, 'count_trials', { registry: ['cris'], investigator: '이름' + i })) });
      if (withTools && turn === 2) return reply({ tool_calls: [tc('s', 'search_trials_multi_registry', { registry: ['cris'], term: 'x' })] });
      return reply({ content: '답' });
    });
    const t = fakeTools(() => ok('cris', { total: 1 }, 1));
    const r = await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {}, maxTurns: 3 });
    expect(t.calls).toHaveLength(15);   // 14 + 1 — 둘째 턴이 잘리지 않았다
    expect(r.truncated).toBe(false);
  });

  it('턴 상한에 닿으면 멈추고 그때까지의 결과로 답하게 한다 — 조용히 무한히 돌지 않는다', async () => {
    // 도구를 주는 동안은 늘 도구를 부르고, 도구를 빼면(상한) 답을 낸다
    const f = vi.fn(async (_u: string, init: RequestInit) => (JSON.parse(init.body as string) as { tools?: unknown }).tools
      ? reply({ tool_calls: [tc('z', 'count_trials', { registry: ['ctgov'], condition: 'x' })] })
      : reply({ content: '상한까지 본 것: 3건' }));
    const t = fakeTools(() => ok('ctgov', { total: 1 }, 1));
    const r = await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {}, maxTurns: 3 });
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

  it('도구 정의는 MCP 와 같은 일곱 + 플레이북 로더이고, 지침은 플러그인 SKILL.md 에서 온다', () => {
    const tools = agentTools();
    expect(tools.map((t) => t.function.name).sort()).toEqual(['aggregate_trials', 'count_trials', 'get_trial_by_id', 'get_trial_results', 'list_registries_and_capabilities', 'load_playbook', 'resolve_korean_investigator_name', 'search_trials_multi_registry']);
    expect(tools.find((t) => t.function.name === 'count_trials')!.function.parameters).toMatchObject({ type: 'object' });
    const p = systemPromptForAgent();
    expect(p).toMatch(/경고를 반드시 읽어라/);
    expect(p).toMatch(/추측했다고 답에 밝혀라/);
    expect(p).toMatch(/범주별 건수를 더하지 마라/);
  });

  /** 실측(2026-09-11): 첫 LLM 호출이 300초 매달리다 fetch failed. 호출마다 상한을 두고 한 번은 다시 한다. */
  it('LLM 호출이 매달리면 상한에서 끊고 한 번 다시 한다', async () => {
    let n = 0;
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      n += 1;
      if (n === 1) return new Promise<Response>((_, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('aborted'))); });
      return reply({ content: '두 번째에 됐다' });
    });
    const t = fakeTools(() => ok('ctgov', []));
    const r = await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {}, llmTimeoutMs: 50 });
    expect(n).toBe(2);
    expect(r.answer).toBe('두 번째에 됐다');
  });

  it('플레이북이 표기 전부 검색·CRIS 한국어 검색을 말한다', () => {
    const p = loadPlaybook('investigator-korean')!.body;
    expect(p).toMatch(/표기[^\n]*따로|표기[^\n]*각각/);
    expect(p).toMatch(/한국어 이름 그대로/);
  });

  it('LLM 이 죽으면 그때까지의 스텝과 함께 오류를 낸다', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const t = fakeTools(() => ok('ctgov', []));
    const r = await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(r.error).toMatch(/500/);
    expect(r.answer).toBeUndefined();
  });
});

/**
 * 플레이북 — **시나리오별 절차를 스킬처럼 준다.** 사용자: "모델에게 skill 형태로 절차를 제공하는 건
 * 가능한가요? … 사전에 skill 을 만들어서 process 를 통일시키면 좋을 것 같은데요"(2026-09-11).
 * Claude Code 가 스킬을 다루듯: 프롬프트에는 목록(이름·언제)만, 절차는 모델이 `load_playbook` 으로
 * 불러 읽는다. 어느 절차를 썼는지가 도구 추적에 보인다. 파일은 `skills/ctreg/playbooks/*.md` —
 * Claude Code 플러그인의 SKILL.md 도 같은 파일을 가리켜 두 표면의 절차가 하나다.
 */
describe('플레이북', () => {
  it('파일마다 이름·언제·절차가 있고, 목록이 그것에서 나온다', () => {
    const list = playbooks();
    expect(list.map((p) => p.name).sort()).toEqual(['by-axis-analysis', 'by-id', 'condition-drug', 'count-compare', 'investigator-korean', 'investigator-profile', 'ranking']);
    for (const p of list) { expect(p.when).toMatch(/\S/); expect(p.body).toMatch(/절차|순서|단계/); }
  });

  it('프롬프트에는 목록만 — 절차 본문은 실리지 않는다', () => {
    const p = systemPromptForAgent();
    expect(p).toMatch(/load_playbook/);
    expect(p).toMatch(/investigator-korean/);
    expect(p).not.toMatch(/ctgov 건수가 있는 표기 전부를 각각/);   // 이건 플레이북 본문에만 (지침 본문에서 옮긴다)
  });

  it('load_playbook 은 일곱 번째 도구이고, 부르면 절차 본문이 모델에게 돌아간다', async () => {
    expect(agentTools().map((t) => t.function.name)).toContain('load_playbook');
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('p', 'load_playbook', { name: 'investigator-korean' })] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ok('ctgov', []));
    const events: AgentEvent[] = [];
    const r = await agent({ q: '김민걸 교수 연구', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: (e) => events.push(e) });
    expect(t.calls).toHaveLength(0);   // 플레이북은 레지스트리를 치지 않는다
    const second = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: { role: string; tool_call_id?: string; content?: string }[] };
    expect(second.messages.find((m) => m.tool_call_id === 'p')?.content).toContain(loadPlaybook('investigator-korean')!.body.slice(0, 40));
    expect(r.steps[0]).toMatchObject({ tool: 'load_playbook', args: { name: 'investigator-korean' } });   // 추적에 보인다
    expect(events.some((e) => e.type === 'result' && e.summary.includes('절차'))).toBe(true);
  });

  it('없는 플레이북은 목록과 함께 그렇다고 돌려준다', () => {
    expect(loadPlaybook('nope')).toBeUndefined();
  });

  it('플러그인 SKILL.md 가 같은 플레이북을 가리킨다 — 두 표면의 절차가 하나다', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const skill = readFileSync(new URL('../../skills/ctreg/SKILL.md', import.meta.url), 'utf8');
    expect(skill).toMatch(/playbooks\//);
  });
});

/**
 * 실측(2026-09-12): rank_investigators 가 276건을 냈는데 모델은 "데이터가 비었다" 고 답했다 — 도구 결과를
 * 압축하는 자리가 레코드 키 허용목록으로 걸러 `{matched, items}` 가 `{}` 가 됐다. 배열이 아닌 결과
 * (count·names·investigators·registries)는 이미 작다 — 통째로 넘긴다.
 */
describe('도구 결과 압축', () => {
  it('배열이 아닌 결과는 통째로 모델에게 간다 — investigators 의 items 가 보인다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('r', 'aggregate_trials', { by: 'investigator', term: '당뇨,diabetes', 'page-size': 5 })] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ({ exitCode: 0, exit: 'ok', envelope: { registries: [{ registry: 'cris', status: 'ok', total: 276 }], warnings: [],
      data: { by: 'investigator', matched: 276, terms: ['당뇨', 'diabetes'], basis: '등록 건수', provenance: 'x', mapped: 1, items: [{ key: 'k', name: '김난희', trials: 10, mapped: true, extra: { affiliations: '고려대' } }] } } }));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    const second = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: { role: string; content?: string }[] };
    const toolMsg = second.messages.find((m) => m.role === 'tool')!.content!;
    expect(toolMsg).toContain('김난희');
    expect(toolMsg).toContain('"matched":276');
    expect(toolMsg).toContain('등록 건수');
  });

  it('배열 결과는 앞 N 건을 레코드 키로 압축한다 — 크기를 지킨다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: [tc('s', 'search_trials_multi_registry', { registry: ['ctgov'], term: 'x' })] }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ok('ctgov', Array.from({ length: 60 }, (_, i) => ({ id: 'CTGOV:' + i, title: 't' + i, hugeField: 'x'.repeat(500) }))));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    const second = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: { role: string; content?: string }[] };
    const toolMsg = second.messages.find((m) => m.role === 'tool')!.content!;
    expect(toolMsg).not.toContain('hugeField');
    expect(toolMsg).toContain('"returned":60');
    expect(toolMsg).toContain('"shown":40');
  });
});

describe('턴당 병렬 상한', () => {
  it('한 턴에 20개를 넘는 호출은 앞 20개만 돌리고 나머지는 그렇다고 돌려준다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ tool_calls: Array.from({ length: 25 }, (_, i) => tc('c' + i, 'count_trials', { registry: ['cris'], investigator: 'n' + i })) }))
      .mockResolvedValueOnce(reply({ content: '끝' }));
    const t = fakeTools(() => ok('cris', { total: 1 }, 1));
    await agent({ q: 'x', env: env(), fetchImpl: f as unknown as typeof fetch, call: t.call, onEvent: () => {} });
    expect(t.calls).toHaveLength(20);
    const second = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: { role: string; tool_call_id?: string; content?: string }[] };
    expect(second.messages.filter((m) => m.role === 'tool')).toHaveLength(25);   // 모든 호출에 답은 간다
    expect(second.messages.find((m) => m.tool_call_id === 'c24')?.content).toMatch(/상한|넘/);
  });
});
