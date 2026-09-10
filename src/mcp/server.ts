import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import { COMMAND_OPTIONS, COMMANDS, OPTIONS } from '../cli/args.js';
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

/** 출력 형식은 MCP 가 정한다(항상 JSON 봉투). 나머지 둘은 프로세스 경계의 물건이다. */
const EXCLUDED = new Set(['format', 'help', 'version']);

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
  if (def.type === 'boolean') return z.boolean().optional();
  if (def.multiple) return z.array(scalar).optional();
  // page-size 같은 수치도 CLI 는 문자열로 받아 스스로 검증한다. 여기서 숫자를 허용해
  // 두면 모델이 자연스럽게 주고, argv 로 갈 때 문자열이 된다.
  return z.union([scalar, z.number()]).optional();
}

/**
 * 커맨드마다 도구 스키마 하나. **`COMMAND_OPTIONS` 에서 만든다** — 그 표가 CLI 의
 * 거절(`assertCommandAccepts`)과 안내(`helpFor`)를 함께 먹이는 정본이고, MCP 도 같은
 * 표를 먹어야 세 곳이 같은 말을 한다.
 */
export function toolSchemas(): Record<Command, z.ZodObject<Record<string, ZodTypeAny>>> {
  const out = {} as Record<Command, z.ZodObject<Record<string, ZodTypeAny>>>;
  for (const cmd of COMMANDS) {
    const shape: Record<string, ZodTypeAny> = {};
    if (cmd === 'get') shape.ids = z.array(z.string()).min(1).describe('접두사 붙은 ID 들 (예: CTGOV:NCT01234567)');
    // `id` 가 아니다 — search 의 검색 축 `--id` 와 이름이 겹쳐 모델이 둘을 섞는다.
    if (cmd === 'results') shape.trial_id = z.string().describe('접두사 붙은 ID 하나 (예: CTGOV:NCT01234567)');
    for (const opt of COMMAND_OPTIONS[cmd]) {
      if (EXCLUDED.has(opt)) continue;
      shape[opt] = fieldFor(opt);
    }
    out[cmd] = z.object(shape);
  }
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

  for (const [name, value] of Object.entries(args)) {
    if (name === 'ids' || name === 'trial_id') continue;
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

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

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

const DESCRIPTION: Record<Command, string> = {
  search: '검색 축과 필터로 임상시험을 찾는다. 레코드를 받는다. 결과 0건은 정상(exit 0)이고, exit 3 은 "그 레지스트리가 그렇게 물어볼 수 없다" 는 뜻이다 — 빈 결과와 다르다.',
  count: 'search 와 같은 축·필터로 개수만 센다. 레코드를 받지 않아 빠르다.',
  get: '접두사 붙은 ID 여럿을 한 번에 가져온다. 검색이 아니라 조회다.',
  results: 'ID 하나의 결과 데이터(평가변수·이상반응·흐름·기저)를 낸다. 구조화된 결과를 주는 레지스트리는 ctgov 뿐이다.',
  registries: '이 빌드가 다루는 레지스트리와 각 축이 무엇을 보는지 낸다. 네트워크를 타지 않는다. 다른 도구를 부르기 전에 먼저 불러라.',
};

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
  for (const cmd of COMMANDS) {
    server.registerTool(
      cmd,
      { description: DESCRIPTION[cmd], inputSchema: schemas[cmd].shape },
      async (args: ToolArgs) => callTool(cmd, args, env),
    );
  }
  return server;
}
