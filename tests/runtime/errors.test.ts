import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import {
  CtregError,
  rateLimitedError,
  unsupportedError,
  upstreamError,
  usageError,
} from '../../src/runtime/errors.js';

describe('에러 taxonomy', () => {
  it('exit code 는 스펙에 고정된 숫자다', () => {
    expect(EXIT).toEqual({ OK: 0, USAGE: 2, UNSUPPORTED: 3, UPSTREAM: 4, PARTIAL: 5 });
  });

  it('usageError 는 exit 2 를 실어 나른다', () => {
    const e = usageError('bad flag', '--near 는 좌표를 요구한다');
    expect(e).toBeInstanceOf(Error);
    expect(e.exit).toBe(EXIT.USAGE);
    expect(e.code).toBe('usage');
    expect(e.hint).toBe('--near 는 좌표를 요구한다');
  });

  it('미지원 capability 는 exit 3 이다 — 빈 결과가 아니다', () => {
    expect(unsupportedError('geo unsupported').exit).toBe(EXIT.UNSUPPORTED);
  });

  it('업스트림 실패와 요청률 초과는 모두 exit 4 이지만 code 로 구분된다', () => {
    expect(upstreamError('502').exit).toBe(EXIT.UPSTREAM);
    expect(upstreamError('502').code).toBe('upstream');
    expect(rateLimitedError('429 exhausted').exit).toBe(EXIT.UPSTREAM);
    expect(rateLimitedError('429 exhausted').code).toBe('rate_limited');
  });

  it('cause 를 보존한다', () => {
    const root = new Error('socket hang up');
    expect(upstreamError('failed', undefined, root).cause).toBe(root);
  });

  it('CtregError 가 아닌 에러도 판별할 수 있다', () => {
    expect(CtregError.is(usageError('x'))).toBe(true);
    expect(CtregError.is(new Error('x'))).toBe(false);
  });
});
