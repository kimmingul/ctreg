/**
 * 픽스처는 `https://trialsearch.who.int/AdvSearch.aspx` 를 2026-08-26 에 받은 원문이다.
 * ICTRP 는 계약이 없는 HTML 표면이라, 이 픽스처가 낡으면 파싱이 실물과 어긋난다 —
 * 그 어긋남은 스위트가 아니라 `scripts/ictrp-field-test.ts` 가 잡는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD, hiddenFields, pagerTarget } from '../../../src/adapters/ictrp/form.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');

describe('ICTRP 폼 파싱', () => {
  it('ViewState 세 개를 모두 거둔다 — 하나라도 빠지면 POST 가 거절된다', () => {
    const h = hiddenFields(form);
    expect(h['__VIEWSTATE']).toBeDefined();
    expect(h['__VIEWSTATE']!.length).toBeGreaterThan(1000);
    expect(h['__EVENTVALIDATION']).toBeDefined();
    expect(h['__VIEWSTATEGENERATOR']).toBeDefined();
  });

  it('값이 없는 hidden 도 빈 문자열로 거둔다 — 키가 빠지면 서버가 다르게 해석한다', () => {
    const h = hiddenFields('<input type="hidden" name="__EVENTTARGET" id="x" />');
    expect(h['__EVENTTARGET']).toBe('');
  });

  it('hidden 이 아닌 input 은 거두지 않는다', () => {
    const h = hiddenFields('<input type="text" name="txtTitle" value="암" />');
    expect(h['txtTitle']).toBeUndefined();
  });

  /**
   * `pageSize` 는 이 목록에서 빠진다. 그 컨트롤은 **결과 페이지에만** 렌더된다 —
   * ASP.NET 이 그리드에 바인딩된 뒤에야 페이저와 페이지 크기 드롭다운을 낸다.
   * 폼 페이지 픽스처로 검사하면 원리상 실패한다(실측 2026-08-26). 이 이름이 실재하는지는
   * 결과 페이지 픽스처를 가진 다음 태스크가 검사한다.
   */
  it('폼 페이지에 렌더되는 필드 이름이 실제 문서의 것과 같다', () => {
    for (const [key, name] of Object.entries(FIELD)) {
      if (key === 'pageSize') continue;
      expect(form, `'${name}' 이 실제 폼에 없습니다`).toContain(`name="${name}"`);
    }
  });

  it('pageSize 는 폼 페이지에 없다 — 결과 페이지의 컨트롤이다', () => {
    expect(form).not.toContain(FIELD.pageSize);
  });

  /** 1페이지는 현재 페이지라 링크가 없다. 2페이지가 `ctl01` 이다(실측). */
  it('페이저 대상은 0-기반 인덱스로 만든다', () => {
    expect(pagerTarget(1)).toBe('ctl00$ContentPlaceHolder1$dlPager2$ctl01$lnkPageNo');
    expect(pagerTarget(9)).toBe('ctl00$ContentPlaceHolder1$dlPager2$ctl09$lnkPageNo');
  });
});
