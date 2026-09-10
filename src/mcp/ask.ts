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

export async function ask(body: AskBody, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<ApiResponse> {
  const cfg = loadConfig(env);
  if (!cfg.llmApiKey) {
    return { status: 501, body: { error: 'ai_mode_off', message: 'AI 모드가 아직 켜져 있지 않다 — 서버에 LLM 키가 없다. AI 모드를 끄고 검색하거나, 검색창 문법(status:recruiting 등)을 써라.' } };
  }
  const q = (body.q ?? '').trim();
  if (q === '') return { status: 400, body: { error: 'empty' } };
  const intent: Intent = body.intent === 'count' ? 'count' : 'search';

  const baseUrl = (cfg.llmBaseUrl ?? 'https://ollama.com/v1').replace(/\/+$/, '');
  const model = cfg.llmModel ?? 'glm-5.3-flash';
  let text: string;
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.llmApiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt(intent) },
          { role: 'user', content: q },
        ],
      }),
    });
    if (!res.ok) return { status: 502, body: { error: 'llm_http', message: `LLM 이 ${res.status} 를 냈다.` } };
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    text = j.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    return { status: 502, body: { error: 'llm_unreachable', message: `LLM 에 닿지 못했다: ${(e as Error).message}` } };
  }

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
  const r = await callTool(resolved.tool, resolved.args, env);
  const out = r.structuredContent as { exitCode: number };
  // 모델의 선택을 결과에 싣는다 — 사용자가 봐야 틀렸을 때 알아챈다.
  return { status: out.exitCode === 2 ? 400 : 200, body: { ...out, resolved: { command: resolved.tool, tool: resolved.tool, args: resolved.args, model } } };
}
