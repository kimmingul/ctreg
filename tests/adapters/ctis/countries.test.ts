import { describe, expect, it } from 'vitest';
import { CTIS_MSC_CODES, toMscCode } from '../../../src/adapters/ctis/countries.js';

/**
 * 이 표가 틀리면 **조용히 빈 답**이 나간다 — 코드가 틀리면 API 가 오류가 아니라 0건을
 * 내기 때문이다(실측: 이름이나 알파벳 코드는 전부 0건). 그래서 표를 지어내지 않고
 * 코드마다 보내 보고 돌아온 나라로 확정했다.
 */
describe('CTIS 회원국 코드', () => {
  it('실측한 코드가 그대로 들어 있다', () => {
    // 표본 셋 — 조회 결과가 스스로 증명한 값이다(Spain 5,004건 등).
    expect(CTIS_MSC_CODES.Spain).toBe('724');
    expect(CTIS_MSC_CODES.Germany).toBe('276');
    expect(CTIS_MSC_CODES.Hungary).toBe('348');
  });

  it('EU·EEA 를 덮는다', () => {
    expect(Object.keys(CTIS_MSC_CODES).length).toBeGreaterThanOrEqual(28);
    for (const c of ['Austria', 'Belgium', 'France', 'Italy', 'Netherlands', 'Poland', 'Sweden', 'Norway', 'Iceland']) {
      expect(CTIS_MSC_CODES[c], `${c} 가 표에 없습니다`).toBeDefined();
    }
  });

  it('모든 코드가 서로 다르다 — 두 나라가 같은 코드를 가리키면 한쪽이 조용히 틀린다', () => {
    const codes = Object.values(CTIS_MSC_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('모두 숫자 코드다 — 알파벳 코드는 0건을 낸다(실측)', () => {
    for (const [name, code] of Object.entries(CTIS_MSC_CODES)) {
      expect(code, `${name}`).toMatch(/^\d{1,3}$/);
    }
  });

  it('대소문자와 공백만 눈감아 준다', () => {
    expect(toMscCode('spain')).toBe('724');
    expect(toMscCode('  Germany ')).toBe('276');
    // 추측하지 않는다 — 아는 표기가 아니면 모른다고 답한다.
    expect(toMscCode('España')).toBeUndefined();
    expect(toMscCode('ES')).toBeUndefined();
    expect(toMscCode('United States')).toBeUndefined();
  });
});
