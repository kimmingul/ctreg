import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import { COMMAND_OPTIONS, COMMANDS, OPTION_HELP, OPTIONS } from '../cli/args.js';
import { EXIT, type ExitCode } from '../cli/exit-codes.js';
import { run } from '../cli/index.js';
import { readVersion } from '../cli/version.js';
import { loadConfig } from '../runtime/config.js';
import { record } from './stats.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../core/vocab.js';

/**
 * MCP 는 이 CLI 의 **세 번째 껍데기** 다 — 첫째가 `bin.ts`, 둘째가 플러그인 스킬.
 * 코어(`run()`)는 하나이고, 이 파일은 그것을 MCP 도구 호출로 감쌀 뿐이다. 어댑터도
 * 가드도 캐시도 요청률 제한도 여기 없다 — 전부 `run()` 안에 있다.
 *
 * 설계 스펙 §1.1 이 "왜 CLI 인가" 를 적으며 말한 것이 이것이다: 그 가드들은 프로세스
 * 경계 안의 계약이지 MCP 프로토콜의 속성이 아니다. 그래서 어떤 껍데기든 얹을 수 있다.
 *
 * **두 가지를 지킨다.**
 *
 * 1. **도구 표면은 CLI 에서 파생한다.** 인자 스키마를 손으로 적지 않고 `COMMAND_OPTIONS`
 *    와 `OPTIONS` 에서 만든다. 두 벌이면 옵션이 하나 늘 때 갈린다.
 * 2. **종료 코드를 본문에 싣는다.** MCP 도구 결과에는 종료 코드 자리가 없다. 이 CLI 의
 *    핵심이 exit 3(그렇게 물어볼 수 없음)과 0건을 가르는 것인데, 그것을 본문에 명시하지
 *    않으면 셸에서 지켜 온 규칙이 여기서 조용히 사라진다.
 */

type Command = (typeof COMMANDS)[number];
type ToolArgs = Record<string, unknown>;

/**
 * **CLI 커맨드 → MCP 도구 이름.** 의도적으로 가른 자리다.
 *
 * 셸에서는 `ctreg search` 로 충분하다 — `ctreg` 가 앞에 있으니까. MCP 에서는 여러 서버의
 * 도구가 한 목록에 섞이고, `search` 는 무엇을 검색하는지 말하지 않는다. Anthropic 의
 * Clinical Trials 서버(`search_trials`·`get_trial_details`…)와 겹치면 더 나쁘다 — 두 서버가
 * 함께 붙으면 모델이 둘을 섞는다. 그래서 목적어와 **이 서버만의 표지** 를 붙인다:
 * `multi_registry`(레지스트리 다섯), `korean`(한국어 대조).
 *
 * `Record<Command, string>` 이라 커맨드가 늘면 이름도 반드시 정해야 컴파일이 된다.
 */
export const TOOL_NAME = {
  search: 'search_trials_multi_registry',
  get: 'get_trial_by_id',
  count: 'count_trials',
  results: 'get_trial_results',
  registries: 'list_registries_and_capabilities',
  names: 'resolve_korean_investigator_name',
} as const satisfies Record<Command, string>;

/**
 * MCP 표면에서 접는 옵션.
 *
 * `format`·`help`·`version` 은 프로세스 경계의 물건이다(출력은 항상 JSON 봉투).
 * 나머지 다섯은 **셸 사용자의 운영 옵션** 이다 — 캐시를 끄고, 원문을 받고, 커서를 잇고,
 * 글자 상한을 만지는 것. 모델이 쓸 일이 거의 없는데 31개 인자 안에 섞여 있으면 봐야 할
 * 것이 묻힌다. 빼면 오히려 더 많은 것이 보인다. **CLI 에는 그대로 있다.**
 *
 * `page-token` 을 뺀 것은 판단이다: 모델이 다음 쪽을 이어받는 일이 있을 수 있지만,
 * 이 서버의 stateless 요청 모델에서는 `page-size` 를 키우는 쪽이 낫다. 필요가 실제로
 * 나오면 되살린다.
 */
const EXCLUDED = new Set(['format', 'help', 'version', 'no-cache', 'refresh', 'raw', 'page-token', 'eligibility-chars']);

/**
 * 닫힌 어휘 축은 값 목록을 스키마에 싣는다 — `--help` 가 값을 적는 것과 같은 이유(F5·F9).
 * 모델이 값을 추측해 exit 2 를 맞고 힌트를 캐는 대신, 스키마에서 바로 본다.
 */
