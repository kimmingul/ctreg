import { createAdapters } from '../adapters/index.js';
import type { RegistryAdapter } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import { loadConfig } from '../runtime/config.js';
import { CtregError, usageError } from '../runtime/errors.js';
import type { HttpDeps } from '../runtime/http.js';
import { USAGE, helpFor, parseCliArgs } from './args.js';
import { runCount } from './commands/count.js';
import { IdRoutingError, runGet } from './commands/get.js';
import { runRegistries } from './commands/registries.js';
import { runResults } from './commands/results.js';
import { runSearch } from './commands/search.js';
import { EXIT, type ExitCode } from './exit-codes.js';
import { type Envelope, exitFor, render } from './output.js';

export type Io = { stdout(s: string): void; stderr(s: string): void };
export type RunDeps = { adapters?: Partial<Record<RegistryKey, RegistryAdapter>>; http?: HttpDeps };

export async function run(
  argv: string[],
  io: Io,
  env: NodeJS.ProcessEnv = process.env,
  deps: RunDeps = {},
): Promise<ExitCode> {
  let format: 'json' | 'ndjson' | 'text' = 'json';
  try {
    const args = parseCliArgs(argv);
    format = args.format;
    if (args.help) {
      // 커맨드와 함께 물었으면 그 커맨드의 표면만 낸다(F3). 예전에는 커맨드 단어가
      // 파싱에서 버려져 `ctreg get --help` 가 최상위 사용법과 바이트 단위로 같았다.
      io.stdout(args.command ? helpFor(args.command) : USAGE);
      return EXIT.OK;
    }

    const cfg = loadConfig(env);
    const adapters = deps.adapters ?? createAdapters(cfg, deps.http);

    // COMMANDS 의 다섯 커맨드를 모두 덮는다. default 케이스를 두지 않는 것이 의도다 —
    // COMMANDS 에 커맨드를 더하면 envelope 이 확실히 대입되지 않아 컴파일이 깨지고,
    // 런타임에 "아직 연결되지 않았습니다" 를 만나는 대신 빌드에서 잡힌다.
    // help 가 아니면 커맨드는 반드시 있다 — `parseCliArgs` 가 모르는 커맨드를 exit 2 로
    // 이미 막는다. 타입은 그 사실을 모르므로 여기서 좁히고, 전제가 깨지면 조용히
    // 넘어가는 대신 사용법 오류로 나간다. 아래 switch 에 default 를 두지 않는 것이
    // 의도이므로(커맨드를 더하면 컴파일이 깨진다) 좁히는 자리가 여기여야 한다.
    if (!args.command) throw usageError('커맨드가 없습니다', USAGE);

    let envelope: Envelope;
    switch (args.command) {
      case 'registries': envelope = runRegistries(args, adapters); break;
      case 'count': envelope = await runCount(args, adapters); break;
      case 'search': envelope = await runSearch(args, adapters); break;
      case 'get': envelope = await runGet(args, adapters); break;
      case 'results': envelope = await runResults(args, adapters); break;
    }

    io.stdout(render(envelope, format));
    return exitFor(envelope);
  } catch (e) {
    const err = CtregError.is(e)
      ? { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }
      : { code: 'internal', message: (e as Error).message };
    // 던진 오류가 경고를 들고 왔으면 봉투에 옮긴다 — get 의 라우팅 실패처럼 나쁜 ID
    // 가 여럿일 때, 최상위 error 는 하나만 이름 부를 수 있어서 나머지가 사라진다.
    const envelope: Envelope = {
      query: {},
      registries: [],
      warnings: IdRoutingError.is(e) ? e.warnings : [],
      data: null,
      error: err,
    };
    io.stdout(render(envelope, format));
    // 사용법은 사람이 읽는 것이므로 stderr 로도 낸다. stdout 은 실패 사유까지 포함해
    // 언제나 파싱 가능한 봉투를 낸다 — 커맨드를 식별하지 못한 경우도 예외가 아니다.
    // 스킬 입장에서 규칙이 하나여야 한다: "stdout 은 항상 파싱되고, 실패하면 error
    // 를 담는다." 커맨드 인식 실패만 stdout 을 비우는 특례를 두면, 그 특례를 잊었을
    // 때 빈 문자열에 대한 JSON 파싱 에러가 나는데 그건 무엇이 잘못됐는지 아무 정보도
    // 안 준다.
    if (err.code === 'usage') io.stderr(`${err.message}\n\n${USAGE}`);
    return CtregError.is(e) ? e.exit : EXIT.UPSTREAM;
  }
}
