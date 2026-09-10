import { COMMAND_OPTIONS, COMMANDS, OPTION_HELP } from '../cli/args.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../core/vocab.js';
import { loadConfig } from '../runtime/config.js';
import { callTool } from './server.js';
import type { ApiResponse } from './web.js';

/**
 * AI 모드 — 검색창의 자연어를 **도구·인자로 바꾸는 한 자리.**
 *
 * 구글의 검색창은 무엇을 쳐도 답이 나오고, 그게 되는 이유가 뒤의 모델이다. 여기서 모델이
 * 하는 일은 그것 하나다: "김민걸 교수 3상 시험" → `{tool: "names", args: {...}}`. 변환이
 * 끝나면 그 뒤는 `callTool` 그대로 — 같은 코어, 같은 봉투, 같은 exitCode.
 *
 * **모델은 결과를 요약하거나 해석하지 않는다.** 그렇게 두면 이 도구가 없애려던 "조용히
 * 틀린 답" 이 페이지로 돌아온다. 설계 스펙 §1.2 가 합성 워크플로를 비목표로 뒀는데, 조건
 * 변환은 워크플로가 아니라 입력 파싱이라 그 선 안에 있다고 본다.
 *
 * **모델이 고른 것을 검증 없이 실행하지 않는다.** 모르는 도구·인자는 502 로 막는다. CLI
 * 파서에 맡기면 exit 2 가 나오겠지만 그건 "모델이 헛소리를 했다" 를 "입력을 고쳐라" 로
 * 오도한다. 그리고 **무엇으로 물었는지를 결과에 실어 돌려준다** — 사용자가 모델의 선택을
 * 볼 수 있어야 틀렸을 때 알아챈다.
 *
 * OpenAI 호환 chat.completions 를 쓴다. Ollama Cloud·OpenAI·로컬 Ollama 전부 이 모양이다.
 * 키가 없으면 501 — 페이지가 "아직 켜져 있지 않다" 를 보이고 나머지는 그대로 돈다.
 */

type Command = (typeof COMMANDS)[number];
type Intent = 'search' | 'count';
export type Resolution = { tool: Command; args: Record<string, unknown> };

const isCommand = (s: unknown): s is Command => typeof s === 'string' && (COMMANDS as readonly string[]).includes(s);

/** 페이지에서 오는 것. `intent` 는 사용자가 누른 버튼(시험 검색 / 건수만) — 모델에게 힌트로 준다. */
export type AskBody = { q: string; intent?: Intent };

/**
 * 시스템 프롬프트. 도구 여섯과 인자를 **OPTION_HELP 에서 파생** 한다 — MCP 스키마·--help 와
 * 같은 정본. 손으로 다시 적으면 옵션이 늘 때 모델만 모른다.
 */
export function systemPrompt(intent: Intent = 'search'): string {
  const tools = COMMANDS.map((cmd) => {
    const opts = COMMAND_OPTIONS[cmd]
      .filter((o) => !['format', 'help', 'version', 'no-cache', 'refresh', 'raw', 'page-token', 'eligibility-chars'].includes(o))
      .map((o) => `    - ${o}: ${OPTION_HELP[o]}`)
      .join('\n');
    const positional = cmd === 'get' ? '    - ids: string[] — 접두사 붙은 등록번호들\n' : cmd === 'results' ? '    - trial_id: string — 접두사 붙은 등록번호 하나\n' : cmd === 'names' ? '    - korean_name: string — 한국어 이름\n' : '';
    return `- ${cmd}\n${positional}${opts}`;
  }).join('\n');

  return `너는 임상시험 레지스트리 검색 도구의 입력 파서다. 사용자의 자연어를 **도구 하나와 그 인자**로 바꾼다. 그것만 한다 — 답하거나 요약하거나 설명하지 않는다.

출력은 JSON 하나뿐이다. 다른 글자는 한 자도 내지 마라:
{"tool": "<도구 이름>", "args": { ... }}

도구와 인자:
${tools}

닫힌 값:
- status: ${FILTERABLE_STATUS.join(' | ')}
- phase: ${FILTERABLE_PHASE.join(' | ')}
- study-type: ${FILTERABLE_STUDY_TYPE.join(' | ')}
- registry: ctgov | isrctn | ctis | cris | ictrp | all

규칙:
1. 사용자가 "${intent === 'count' ? '건수만' : '시험 검색'}" 을 눌렀다. 다른 도구가 명백히 맞지 않으면 ${intent} 를 써라.
2. **한국어 사람 이름이 있으면 names 를 골라라.** 절대 로마자로 옮기지 마라 — 로마자 표기가 사람마다 달라서 다른 사람이 된다. korean_name 에 한국어 그대로, term 에 기관명·연구 주제(없으면 질환·약물 이름)를 넣고 ctgov 를 true 로.
3. 등록번호(NCT…, KCT…, ISRCTN…, 2022-5…)가 있으면 get 을 골라라. 접두사(CTGOV:, CRIS:, ISRCTN:, CTIS:)를 붙여라.
4. registry 를 사용자가 말하지 않았으면 ["ctgov","isrctn","ctis","cris"] 로. 한국·국내라고 하면 ["cris"], 미국이면 ["ctgov"], 유럽이면 ["ctis"], 영국이면 ["isrctn"].
5. 질환·약물 이름은 영어로 바꿔 condition·intervention 에 넣어라(레지스트리가 영어를 받는다). 사람 이름은 예외다 — 규칙 2.
6. 모집 중이라고 하면 status ["recruiting"], 끝났다고 하면 ["completed"]. 3상이면 phase ["phase_3"].
7. 모르는 것은 넣지 마라. 값을 지어내지 마라.`;
}

