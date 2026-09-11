import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { COMMAND_OPTIONS, COMMANDS, OPTION_HELP, OPTIONS } from '../cli/args.js';
import { EXIT } from '../cli/exit-codes.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../core/vocab.js';
import { callTool, TOOL_NAME } from './server.js';

/**
 * 검색 웹페이지와 그것이 부르는 JSON API — **다섯 번째 껍데기** 다.
 *
 * 페이지는 MCP 클라이언트가 아니다. JSON-RPC 대신 평범한 POST 로 `/api/<커맨드>` 를 부르고,
 * 그 뒤는 `callTool` 그대로다 — MCP 와 같은 봉투, 같은 exitCode, 같은 요청률 버킷. 코어를
 * 새로 쓰지 않는다.
 *
 * **이 파일의 경로(`/api/<커맨드>`)에는 모델이 끼지 않는다.** 검색창의 문법(`status:recruiting`)이
 * 조건으로 바로 간다 — AI 모드를 끈 사용자의 길이다. 빠르고 공짜이고 "조용히 틀린 답" 이 끼어들
 * 자리가 없다. AI 모드(기본)는 다른 파일이다 — `agent.ts` 가 모델에게 MCP 와 같은 도구를 주고
 * 루프를 돌린다(`/api/agent`). 처음에는 이 페이지 전체가 "모델 없음" 이었고 그 뒤 분류기 하나를
 * 끼웠다가(`ask.ts`) 에이전트로 갔다 — 경위는 정본의 「AI 모드」·「에이전트」 절.
 *
 * **검색창 문법의 키는 손으로 적지 않는다.** `/api/schema` 가 `OPTION_HELP` 를 그대로 내고
 * 페이지가 그것으로 `key:value` 를 푼다 — MCP 스키마와 `--help` 가 읽는 그 표다.
 */

type Command = (typeof COMMANDS)[number];
const isCommand = (s: string): s is Command => (COMMANDS as readonly string[]).includes(s);

/** 페이지에 노출하지 않는 옵션 — MCP 와 같은 목록에 format 을 더한 것. 셸 사용자의 것들이다. */
const HIDDEN = new Set(['format', 'help', 'version', 'no-cache', 'refresh', 'raw', 'page-token', 'eligibility-chars']);

const VALUES: Partial<Record<keyof typeof OPTIONS, readonly string[]>> = {
  status: FILTERABLE_STATUS,
  phase: FILTERABLE_PHASE,
  'study-type': FILTERABLE_STUDY_TYPE,
};

/** 페이지가 뜰 때 한 번 받는다. 커맨드마다 어떤 칸을 그릴지, 각 칸이 무엇인지. */
export function schema(): {
  commands: Record<Command, { summary: string; toolName: string; options: { name: string; help: string; type: 'string' | 'boolean'; multiple: boolean; values?: readonly string[] }[] }>;
} {
  const SUMMARY: Record<Command, string> = {
    search: '조건으로 시험을 찾는다',
    count: '조건에 맞는 시험이 몇 건인지',
    get: '등록번호로 시험을 가져온다',
    results: '한 시험의 결과 데이터',
    registries: '레지스트리 다섯과 각각의 능력',
    names: '한국어 이름 → CRIS 에 등록된 로마자 표기',
  };
  const commands = {} as ReturnType<typeof schema>['commands'];
  for (const cmd of COMMANDS) {
    const options = COMMAND_OPTIONS[cmd]
      .filter((o) => !HIDDEN.has(o))
      .map((o) => {
        const def = OPTIONS[o] as { type: 'string' | 'boolean'; multiple?: boolean };
        const values = VALUES[o];
        return { name: o, help: OPTION_HELP[o], type: def.type, multiple: def.multiple ?? false, ...(values ? { values } : {}) };
      });
    commands[cmd] = { summary: SUMMARY[cmd], toolName: TOOL_NAME[cmd], options };
  }
  return { commands };
}

export type ApiResponse = { status: number; body: unknown };

/**
 * `/api/<커맨드>` — 본문의 JSON 을 인자로 `callTool` 을 부른다.
 *
 * HTTP 상태는 종료 코드를 **그대로 옮기지 않는다.** exit 3(미지원)·4(업스트림)·5(부분)는
 * 요청이 옳았고 세상이 그렇게 답한 것이라 200 이다 — 페이지가 봉투를 열어 "이 레지스트리는
 * 그렇게 물어볼 수 없다" 를 따로 그린다. exit 2(사용법)만 400 이다: 페이지가 고쳐야 할 입력이다.
 * MCP 의 isError 를 exit 2 에만 켜는 것과 같은 판단이다.
 *
 * `names` 는 한 번에 하나만. CRIS 후보를 하나씩 여는 데 1~3분이 걸리고 그동안 요청률 버킷
 * (1 req/s)을 혼자 쓴다 — 둘이 겹치면 둘 다 두 배로 늦고 다른 도구까지 막힌다. 두 번째는
 * 기다리게 하지 않고 429 로 돌려보낸다: 기다리게 하면 사용자는 왜 멈췄는지 모르고, 돌려보내면
 * 페이지가 "지금 다른 대조가 진행 중" 을 보여줄 수 있다. 프로세스 하나가 전제다(인스턴스가
 * 하나라는 배포 조건과 같은 것). 여럿이 되면 이 락도 공유 저장소로 옮겨야 한다.
 */
let namesInFlight = false;
export const NAMES_BUSY = { status: 429, body: { error: 'names_busy', message: '다른 이름 대조가 진행 중이다. 1~3분 뒤 다시 시도해라 — 서버가 한 번에 하나만 처리한다.' } } as const;
/** 락을 잡으면 true. AI 모드의 이름만 경로(CRIS 대조)도 같은 락을 쓴다. */
export function acquireNames(): boolean { if (namesInFlight) return false; namesInFlight = true; return true; }
export function releaseNames(): void { namesInFlight = false; }

export async function api(path: string, rawBody: string, env: NodeJS.ProcessEnv = process.env): Promise<ApiResponse> {
  const cmd = path.replace(/^\/api\//, '');
  if (!isCommand(cmd)) return { status: 404, body: { error: `unknown command: ${cmd}` } };
  let args: Record<string, unknown>;
  try {
    args = rawBody.trim() === '' ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
  } catch {
    return { status: 400, body: { error: 'body must be JSON' } };
  }
  if (cmd === 'names' && !acquireNames()) return NAMES_BUSY;
  try {
    const r = await callTool(cmd, args, env);
    const body = r.structuredContent as { exitCode: number };
    return { status: body.exitCode === EXIT.USAGE ? 400 : 200, body };
  } finally {
    if (cmd === 'names') releaseNames();
  }
}

/**
 * 검색 페이지. 패키지에 실린 정적 HTML 한 장이다 — 프레임워크도 빌드도 없다. 부팅 때 한 번
 * 읽고 메모리에 둔다. `import.meta.url` 기준이라 어디서 실행하든 같은 파일이다(version.ts 와
 * 같은 이유).
 */
let pageCache: string | undefined;
export function page(): string {
  if (pageCache === undefined) {
    const require = createRequire(import.meta.url);
    pageCache = readFileSync(require.resolve('../../web/index.html'), 'utf8');
  }
  return pageCache;
}
