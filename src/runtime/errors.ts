import { EXIT, type ExitCode } from '../cli/exit-codes.js';

/**
 * 참조 구현이 `@cyanheads/mcp-ts-core/errors` 의 팩토리로 하던 일을 로컬에서 한다.
 * `hint` 는 업스트림 400 응답을 회복 가능한 문장으로 번역한 것이다.
 */
export class CtregError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly exit: ExitCode,
    readonly hint?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CtregError';
  }

  static is(e: unknown): e is CtregError {
    return e instanceof CtregError;
  }
}

export const usageError = (message: string, hint?: string) =>
  new CtregError(message, 'usage', EXIT.USAGE, hint);

/** 레지스트리가 요청한 축으로 검색할 수 없을 때 쓴다 — 빈 결과를 돌려주면 "없다" 로 오독된다. */
export const unsupportedError = (message: string, hint?: string) =>
  new CtregError(message, 'unsupported', EXIT.UNSUPPORTED, hint);

export const upstreamError = (message: string, hint?: string, cause?: unknown) =>
  new CtregError(message, 'upstream', EXIT.UPSTREAM, hint, { cause });

export const rateLimitedError = (message: string, hint?: string) =>
  new CtregError(message, 'rate_limited', EXIT.UPSTREAM, hint);
