import { describe, expect, it } from 'vitest';
import { REGISTRY_KEYS, formatTrialId, isRegistryKey, parseTrialId } from '../../src/core/registry.js';
import { CtregError } from '../../src/runtime/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

describe('ID 정규화', () => {
  it('슬라이스 1 의 레지스트리는 ctgov 하나다', () => {
    expect(REGISTRY_KEYS).toEqual(['ctgov']);
    expect(isRegistryKey('ctgov')).toBe(true);
    expect(isRegistryKey('ictrp')).toBe(false);
  });

  it('접두사가 붙은 정규형을 파싱한다', () => {
    expect(parseTrialId('CTGOV:NCT01234567')).toEqual({
      registry: 'ctgov',
      registryId: 'NCT01234567',
      id: 'CTGOV:NCT01234567',
    });
  });

  it('접두사가 없으면 패턴으로 레지스트리를 추론한다', () => {
    expect(parseTrialId('NCT01234567').registry).toBe('ctgov');
    expect(parseTrialId('NCT01234567').id).toBe('CTGOV:NCT01234567');
  });

  it('접두사와 원문 ID 의 대소문자를 정규화한다', () => {
    expect(parseTrialId('ctgov:nct01234567').id).toBe('CTGOV:NCT01234567');
  });

  it('아직 없는 레지스트리 접두사는 exit 3 이다 — 문법은 맞고 지원이 없는 것', () => {
    try {
      parseTrialId('ISRCTN:12345678');
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect(CtregError.is(e)).toBe(true);
      expect((e as CtregError).exit).toBe(EXIT.UNSUPPORTED);
    }
  });

  it('추론 불가능한 문자열은 exit 2 다', () => {
    try {
      parseTrialId('garbage');
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).hint).toContain('CTGOV:');
    }
  });

  it('formatTrialId 는 parseTrialId 의 역이다', () => {
    expect(formatTrialId('ctgov', 'NCT01234567')).toBe('CTGOV:NCT01234567');
  });
});
