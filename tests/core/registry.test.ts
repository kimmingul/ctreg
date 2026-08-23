import { describe, expect, it } from 'vitest';
import { REGISTRY_KEYS, formatTrialId, isRegistryKey, parseTrialId } from '../../src/core/registry.js';
import { CtregError } from '../../src/runtime/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

describe('ID 정규화', () => {
  it('등록된 레지스트리는 ctgov 와 isrctn 이다', () => {
    expect(REGISTRY_KEYS).toEqual(['ctgov', 'isrctn']);
    expect(isRegistryKey('ctgov')).toBe(true);
    expect(isRegistryKey('isrctn')).toBe(true);
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

  it('접두사 없는 소문자 ID 도 추론 정규식이 대소문자 구분 없이 잡는다', () => {
    expect(parseTrialId('nct01234567').id).toBe('CTGOV:NCT01234567');
  });

  /**
   * 예전엔 이 프로브가 `ISRCTN:` 이었다 — 두 번째 어댑터가 붙으면서 진짜 키가 됐고
   * 테스트가 거짓 실패했다(선결 조건 문서의 M4 가 예고한 자리다). 후보 목록에 있는
   * 이름을 "없는 것" 의 대역으로 쓰면 그 후보가 실현될 때마다 같은 일이 반복되므로,
   * 레지스트리 이름이 될 리 없는 문자열을 쓴다.
   */
  it('등록되지 않은 레지스트리 접두사는 exit 3 이다 — 문법은 맞고 지원이 없는 것', () => {
    try {
      parseTrialId('nosuchreg:12345678');
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

describe('ISRCTN 식별자', () => {
  it('접두사가 붙은 형태를 라우팅한다', () => {
    const r = parseTrialId('ISRCTN:ISRCTN30583116');
    expect(r).toEqual({ registry: 'isrctn', registryId: 'ISRCTN30583116', id: 'ISRCTN:ISRCTN30583116' });
  });

  /**
   * 레지스트리가 스스로 쓰는 표기가 두 가지다 — `<isrctn>` 요소는 숫자만(`30583116`),
   * `publicIdentifierCanonical` 과 WHO 포맷의 `trial_id` 는 접두사까지(`ISRCTN30583116`).
   * 둘 다 받고 정규 형태 하나로 접는다. 그러지 않으면 같은 시험이 두 개의 ctreg id 를
   * 갖게 되고, 캐시 키와 not_found 대조가 표기에 따라 갈린다.
   */
  it('숫자만 준 것과 접두사를 붙인 것이 같은 정규 형태가 된다', () => {
    expect(parseTrialId('ISRCTN:30583116').id).toBe('ISRCTN:ISRCTN30583116');
    expect(parseTrialId('isrctn30583116').id).toBe('ISRCTN:ISRCTN30583116');
    expect(parseTrialId('ISRCTN30583116').id).toBe('ISRCTN:ISRCTN30583116');
  });

  it('NCT 번호는 여전히 ctgov 로 간다 — 두 패턴이 겹치지 않는다', () => {
    expect(parseTrialId('NCT03831932').registry).toBe('ctgov');
  });
});
