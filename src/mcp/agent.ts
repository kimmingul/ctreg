import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { COMMAND_OPTIONS, COMMANDS } from '../cli/args.js';
import { REGISTRY_KEYS } from '../core/registry.js';
import { loadConfig } from '../runtime/config.js';
import { callTool, TOOL_NAME, toolDescriptions, toolSchemas, type ToolName } from './server.js';

/**
 * 에이전트 루프 — **Claude Code 가 MCP 로 하는 그대로.**
 *
 * 0.9~0.11 의 AI 모드는 "분류기 하나 → 도구 하나(또는 손으로 짠 이름 절차) → 요약" 이었다. 그
 * 구조가 사고를 냈다: 분류가 회차마다 흔들려 0건이 나오고, 이름 절차를 손으로 짜야 했고, 문장
 * 패턴이 "우수한 연구자" 를 사람으로 읽었다. 사용자: "니가 claude code 에 mcp 를 설치한 것과
 * 동일한 방식으로 작동하기 원해요"(2026-09-11). 그래서 모델에게 **MCP 와 같은 도구 여섯**을 주고
 * 루프를 돌린다 — 생각 → 도구 호출 → 결과 읽기 → 반복 → 답. 절차는 모델이 조립한다.
 *
 * - 도구 정의는 `toolSchemas()`·`toolDescriptions()` 에서 만든다 — MCP 표면과 같은 정본.
 * - 지침은 **플러그인 SKILL.md 그대로** — Claude Code 에 깔린 것과 같은 문서, 같은 규율.
 * - 한 턴의 도구 호출 여럿은 **동시에** 돈다(모델이 병렬을 정한다).
 * - 모델이 낸 인자는 정규화·필터링한다(대문자 레지스트리, 모르는 키). 모르는 도구는 실행하지
 *   않고 그렇다고 돌려준다. 도구 실패(exit 2·3·4)는 봉투 그대로 모델에게 — 0건으로 둔갑하지 않는다.
 * - 상한: 스텝 수·시간. 닿으면 도구 없이 답만 받고 `truncated` 로 말한다.
 * - 진행 이벤트를 밖으로 낸다 — 페이지가 Claude Code 의 도구 추적처럼 실시간으로 그린다.
 */

export type AgentEvent =
  | { type: 'call'; step: number; tool: ToolName; args: Record<string, unknown> }
  | { type: 'result'; step: number; tool: ToolName; exit: number; ms: number; summary: string }
  | { type: 'final'; answer: string }
  | { type: 'error'; message: string };

export type AgentStep = { step: number; tool: ToolName; args: Record<string, unknown>; exit: number; ms: number; summary: string };
export type AgentResult = {
  answer?: string;
  error?: string;
  steps: AgentStep[];
  /** 모든 스텝에서 모인 레코드 — 근거. 중복 제거, 상한 안. */
  records: Record<string, unknown>[];
  truncated: boolean;
  model: string;
  ms: number;
};

type Call = typeof callTool;
type Command = (typeof COMMANDS)[number];
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const CMD_OF: Record<string, Command> = Object.fromEntries((Object.entries(TOOL_NAME) as [Command, ToolName][]).map(([c, t]) => [t, c])) as Record<string, Command>;

/** OpenAI 호환 `tools` — MCP 가 등록하는 것과 같은 zod 스키마를 JSON Schema 로. */
export function agentTools(): { type: 'function'; function: { name: ToolName; description: string; parameters: Record<string, unknown> } }[] {
  const schemas = toolSchemas();
  const desc = toolDescriptions();
  return (Object.entries(TOOL_NAME) as [Command, ToolName][]).map(([cmd, name]) => ({
    type: 'function' as const,
    function: { name, description: desc[cmd], parameters: z.toJSONSchema(schemas[name], { target: 'draft-7' }) as Record<string, unknown> },
  }));
}

