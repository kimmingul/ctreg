import { createAdapters } from '../adapters/index.js';
import type { RegistryAdapter } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import { loadConfig } from '../runtime/config.js';
import { CtregError, usageError } from '../runtime/errors.js';
import type { HttpDeps } from '../runtime/http.js';
import { USAGE, parseCliArgs } from './args.js';
import { runCount } from './commands/count.js';
import { runRegistries } from './commands/registries.js';
import { EXIT, type ExitCode } from './exit-codes.js';
import { type Envelope, exitFor, render } from './output.js';

export type Io = { stdout(s: string): void; stderr(s: string): void };
export type RunDeps = { adapters?: Record<RegistryKey, RegistryAdapter>; http?: HttpDeps };

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
      io.stdout(USAGE);
      return EXIT.OK;
    }

    const cfg = loadConfig(env);
    const adapters = deps.adapters ?? createAdapters(cfg, deps.http);

    // Task 15 에서 search / get / results 케이스를 여기에 더한다.
    let envelope: Envelope;
    switch (args.command) {
      case 'registries': envelope = runRegistries(args, adapters); break;
      case 'count': envelope = await runCount(args, adapters); break;
      default:
        throw usageError(`'${args.command}' 는 아직 연결되지 않았습니다`, USAGE);
    }

    io.stdout(render(envelope, format));
    return exitFor(envelope);
  } catch (e) {
    // 커맨드 자체를 식별하지 못한 경우(비어 있거나 모르는 커맨드) args.ts 는 힌트로
    // USAGE 전문을 그대로 준다 — 이때는 구조화할 질의도 커맨드도 없으므로 사람이
    // 읽는 사용법만 stderr 로 내고 stdout 은 비워 둔다. stdout 이 "항상 파싱 가능"
    // 해야 한다는 계약은 "항상 무언가를 담아야 한다"는 뜻이 아니다 — 빈 문자열도
    // 유효하게 파싱 실패하는 게 아니라 애초에 아무 것도 안 쓴 것이다.
    // 커맨드는 식별됐지만(예: search) 그 안에서 옵션이 잘못된 경우는 다르다 — 스킬이
    // 이미 어떤 커맨드를 불렀는지 알고 있으므로, 실패 사유를 담은 봉투를 stdout 에
    // 내어 기계가 파싱해 재시도 방법을 알 수 있게 한다.
    if (CtregError.is(e) && e.hint === USAGE) {
      io.stderr(`${e.message}\n\n${USAGE}`);
      return e.exit;
    }
    const err = CtregError.is(e)
      ? { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }
      : { code: 'internal', message: (e as Error).message };
    const envelope: Envelope = { query: {}, registries: [], warnings: [], data: null, error: err };
    io.stdout(render(envelope, format));
    return CtregError.is(e) ? e.exit : EXIT.UPSTREAM;
  }
}