/** 모델 출력에서 JSON 을 꺼낸다. 작은 모델은 코드 펜스나 앞뒤 말을 자주 붙인다. */
export function parseResolution(text: string): Resolution | undefined {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { tool?: unknown; args?: unknown };
    if (!isCommand(obj.tool)) return undefined;
    const args = obj.args !== null && typeof obj.args === 'object' ? (obj.args as Record<string, unknown>) : {};
    return { tool: obj.tool, args };
  } catch {
    return undefined;
  }
}

/** 모델이 낸 인자 중 그 도구가 받지 않는 키를 걸러낸다 — 실행 전에. */
function sanitize(r: Resolution): Resolution {
  const allowed = new Set<string>([...COMMAND_OPTIONS[r.tool], 'ids', 'trial_id', 'korean_name']);
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.args)) if (allowed.has(k) && v !== null && v !== undefined && v !== '') args[k] = v;
  return { tool: r.tool, args };
}

type Call = typeof callTool;
type Llm = { baseUrl: string; model: string; key: string };

/** LLM 한 번. 실패는 ApiResponse(502) 로 돌려 호출자가 그대로 낸다. */
async function complete(llm: Llm, fetchImpl: typeof fetch, messages: { role: 'system' | 'user'; content: string }[]): Promise<string | ApiResponse> {
  try {
    const res = await fetchImpl(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${llm.key}` },
      body: JSON.stringify({ model: llm.model, temperature: 0, messages }),
    });
    if (!res.ok) return { status: 502, body: { error: 'llm_http', message: `LLM 이 ${res.status} 를 냈다.` } };
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    return { status: 502, body: { error: 'llm_unreachable', message: `LLM 에 닿지 못했다: ${(e as Error).message}` } };
  }
}
const isResponse = (x: unknown): x is ApiResponse => typeof x === 'object' && x !== null && 'status' in x;

type Env = { registries: { registry: string; status: string; total?: number }[]; warnings: { code: string; message: string; registry?: string }[]; data: unknown };
const envelopeOf = (r: Awaited<ReturnType<Call>>): { exitCode: number; envelope?: Env } => r.structuredContent as { exitCode: number; envelope?: Env };

/**
 * **이름만 쳤을 때.** Claude 에 MCP 로 붙였을 때는 "김민걸 연구 찾아줘" 가 됐다 — 에이전트가
 * names 실패 뒤 로마자 후보를 여럿 만들어 ctgov 에 각각 물었기 때문이다. 페이지는 한 번
 * 부르고 끝이라 그 절차를 여기서 대신한다: 모델에게 표기 후보를 받고 붙임 표기를 더해(최대 12), ctgov 에
 * 건수를 각각 물어 걸린 표기만 열고(최대 4), 합쳐 중복을 뺀다.
 *
 * **추측했다고 밝힌다.** 로마자 표기가 다르면 다른 사람이다 — 이 서버가 `names` 를 만든
 * 이유다. 후보에 없는 표기로 등록된 시험은 빠지고, 그 사실을 경고에 적는다. 소속·주제를
 * 주면 `names` 가 CRIS 에서 **등록된** 표기를 읽어 오므로 그 길을 안내한다.
 *
 * ctgov 만 묻는다 — 이름 축을 받는 곳이 ctgov 와 CRIS 뿐이고 CRIS 는 좁힐 말 없이는 후보를
 * 못 만든다(실측: 자유검색에 이름을 넣으면 0건).
 */
async function nameOnly(korean: string, intent: Intent, llm: Llm, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, call: Call): Promise<ApiResponse> {
  const text = await complete(llm, fetchImpl, [
    { role: 'system', content: '한국어 사람 이름의 영문(로마자) 표기 후보를 낸다. ClinicalTrials.gov 등록 관행대로 "이름 성" 순서(예: Min-Gul Kim). 하이픈·붙임·띄움 변형과 흔한 관용 표기(이→Lee/Rhee/Yi, 박→Park, 최→Choi, 정→Jung/Jeong/Chung 등)를 포함해 많이 쓰는 순으로 최대 8개. 출력은 JSON 문자열 배열 하나뿐이다. 다른 글자는 내지 마라.' },
    { role: 'user', content: korean },
  ]);
  if (isResponse(text)) return text;
  let variants: string[] = [];
  try {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const arr = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1)) as unknown;
    if (Array.isArray(arr)) variants = arr.filter((x): x is string => typeof x === 'string' && /^[A-Za-z][A-Za-z .'-]*$/.test(x.trim())).map((x) => x.trim());
  } catch { /* 아래에서 빈 배열로 처리 */ }
  // 붙임 표기는 규칙이라 서버가 만든다 — 실측에서 모델이 `Mingul Kim`(17건)을 빠뜨렸다. ctgov 는
  // 하이픈과 띄움을 같게 보지만(둘 다 45건) 붙임은 다른 사람이다.
  variants = variants.flatMap((v) => (v.includes('-') ? [v, v.replace(/-([A-Za-z])/g, (_, c: string) => c.toLowerCase())] : [v]));
  const seen = new Set<string>();
  variants = variants.filter((v) => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
  if (variants.length === 0) {
    return { status: 502, body: { error: 'llm_unparseable', message: '모델이 이름의 영문 표기를 내지 못했다. 소속 기관이나 연구 주제를 함께 적어 보라.', raw: text.slice(0, 300) } };
  }

  // 1) 표기마다 건수 — 걸린 것만 연다.
  const counts = await Promise.all(variants.map(async (v) => {
    const r = envelopeOf(await call('count', { registry: ['ctgov'], investigator: v }, env));
    const total = r.exitCode === 0 ? ((r.envelope?.data as { total?: number } | undefined)?.total ?? 0) : 0;
    return { v, total };
  }));
  const hits = counts.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 4);
  const tried = counts.map((c) => `${c.v} ${c.total}건`).join(' · ');
  const guide = '소속 기관이나 연구 주제를 함께 적으면 CRIS 에서 실제 등록된 표기를 읽어 정확히 대조한다(이름 대조).';

  if (hits.length === 0) {
    const envelope: Env = {
      registries: [{ registry: 'ctgov', status: 'ok', total: 0 }],
      warnings: [{ code: 'name_romanized_guess', message: `한국어 이름을 로마자로 추측해 ClinicalTrials.gov 에 물었으나 어느 표기도 걸리지 않았다: ${tried}. 다른 표기로 등록돼 있을 수 있다. ${guide}` }],
      data: intent === 'count' ? { total: 0 } : [],
    };
    return { status: 200, body: { exitCode: 0, exit: 'ok', envelope, resolved: { command: intent, tool: intent, args: { registry: ['ctgov'], investigator: variants }, model: llm.model, via: 'name_only' } } };
  }

  // 2) 걸린 표기마다 검색 — 합치고 중복을 뺀다. 한 쪽에 다 들어오면 합이 곧 전체다.
  const PAGE = 100;
  const results = await Promise.all(hits.map((h) => call('search', { registry: ['ctgov'], investigator: h.v, 'page-size': PAGE }, env).then(envelopeOf)));
  const byId = new Map<string, unknown>();
  const warnings: Env['warnings'] = [];
  for (const r of results) for (const item of (Array.isArray(r.envelope?.data) ? r.envelope.data : []) as { id?: string }[]) if (item.id && !byId.has(item.id)) byId.set(item.id, item);
  for (const r of results) for (const w of r.envelope?.warnings ?? []) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
  const truncated = hits.some((h) => h.total > PAGE);
  const merged = [...byId.values()];
  warnings.unshift({
    code: 'name_romanized_guess',
    message: `한국어 이름을 로마자로 추측해 ClinicalTrials.gov 에 각각 물었다: ${tried}. 표기가 다르면 다른 사람으로 걸리므로 이 후보에 없는 표기로 등록된 시험은 빠진다. ${guide}`,
  });
  if (truncated) warnings.push({ code: 'name_scan_truncated', message: `표기 하나에 ${PAGE}건을 넘는 것이 있어 그 뒤는 열지 않았다 — 합계가 전체보다 작다.`, registry: 'ctgov' });
  const envelope: Env = {
    registries: [{ registry: 'ctgov', status: 'ok', total: merged.length }],
    warnings,
    data: intent === 'count' ? { total: merged.length } : merged,
  };
  return { status: 200, body: { exitCode: truncated ? 5 : 0, exit: truncated ? 'partial' : 'ok', envelope, resolved: { command: intent, tool: intent, args: { registry: ['ctgov'], investigator: hits.map((h) => h.v) }, model: llm.model, via: 'name_only' } } };
}

export async function ask(body: AskBody, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, call: Call = callTool): Promise<ApiResponse> {
  const cfg = loadConfig(env);
  if (!cfg.llmApiKey) {
    return { status: 501, body: { error: 'ai_mode_off', message: 'AI 모드가 아직 켜져 있지 않다 — 서버에 LLM 키가 없다. AI 모드를 끄고 검색하거나, 검색창 문법(status:recruiting 등)을 써라.' } };
  }
  const q = (body.q ?? '').trim();
  if (q === '') return { status: 400, body: { error: 'empty' } };
  const intent: Intent = body.intent === 'count' ? 'count' : 'search';

  const llm: Llm = { baseUrl: (cfg.llmBaseUrl ?? 'https://ollama.com/v1').replace(/\/+$/, ''), model: cfg.llmModel ?? 'glm-5.3-flash', key: cfg.llmApiKey };
  const model = llm.model;
  const text = await complete(llm, fetchImpl, [
    { role: 'system', content: systemPrompt(intent) },
    { role: 'user', content: q },
  ]);
  if (isResponse(text)) return text;

  const parsed = parseResolution(text);
  if (!parsed) {
    return { status: 502, body: { error: 'llm_unparseable', message: '모델이 도구를 고르지 못했다. 검색창 문법으로 직접 물어보거나 말을 바꿔 보라.', raw: text.slice(0, 300) } };
  }
  const resolved = sanitize(parsed);
  /**
   * 사용자가 누른 버튼이 이긴다. 실측(glm-5.3-flash, 10문장)에서 "건수만" 을 눌렀는데 모델이
   * search 를 고른 경우가 하나 있었다 — 인자는 맞았고 도구만 틀렸다. search↔count 는 인자가
   * 같으니 여기서 덮어쓴다. names·get·results·registries 는 모델의 판단을 존중한다 — 그건
   * 버튼이 아니라 문장이 정하는 것이다.
   */
  if ((resolved.tool === 'search' || resolved.tool === 'count') && resolved.tool !== intent) resolved.tool = intent;
  // 이름만 있고 좁힐 말이 없다 — CRIS 는 후보를 못 만든다. 되묻지 않고 에이전트가 하던 절차를 여기서 한다.
  if (resolved.tool === 'names' && typeof resolved.args.korean_name === 'string' && !resolved.args.term) {
    return nameOnly(resolved.args.korean_name, intent, llm, env, fetchImpl, call);
  }
  const r = await call(resolved.tool, resolved.args, env);
  const out = r.structuredContent as { exitCode: number };
  // 모델의 선택을 결과에 싣는다 — 사용자가 봐야 틀렸을 때 알아챈다.
  return { status: out.exitCode === 2 ? 400 : 200, body: { ...out, resolved: { command: resolved.tool, tool: resolved.tool, args: resolved.args, model } } };
}