const ENUMS: Partial<Record<keyof typeof OPTIONS, readonly string[]>> = {
  status: FILTERABLE_STATUS,
  phase: FILTERABLE_PHASE,
  'study-type': FILTERABLE_STUDY_TYPE,
};

/** `OPTIONS` 의 정의 하나를 zod 필드 하나로. 세 종류뿐이다 — str · multi · flag. */
function fieldFor(name: keyof typeof OPTIONS): ZodTypeAny {
  const def = OPTIONS[name] as { type: 'string' | 'boolean'; multiple?: boolean };
  const values = ENUMS[name];
  const scalar = values ? z.enum(values as [string, ...string[]]) : z.string();
  // 설명은 OPTION_HELP 한 곳에서 온다 — --help 가 읽는 것과 같은 문장이다.
  const help = OPTION_HELP[name];
  if (def.type === 'boolean') return z.boolean().optional().describe(help);
  if (def.multiple) return z.array(scalar).optional().describe(help);
  // page-size 같은 수치도 CLI 는 문자열로 받아 스스로 검증한다. 여기서 숫자를 허용해
  // 두면 모델이 자연스럽게 주고, argv 로 갈 때 문자열이 된다.
  return z.union([scalar, z.number()]).optional().describe(help);
}

/**
 * 커맨드마다 도구 스키마 하나. **`COMMAND_OPTIONS` 에서 만든다** — 그 표가 CLI 의
 * 거절(`assertCommandAccepts`)과 안내(`helpFor`)를 함께 먹이는 정본이고, MCP 도 같은
 * 표를 먹어야 세 곳이 같은 말을 한다.
 */
export type ToolName = (typeof TOOL_NAME)[Command];
export function toolSchemas(): Record<ToolName, z.ZodObject<Record<string, ZodTypeAny>>> {
  const out = {} as Record<ToolName, z.ZodObject<Record<string, ZodTypeAny>>>;
  for (const cmd of COMMANDS) {
    const shape: Record<string, ZodTypeAny> = {};
    if (cmd === 'get') shape.ids = z.array(z.string()).min(1).describe('접두사 붙은 ID 들 (예: CTGOV:NCT01234567)');
    // `id` 가 아니다 — search 의 검색 축 `--id` 와 이름이 겹쳐 모델이 둘을 섞는다.
    if (cmd === 'results') shape.trial_id = z.string().describe('접두사 붙은 ID 하나 (예: CTGOV:NCT01234567)');
    if (cmd === 'names') shape.korean_name = z.string().describe('한국어 이름 (예: "김민걸"). 이 사람이 CRIS 에 등록한 로마자 표기를 찾는다');
    for (const opt of COMMAND_OPTIONS[cmd]) {
      if (EXCLUDED.has(opt)) continue;
      shape[opt] = fieldFor(opt);
    }
    out[TOOL_NAME[cmd]] = z.object(shape);
  }
  return out;
}

/**
 * **여섯 도구는 전부 읽기 전용이다.** 레지스트리를 조회만 하고 무엇도 바꾸지 않는다.
 * 설명 문장이 아니라 어노테이션으로 표시해야 호스트가 기계적으로 안다 — "확인 없이 실행해도
 * 된다" 는 판단의 근거가 된다. 외부 API 를 부르므로 `openWorldHint` 는 참이고, `registries`
 * 만 정적 선언 덤프라 거짓이다. 같은 입력에 같은 결과이므로(캐시·레지스트리 갱신을 빼면)
 * `idempotentHint` 도 참이다.
 */
export function toolAnnotations(): Record<Command, { title: string; readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: boolean }> {
  const TITLE: Record<Command, string> = {
    search: '임상시험 검색 (레지스트리 다섯)',
    get: '등록번호로 시험 조회',
    count: '임상시험 건수',
    results: '시험 결과 데이터',
    registries: '레지스트리와 능력 목록',
    names: '한국어 연구자 이름 → 등록된 로마자 표기',
  };
  const out = {} as ReturnType<typeof toolAnnotations>;
  for (const cmd of COMMANDS) {
    out[cmd] = { title: TITLE[cmd], readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: cmd !== 'registries' };
  }
  return out;
}

