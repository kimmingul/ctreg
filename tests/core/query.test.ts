import { describe, expect, it } from 'vitest';
import { CAPS } from '../../src/core/query.js';

// 스펙 §5.2 의 바운딩 표를 그대로 리터럴로 박아 둔다. CAPS 를 CAPS 자신과 비교하면
// 오타가 있어도 항상 통과하므로, 반드시 스펙의 숫자와 대조해야 한다.
describe('CAPS — 스펙 §5.2 바운딩 캡', () => {
  it('pageSize: 기본 20, 최대 200', () => {
    expect(CAPS.pageSize).toEqual({ default: 20, max: 200 });
  });

  it('locations: 기본 10, 최대 200', () => {
    expect(CAPS.locations).toEqual({ default: 10, max: 200 });
  });

  it('eligibilityChars: 기본 8000, 최대 40000', () => {
    expect(CAPS.eligibilityChars).toEqual({ default: 8000, max: 40000 });
  });

  it('outcomes: 기본 20, 최대 200', () => {
    expect(CAPS.outcomes).toEqual({ default: 20, max: 200 });
  });
});
