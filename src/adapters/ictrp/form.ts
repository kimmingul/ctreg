/**
 * ICTRP 는 ASP.NET WebForms 다. 검색은 `AdvSearch.aspx` 에 폼을 POST 하는 것이고,
 * 그 POST 는 서버가 방금 내려 준 ViewState 를 그대로 되돌려 줘야 성립한다.
 *
 * HTML 파서를 의존성으로 들이지 않는 이유: 필요한 것이 hidden `<input>` 과 결과
 * `<tr>` 뿐이라 파서를 들일 값이 없다. 대신 **무엇을 못 잡는지** 를 적어 둔다 —
 * 정규식은 속성 순서가 바뀌거나 따옴표가 없어지면 놓친다. 그 경우를 조용한 0건이
 * 아니라 오류로 만드는 것이 `parse.ts` 의 자기 고장 감지다.
 */

const PREFIX = 'ctl00$ContentPlaceHolder1$';

/** 폼 필드 이름. 실제 문서에 이 이름이 있는지는 `form.test.ts` 가 픽스처로 검사한다. */
export const FIELD = {
  title: `${PREFIX}txtTitle`,
  condition: `${PREFIX}txtCondition`,
  intervention: `${PREFIX}txtIntervention`,
  sponsor: `${PREFIX}txtPrimarySponsor`,
  secondaryId: `${PREFIX}txtSecondaryID`,
  country: `${PREFIX}txtFreeCountry`,
  phase: `${PREFIX}ListBoxPhase`,
  status: `${PREFIX}ddlRecruitingStatus`,
  pageSize: `${PREFIX}ddlPageSize`,
  search: `${PREFIX}btnSearch`,
} as const;

/**
 * 페이지 postback 의 `__EVENTTARGET`. `pageIndex` 는 0-기반이고 1페이지(0)는 현재
 * 페이지라 링크가 없다 — 2페이지가 `ctl01` 이다(실측).
 */
export function pagerTarget(pageIndex: number): string {
  return `${PREFIX}dlPager2$ctl${String(pageIndex).padStart(2, '0')}$lnkPageNo`;
}

/**
 * `type="hidden"` 인 input 의 name/value 를 전부 거둔다.
 *
 * **값이 없는 hidden 도 빈 문자열로 담는다.** `__EVENTTARGET` 처럼 값 없이 나오는
 * 것들이 있고, 키가 통째로 빠지면 서버가 다르게 해석한다.
 */
export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type\s*=\s*"hidden"/i.test(tag)) continue;
    const name = /\bname\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    out[name] = /\bvalue\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
  }
  return out;
}