/**
 * **결과의 구조를 선언한다.** 모델이 `exitCode`·`envelope.registries`·`envelope.data` 같은
 * 필드 이름을 추측하지 않고 안정적으로 읽게 하려는 것이다. 봉투 안쪽(`data`)은 커맨드마다
 * 다르고 레지스트리마다 필드가 갈리므로 여기서 다 그리지 않는다 — 그건 `TrialRecordSchema`
 * 가 정본이고, 여기서는 **바깥 틀** 만 못 박는다.
 *
 * 선언하면 SDK 가 결과에 `structuredContent` 를 요구한다. `callTool` 이 text 와 함께 싣는다.
 */
export function toolOutputSchemas(): Record<Command, z.ZodObject<Record<string, ZodTypeAny>>> {
  const registryStatus = z.object({
    registry: z.string(),
    status: z.enum(['ok', 'unsupported', 'error']),
    total: z.number().optional(),
    error: z.object({ code: z.string(), message: z.string(), hint: z.string().optional() }).optional(),
  }).passthrough();
  const envelope = z.object({
    query: z.unknown(),
    registries: z.array(registryStatus).describe('레지스트리별 상태. 하나가 unsupported 여도 나머지는 ok 일 수 있다'),
    warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()).describe('반드시 읽어라 — 잘렸거나 이어받을 수 없는 것을 말한다'),
    data: z.unknown().describe('커맨드별 본문. search/get 은 TrialRecord[], count 는 {total}, names 는 {korean, variants[]}'),
    error: z.object({ code: z.string(), message: z.string(), hint: z.string().optional() }).optional(),
  }).passthrough();
  const base = {
    exitCode: z.number().describe('0 정상(0건 포함) · 2 사용법 · 3 그 레지스트리가 그렇게 물어볼 수 없음 · 4 업스트림 · 5 일부만 성공'),
    exit: z.enum(['ok', 'usage', 'unsupported', 'upstream', 'partial']),
    envelope,
    stderr: z.string().optional(),
  };
  const out = {} as Record<Command, z.ZodObject<Record<string, ZodTypeAny>>>;
  for (const cmd of COMMANDS) out[cmd] = z.object(base);
  return out;
}

/**
 * MCP 인자를 CLI argv 로. **검증은 여기서 하지 않는다** — 날짜·좌표·어휘 검사는 전부
 * `parseCliArgs` 가 하고, 그쪽이 exit 2 와 힌트를 낸다. 여기서 한 번 더 하면 규칙이
 * 두 벌이 된다.
 *
 * 대시로 시작하는 값은 등호로 붙인다. Node 의 parseArgs 가 `--near -33.8,151.2` 의 값을
 * 옵션으로 오독하는데, CLI 사용자에게는 힌트로 알려 주지만 모델은 그 힌트를 볼 기회 없이
 * 여기서 바로 맞는 모양으로 보내는 것이 낫다.
 */
export function argvFor(cmd: Command, args: ToolArgs): string[] {
  const argv: string[] = [cmd];
  if (cmd === 'get' && Array.isArray(args.ids)) argv.push(...(args.ids as string[]));
  if (cmd === 'results' && typeof args.trial_id === 'string') argv.push(args.trial_id);
  if (cmd === 'names' && typeof args.korean_name === 'string') argv.push(args.korean_name);

  for (const [name, value] of Object.entries(args)) {
    if (name === 'ids' || name === 'trial_id' || name === 'korean_name') continue;
    if (value === undefined || value === null || value === false) continue;
    if (value === true) { argv.push(`--${name}`); continue; }
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      const s = String(v);
      if (s.startsWith('-')) argv.push(`--${name}=${s}`);
      else argv.push(`--${name}`, s);
    }
  }
  argv.push('--format', 'json');
  return argv;
}

const registriesOf = (args: ToolArgs): string[] => {
  const r = args.registry;
  return Array.isArray(r) ? r.map(String) : typeof r === 'string' ? [r] : [];
};

export type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

