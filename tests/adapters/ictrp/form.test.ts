/**
 * 픽스처는 `https://trialsearch.who.int/AdvSearch.aspx` 를 2026-08-26 에 받은 원문이다.
 * ICTRP 는 계약이 없는 HTML 표면이라, 이 픽스처가 낡으면 파싱이 실물과 어긋난다 —
 * 그 어긋남은 스위트가 아니라 `scripts/ictrp-field-test.ts` 가 잡는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD, hiddenFields, pagerLinks } from '../../../src/adapters/ictrp/form.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');
// 페이저는 결과 화면에만 있다 — 폼 페이지에는 없다.
const results = readFileSync(join(__dirname, '../../fixtures/ictrp/results-page1.html'), 'utf8');

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

  /**
   * 예전에는 `pagerTarget(page - 1)` 로 컨트롤 이름을 **계산** 했다. 그 산술이 버그의
   * 뿌리였다 — 창의 마지막 링크가 `Last` 라서 인덱스와 페이지 번호가 한 칸 어긋난다.
   * 이제는 계산하지 않고 화면에서 라벨과 대상을 **한 앵커에서 함께** 읽는다.
   */
  it('번호 링크를 페이지 번호 → postback 대상으로 읽는다', () => {
    const links = pagerLinks(results);
    // 픽스처의 창은 1~10 이 번호 링크이고 ctl10 은 Last 다.
    expect(links.get(2)).toBe('ctl00$ContentPlaceHolder1$dlPager2$ctl01$lnkPageNo');
    expect(links.get(10)).toBe('ctl00$ContentPlaceHolder1$dlPager2$ctl09$lnkPageNo');
  });

  it('Last 는 페이지가 아니므로 잡지 않는다 — 이 한 칸이 옛 버그였다', () => {
    const links = pagerLinks(results);
    // ctl10 은 실재하지만 라벨이 'Last' 라 어느 페이지인지 화면이 말해 주지 않는다.
    expect(results).toContain('dlPager2_ctl10_lnkPageNo');
    expect(links.has(11)).toBe(false);
    expect([...links.values()]).not.toContain('ctl00$ContentPlaceHolder1$dlPager2$ctl10$lnkPageNo');
  });

  it('현재 페이지는 링크가 아니라 잡히지 않는다', () => {
    // 1페이지는 disabled 라 href 가 없다.
    expect(pagerLinks(results).has(1)).toBe(false);
  });
});