/** 플러그인 SKILL.md 본문 + 답의 규칙. 같은 문서를 읽는다 — 손으로 다시 적으면 둘이 갈린다. */
export function systemPromptForAgent(): string {
  const require = createRequire(import.meta.url);
  const skill = readFileSync(require.resolve('../../skills/ctreg/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  return `너는 임상시험 레지스트리 조회 에이전트다. 아래 도구로 사용자의 물음에 답한다. 도구는 여러 번, 필요하면 한 턴에 여러 개 불러도 된다. 결과를 읽고 다음 도구를 정하라. 다 모였으면 도구 없이 한국어로 답하라.

## 답의 규칙
- **도구 결과에 있는 것만** 말한다. 없는 사실·수치·이름을 지어내지 마라.
- 물음이 결과로는 답할 수 없는 것이면(순위·우수성·레지스트리 밖의 사실) 그렇다고 말하고, 결과로 말할 수 있는 것을 대신 낸다.
- 근거 레코드는 등록번호로 가리켜라 — 예: [CTGOV:NCT01234567], [CRIS:KCT0012487].
- 경향은 수를 세어 말하라("N건 중 M건").
- 레지스트리 상태·경고(그렇게 물어볼 수 없음·사본·추측·잘림)는 답의 한계로 밝혀라.
- 의학적 판단·적격 판정을 하지 마라.
- **레코드를 표로 나열하지 마라.** 페이지가 네가 받은 레코드를 아래에 그대로 보여준다. 너의 답은 요약·경향·한계와 근거 번호 몇 개다 — 문단 2~4개, 간결하게.
- 도구 이름과 인자는 아래 정의를 정확히 따르라. 레지스트리 키는 소문자다: ${REGISTRY_KEYS.join(', ')}.
- 이름 대조(resolve_korean_investigator_name)의 term 은 후보를 좁힐 **기관·주제**다 — 이름을 넣지 마라. CRIS 사본이 있으면 term 없이 된다.
- ISRCTN 은 연구자 이름 축이 없지만 term(본문 자유검색)이 이름에 닿는다 — 쓰되, 본문 검색이라 연구책임자가 아닐 수 있다고 밝혀라. EU CTIS 는 이름으로 물을 수 없다.

## 도구를 쓰는 규율 (Claude Code 플러그인의 지침 그대로)
${skill.replace(/`ctreg registries`/g, '`list_registries_and_capabilities`').replace(/`--help`/g, '도구 정의').replace(/ctreg 는 임상시험/g, '이 도구 모음은 임상시험')}`;
}

/** 모델이 낸 인자를 그 도구가 받는 모양으로. 대문자 레지스트리·모르는 키·빈 값. */
function normalizeArgs(cmd: Command, raw: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set<string>([...COMMAND_OPTIONS[cmd], 'ids', 'trial_id', 'korean_name']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.has(k) || v === null || v === undefined || v === '') continue;
    if (k === 'registry') {
      const list = (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase().trim()).filter((x) => x === 'all' || (REGISTRY_KEYS as readonly string[]).includes(x));
      if (list.length > 0) out.registry = list;
      continue;
    }
    out[k] = v;
  }
  // 이름 대조의 term 은 후보를 좁힐 기관·주제다 — 이름 자체를 넣으면 0건이 된다(실측 2026-09-11).
  if (cmd === 'names' && typeof out.term === 'string' && typeof out.korean_name === 'string' && out.term.replace(/\s/g, '') === out.korean_name.replace(/\s/g, '')) delete out.term;
  return out;
}

/** 도구 결과를 모델에게 돌려줄 크기로. 봉투(상태·경고)는 그대로, 레코드는 앞 N 건을 압축해서. */
const RECORD_KEYS = ['id', 'registry', 'title', 'status', 'phase', 'studyType', 'conditions', 'interventions', 'hasResults', 'locationsTotal', 'enrollment', 'dates', 'sponsor', 'contacts', 'korean', 'term', 'crisMatched', 'variants', 'total', 'key', 'name', 'search', 'results', 'count'];
function compactForModel(body: Record<string, unknown>, capRecords = 40): { text: string; records: Record<string, unknown>[] } {
  const env = body.envelope as { registries?: unknown; warnings?: unknown; data?: unknown; error?: unknown } | undefined;
  const data = env?.data;
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const records = list.filter((r) => typeof r.id === 'string');
  const shown = (Array.isArray(data) ? list.slice(0, capRecords) : data === undefined ? [] : [data as Record<string, unknown>]).map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of RECORD_KEYS) if (r[k] !== undefined && r[k] !== null) o[k] = r[k];
    return o;
  });
  const out = {
    exitCode: body.exitCode,
    exit: body.exit,
    registries: env?.registries,
    warnings: env?.warnings,
    ...(env?.error ? { error: env.error } : {}),
    ...(Array.isArray(data) ? { returned: list.length, shown: shown.length, data: shown } : { data: shown[0] ?? null }),
  };
  return { text: JSON.stringify(out), records };
}

function summarize(body: Record<string, unknown>): string {
  const env = body.envelope as { registries?: { registry: string; status: string; total?: number }[]; data?: unknown } | undefined;
  const regs = (env?.registries ?? []).map((r) => `${r.registry} ${r.status === 'ok' ? `${r.total ?? 0}건` : r.status === 'unsupported' ? '못 물음' : '실패'}`).join(' · ');
  const d = env?.data;
  const n = Array.isArray(d) ? `${d.length}건 받음` : d && typeof d === 'object' && 'total' in (d as object) ? `총 ${(d as { total: unknown }).total}` : d && typeof d === 'object' && 'variants' in (d as object) ? `표기 ${((d as { variants: unknown[] }).variants ?? []).length}개` : '';
  return [regs, n].filter(Boolean).join(' — ') || `exit ${String(body.exitCode)}`;
}

export type AgentOpts = {
  q: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  call?: Call;
  onEvent?: (e: AgentEvent) => void;
  maxSteps?: number;
  maxMs?: number;
  maxRecords?: number;
};

export async function agent(o: AgentOpts): Promise<AgentResult> {
  const env = o.env ?? process.env;
  const fetchImpl = o.fetchImpl ?? fetch;
  const call = o.call ?? callTool;
  const emit = o.onEvent ?? (() => {});
  const maxSteps = o.maxSteps ?? 10;
  const maxMs = o.maxMs ?? 240_000;
  const maxRecords = o.maxRecords ?? 200;
  const cfg = loadConfig(env);
  const model = cfg.llmModel ?? 'glm-5.3-flash';
  const started = Date.now();
  const steps: AgentStep[] = [];
  const byId = new Map<string, Record<string, unknown>>();
  const base = { steps, records: [] as Record<string, unknown>[], truncated: false, model };

  if (!cfg.llmApiKey) return { ...base, error: 'AI 모드가 아직 켜져 있지 않다 — 서버에 LLM 키가 없다.', ms: 0 };
  const baseUrl = (cfg.llmBaseUrl ?? 'https://ollama.com/v1').replace(/\/+$/, '');
  const tools = agentTools();
  const messages: Message[] = [
    { role: 'system', content: systemPromptForAgent() },
    { role: 'user', content: o.q },
  ];

  const complete = async (withTools: boolean): Promise<{ content: string | null; tool_calls?: ToolCall[] } | { error: string }> => {
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.llmApiKey}` },
        body: JSON.stringify({ model, temperature: 0, messages, ...(withTools ? { tools } : {}) }),
      });
      if (!res.ok) return { error: `LLM 이 ${res.status} 를 냈다.` };
      const j = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
      const m = j.choices?.[0]?.message;
      if (!m) return { error: 'LLM 응답에 message 가 없다.' };
      return { content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) };
    } catch (e) {
      return { error: `LLM 에 닿지 못했다: ${(e as Error).message}` };
    }
  };

  let truncated = false;
  for (;;) {
    const overBudget = steps.length >= maxSteps || Date.now() - started > maxMs;
    if (overBudget) {
      truncated = true;
      messages.push({ role: 'user', content: '도구 호출 상한에 닿았다. 지금까지의 결과만으로, 무엇을 더 못 봤는지 밝히며 답하라.' });
    }
    const r = await complete(!overBudget);
    if ('error' in r) {
      emit({ type: 'error', message: r.error });
      return { ...base, records: [...byId.values()], truncated, error: r.error, ms: Date.now() - started };
    }
    if (!r.tool_calls || overBudget) {
      const answer = (r.content ?? '').trim();
      emit({ type: 'final', answer });
      return { ...base, records: [...byId.values()], truncated, answer, ms: Date.now() - started };
    }
    messages.push({ role: 'assistant', content: r.content ?? null, tool_calls: r.tool_calls });

    // 한 턴의 호출들은 동시에 — 모델이 병렬을 정한 것이다.
    const first = steps.length + 1;
    const results = await Promise.all(r.tool_calls.map(async (tcall, i) => {
      const step = first + i;
      const name = tcall.function.name as ToolName;
      const cmd = CMD_OF[name];
      let raw: Record<string, unknown> = {};
      try { raw = JSON.parse(tcall.function.arguments || '{}') as Record<string, unknown>; } catch { /* 빈 인자로 */ }
      if (!cmd) {
        return { tcall, text: JSON.stringify({ error: `없는 도구다: ${name}. 쓸 수 있는 도구: ${Object.values(TOOL_NAME).join(', ')}` }), step: undefined };
      }
      const args = normalizeArgs(cmd, raw);
      emit({ type: 'call', step, tool: name, args });
      const t0 = Date.now();
      const out = await call(cmd, args, env);
      const body = (out.structuredContent ?? {}) as Record<string, unknown>;
      const { text, records } = compactForModel(body);
      for (const rec of records) if (byId.size < maxRecords && !byId.has(rec.id as string)) byId.set(rec.id as string, rec);
      const s: AgentStep = { step, tool: name, args, exit: Number(body.exitCode ?? -1), ms: Date.now() - t0, summary: summarize(body) };
      emit({ type: 'result', step, tool: name, exit: s.exit, ms: s.ms, summary: s.summary });
      return { tcall, text, step: s };
    }));
    for (const x of results) {
      if (x.step) steps.push(x.step);
      messages.push({ role: 'tool', tool_call_id: x.tcall.id, content: x.text });
    }
  }
}