/**
 * 도구 하나를 실행하고 결과를 MCP 모양으로 만든다.
 *
 * **`isError` 는 exit 2 에만 켠다.** 사용법 오류는 모델이 인자를 고쳐야 하는 일이라
 * 도구 오류가 맞다. 그런데 exit 3(미지원)·4(업스트림)·5(부분)는 다르다 — 요청은 옳았고
 * 세상이 그렇게 답한 것이다. 이것들까지 오류로 내면 모델이 미지원을 자기 실수로 읽고
 * 인자를 바꿔 가며 헤맨다. **0건(exit 0)은 당연히 오류가 아니다.**
 *
 * 종료 코드는 본문 첫 필드로 싣는다. 봉투 안에도 레지스트리별 상태가 있지만, 셸 사용자가
 * `$?` 로 갈라 온 것을 MCP 소비자도 한 눈에 갈라야 한다.
 */
export async function callTool(cmd: Command, args: ToolArgs, env: NodeJS.ProcessEnv = process.env): Promise<ToolResult> {
  const out: string[] = [];
  const err: string[] = [];
  const started = Date.now();
  const exitCode: ExitCode = await run(argvFor(cmd, args), { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }, env);
  /**
   * 호출 통계. **인자는 넘기지 않는다** — `record` 가 받는 것은 도구·레지스트리·종료코드·
   * 소요시간뿐이고, 검색어는 여기서 이미 끊긴다. 레지스트리는 봉투가 아니라 인자에서 읽는다:
   * 봉투를 파싱하기 전이라서다. `all` 은 CLI 가 풀기 전의 값 그대로 남긴다.
   */
  record(loadConfig(env).cacheDir, {
    at: new Date(started).toISOString(),
    tool: cmd,
    registries: registriesOf(args),
    exitCode,
    ms: Date.now() - started,
  });

  let envelope: unknown;
  try {
    envelope = JSON.parse(out.join(''));
  } catch {
    // stdout 은 성공이든 실패든 봉투를 낸다는 것이 CLI 의 약속이다. 깨졌다면 그것 자체가
    // 보고할 일이지 여기서 지어낼 일이 아니다.
    envelope = { raw: out.join('') };
  }
  const body = { exitCode, exit: EXIT_NAME[exitCode], envelope, ...(err.length ? { stderr: err.join('') } : {}) };
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    // outputSchema 를 선언했으므로 구조화된 사본도 싣는다 — text 와 같은 내용이다.
    structuredContent: body as unknown as Record<string, unknown>,
    ...(exitCode === EXIT.USAGE ? { isError: true } : {}),
  };
}

const EXIT_NAME: Record<ExitCode, string> = {
  [EXIT.OK]: 'ok',
  [EXIT.USAGE]: 'usage',
  [EXIT.UNSUPPORTED]: 'unsupported',
  [EXIT.UPSTREAM]: 'upstream',
  [EXIT.PARTIAL]: 'partial',
};

/**
 * 도구 설명. Anthropic 의 Clinical Trials 서버가 쓰는 구조(언제 쓰나 / 다른 도구를 쓸 때 /
 * 팁)를 따른다 — 모델이 그 모양에 익숙하다. 그 위에 **이 서버만의 것** 을 앞세운다:
 * 레지스트리 다섯, exit 3 의 뜻, 한국어 대조. `instructions` 에만 두면 그것을 안 읽는
 * 호스트에서 사라지므로 도구 설명 안에 있어야 한다.
 */
