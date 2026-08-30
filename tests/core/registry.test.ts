import { describe, expect, it } from 'vitest';
import { REGISTRY_KEYS, formatTrialId, isRegistryKey, parseTrialId } from '../../src/core/registry.js';
import { CtregError } from '../../src/runtime/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

describe('ID 정규화', () => {
  it('등록된 레지스트리는 ctgov, isrctn, ictrp, cris, ctis 다', () => {
    expect(REGISTRY_KEYS).toEqual(['ctgov', 'isrctn', 'ictrp', 'cris', 'ctis']);
    for (const k of REGISTRY_KEYS) expect(isRegistryKey(k)).toBe(true);
    expect(isRegistryKey('nosuchreg')).toBe(false);
  });

  /**
   * CRIS 등록번호는 `KCT` + 숫자 일곱이다(실측 2026-08-28: KCT0000145 … KCT0012524).
   * 다른 셋과 겹치지 않으므로 접두사 없이도 추론된다 — 겹치면 기존 호출자의 동작이
   * 조용히 바뀌므로 그 사실을 여기서 못 박는다.
   */
  /**
   * CTIS 번호는 `2022-501417-31-00` 꼴이다(실측). 판 접미사가 없는 형태도 받는다.
   * 다른 넷과 겹치지 않아 접두사 없이 추론된다 — 겹치면 기존 호출자의 동작이 조용히 바뀐다.
   */
  it('CTIS 번호는 접두사 없이도 ctis 로 간다', () => {
    expect(parseTrialId('2022-501417-31-00')).toMatchObject({ registry: 'ctis', registryId: '2022-501417-31-00' });
    expect(parseTrialId('2019-000123-45').registry).toBe('ctis');
    expect(parseTrialId('CTIS:2022-501417-31-00').id).toBe('CTIS:2022-501417-31-00');
    // 자릿수가 다르면 CTIS 형식이 아니다 — 조용히 받아 0건을 내면 안 된다.
    expect(() => parseTrialId('2022-50141-31-00')).toThrow();
  });

  it('KCT 번호는 접두사 없이도 cris 로 간다', () => {
    expect(parseTrialId('KCT0000145')).toEqual({ registry: 'cris', registryId: 'KCT0000145', id: 'CRIS:KCT0000145' });
    expect(parseTrialId('kct0000145').registryId).toBe('KCT0000145');
    expect(parseTrialId('CRIS:KCT0000145').id).toBe('CRIS:KCT0000145');
    // 여덟 자리는 CRIS 형식이 아니다 — 조용히 받아 0건을 내면 안 된다.
    expect(() => parseTrialId('KCT00001450')).toThrow();
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

describe('ICTRP 의 ID', () => {
  /**
   * ICTRP 의 ID 는 20여 레지스트리의 형식이 섞여 있다(NCT…, ISRCTN…,
   * CTRI/2026/07/113311, JPRN-jRCT…, DRKS…). 접두사를 붙이면 그대로 통과해야 한다 —
   * 슬래시·하이픈이 들어 있어도 마찬가지다.
   */
  it('접두사를 붙이면 어떤 원문 ID 든 받는다', () => {
    for (const raw of ['NCT07749586', 'ISRCTN15819396', 'CTRI/2026/07/113311', 'JPRN-jRCT1031260225', 'DRKS00040777']) {
      const r = parseTrialId(`ICTRP:${raw}`);
      expect(r.registry).toBe('ictrp');
      expect(r.registryId).toBe(raw);
      expect(r.id).toBe(`ICTRP:${raw}`);
    }
  });

  /**
   * **접두사 없이는 절대 ICTRP 로 가지 않는다.** `parseTrialId` 의 추론은
   * `REGISTRY_KEYS.find(...)` 라 배열 순서대로 첫 매치가 이긴다. ICTRP 의 패턴이
   * 관대하면 맨 NCT 번호가 ctgov 대신 ICTRP 로 가거나(기존 호출자 전원의 동작이
   * 조용히 바뀐다), 지금 깔끔하게 exit 2 가 나는 입력이 ICTRP 로 갔다가 0건이 된다.
   */
  it('접두사 없는 ID 는 ICTRP 로 추론되지 않는다', () => {
    expect(parseTrialId('NCT01234567').registry).toBe('ctgov');
    expect(parseTrialId('12345678').registry).toBe('isrctn');
    // ICTRP 만 아는 형식이라도 접두사가 없으면 추론이 아니라 사용법 오류다.
    expect(() => parseTrialId('CTRI/2026/07/113311')).toThrow();
    expect(() => parseTrialId('DRKS00040777')).toThrow();
  });
});
