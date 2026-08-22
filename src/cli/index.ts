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
    const err = CtregError.is(e)
      ? { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }
      : { code: 'internal', message: (e as Error).message };
    const envelope: Envelope = { query: {}, registries: [], warnings: [], data: null, error: err };
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