const DESCRIPTION: Record<Command, string> = {
  search: `임상시험을 찾는다. 레지스트리 다섯(미국 ctgov·영국 isrctn·EU ctis·한국 cris·WHO ictrp)을 하나의 스키마로.

언제 쓰나:
- 질환·약물·의뢰기관·연구자·지역으로 시험을 찾을 때
- 여러 나라 레지스트리를 한 번에 볼 때 → registry: ["all"]

다른 도구를 쓸 때:
- 등록번호를 이미 알면 → get_trial_by_id
- 몇 건인지만 필요하면 → count_trials (빠르다)
- 한 시험의 결과 데이터(평가변수·이상반응)는 → get_trial_results
- 어느 레지스트리가 어느 축을 받는지 모르면 → list_registries_and_capabilities 를 먼저

결과 읽는 법 — 본문의 exitCode:
- 0: 정상. **0건도 0이다** — "그런 시험이 없다"는 정상 답이다
- 3: **그 레지스트리가 그렇게 물어볼 수 없다.** 빈 결과가 아니다 — 다른 축으로 다시 물어라
- 5: 여러 레지스트리 중 일부만 성공. registries[] 에 어느 곳이 왜 안 됐는지 있다
- warnings 를 반드시 읽어라 — 잘렸거나 이어받을 수 없는 것을 거기서 말한다

사용자에게 답할 때 — 시험마다 이 순서로, 한 줄에 하나:
  등록번호(접두사 포함) · 제목 · 상태 · 단계 · 의뢰기관 · 나라 · 링크(url 필드)
그 앞에 한 줄로: 어느 레지스트리에서 몇 건이었고 어느 곳이 왜 안 됐는지(registries[]).
그 뒤에 warnings 가 있으면 그대로. 목록이 잘렸으면(locations_truncated·no_pagination) 잘렸다고 말하라.
**적격 판정처럼 쓰지 마라** — 레지스트리 기재사항은 스크리닝을 대체하지 않는다.

팁:
- 한국어 연구자 이름은 **resolve_korean_investigator_name 을 먼저** — 등록된 로마자 표기를 전부 알려준다. 표기가 다르면 다른 사람으로 취급된다
- cris 는 term 축 하나뿐이다 — condition 을 주면 exit 3 이다
- 레지스트리마다 status·phase 가 실제로 걸리는지 다르다 — list_registries_and_capabilities 의 scope 가 말한다`,

  count: `search 와 같은 축·필터로 개수만 센다.

언제 쓰나:
- "X 시험이 몇 건이나 있나" 같은 물음
- 검색어를 좁히기 전에 규모를 볼 때

다른 도구를 쓸 때:
- 레코드가 필요하면 → search_trials_multi_registry

사용자에게 답할 때: 레지스트리별 건수를 각각 적고, 합계는 적지 마라 — 같은 시험이 여러 곳에 등록될 수 있다.

레지스트리별 수는 registries[] 에 따로 있다. 합치지 마라 — 같은 시험이 여러 곳에 등록될 수 있다.`,

  get: `등록번호로 시험을 가져온다. 검색이 아니라 조회다.

언제 쓰나:
- 번호를 이미 알 때 (예: "CTGOV:NCT01234567", "CRIS:KCT0012487")
- 여러 건을 한 번에 — ids 배열

접두사가 필요하다: CTGOV: · ISRCTN: · CTIS: · CRIS: · ICTRP:. 같은 시험이 두 레지스트리에 있으면 각각 다른 사본이다.
검색 응답보다 두껍다 — cris 는 여기서만 진짜 모집상태와 연구책임자(국문·영문)가 온다.

사용자에게 답할 때: 등록번호 · 제목 · 상태(statusRaw 가 있으면 원문도) · 단계 · 의뢰기관 · 연구책임자(contacts) · 나라 · 기간(dates) · 링크. 못 찾은 번호는 not_found 경고로 오니 그 번호를 따로 적어라.

다른 도구를 쓸 때:
- 번호를 모르면 → search_trials_multi_registry
- 결과 데이터는 → get_trial_results`,

  results: `한 시험의 결과 데이터 — 1차·2차 평가변수 값, 이상반응, 참가자 흐름, 기저 특성.

언제 쓰나:
- "이 시험의 결과가 어땠나", "이상반응이 무엇이었나"

**구조화된 결과를 주는 레지스트리는 ctgov 뿐이다.** isrctn·ctis 는 결과가 PDF 라 exit 3 이고, cris 는 공개 API 가 결과를 내주지 않는다. 결과가 있는지 여부만은 레코드의 hasResults 로 미리 알 수 있다.

기본은 요약이다. section 으로 좁히고, outcome/ae-organ/ae-term 으로 펼칠 것을 고른다. full 은 페이로드가 크다.

사용자에게 답할 때: 평가변수는 이름 · 측정 시점 · 군별 값 순으로, 이상반응은 기관계별로 묶어 건수와 함께. 요약(results_summarized·results_partially_expanded) 경고가 있으면 "전부가 아니다" 를 먼저 말하라.`,

  names: `한국어 이름을 **실제로 등록된** 로마자 표기로 바꾼다. 이 서버만 할 수 있는 일이다.

언제 쓰나:
- 사용자가 한국어 이름으로 연구자를 물었을 때, **다른 레지스트리를 검색하기 전에 먼저**
- "이 사람 이름이 영어로 어떻게 등록돼 있나"

왜 필요한가:
로마자 표기가 결과를 가른다. 실측: ctgov 에서 "Min-Gul Kim" 45건, "Mingul Kim" 17건 — 겹치지 않는다.
이름을 직접 영어로 옮기면 둘 중 하나를 고르게 되고, 어느 쪽이든 절반을 놓친 채 자신 있게 답한다.
CRIS(한국)는 국문·영문을 나란히 싣는 이중언어 레지스트리라 본인이 등록한 표기를 그대로 읽을 수 있다.

쓰는 법:
- term 이 필수다 — CRIS 는 사람 이름으로 거를 수 없어 후보를 좁힐 말(기관명·연구 주제)이 있어야 한다
- 결과의 variants 가 표기 목록이다. 많이 쓴 것이 먼저. 오타도 별개 표기로 나온다 — 합치지 마라
- ctgov: true 를 주면 표기마다 ctgov 건수를 함께 낸다 → 어느 표기로 물어야 하는지 바로 보인다
- 그다음 search 에 investigator 로 그 표기들을 **하나씩** 물어라. 건수는 겹칠 수 있으니 더하지 마라

사용자에게 답할 때 — 표기마다 한 줄, 많이 쓴 것부터:
  표기 · CRIS 에서 그 표기로 등록된 시험 수 · (ctgov 를 켰으면) ctgov 건수
그 앞에: 어느 term 으로 좁혀 CRIS 몇 건을 대조했는지(crisMatched). 이 수가 작으면 표기 목록도 불완전할 수 있다고 말하라.
표기별 건수를 합치지 마라. 오타처럼 보이는 표기도 "등록된 표기" 라고 그대로 적어라.

빈 결과는 "그런 사람이 없다" 가 아니다 — 국내 등록이 없거나 term 이 닿지 않은 것이다. 다른 term 으로 다시 물어라.`,

  registries: `이 서버가 다루는 레지스트리 다섯과 각각이 무엇을 할 수 있는지.

언제 쓰나:
- **다른 도구를 부르기 전에 먼저.** 네트워크를 타지 않아 공짜다
- 어느 레지스트리가 어느 축(condition·investigator·location…)을 받는지, 어떤 값을 받는지
- exit 3 을 받았을 때 — 왜 안 되는지가 그 축의 scope 에 있다

레지스트리마다 능력이 크게 다르다: ctgov 는 축 18개, cris 는 2개. 이 도구가 그 차이를 그대로 낸다.

사용자에게 답할 때: 레지스트리마다 한 줄 — 키 · 이름 · 나라/권역 · 지원 축 수 · 접근 조건(키 필요·기본 꺼짐). 사용자가 특정 축을 물었으면 그 축의 scope 를 레지스트리별로 인용하라.`,
};

export const toolDescriptions = (): Record<Command, string> => DESCRIPTION;

/**
 * 서버를 만든다. 도구 다섯 = 커맨드 다섯. §1.2 의 비목표("업스트림 API 를 그대로 비추는
 * 범용 미러")를 피하려면 도구가 **우리 커맨드** 여야지 레지스트리의 엔드포인트여선 안 된다.
 */
export function createServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer(
    { name: 'ctreg', version: readVersion() },
    {
      instructions:
        '임상시험 레지스트리 다섯 곳(ClinicalTrials.gov, ISRCTN, WHO ICTRP, CRIS, EU CTIS)을 하나의 스키마로 조회한다. ' +
        '결과 본문의 exitCode 로 분기하라: 0 정상(0건 포함) · 2 사용법 오류 · 3 그 레지스트리가 그렇게 물어볼 수 없음 · ' +
        '4 업스트림 실패 · 5 일부 레지스트리만 성공. 3 은 빈 결과가 아니다. 봉투의 warnings 를 반드시 읽어라 — ' +
        '잘리거나 이어받을 수 없는 것을 거기서 말한다. 한국어 이름·용어는 cris 에 먼저 물어 등록된 영문 표기를 읽어라. ' +
        '이 도구의 출력은 임상시험 적격 판정이 아니다.',
    },
  );
  const schemas = toolSchemas();
  const annotations = toolAnnotations();
  const outputs = toolOutputSchemas();
  for (const cmd of COMMANDS) {
    const name = TOOL_NAME[cmd];
    server.registerTool(
      name,
      {
        title: annotations[cmd].title,
        description: DESCRIPTION[cmd],
        inputSchema: schemas[name].shape,
        outputSchema: outputs[cmd].shape,
        annotations: annotations[cmd],
      },
      async (args: ToolArgs) => callTool(cmd, args, env),
    );
  }
  return server;
}
