/**
 * ICTRP 는 ASP.NET WebForms 다. 검색은 `AdvSearch.aspx` 에 폼을 POST 하는 것이고,
 * 그 POST 는 서버가 방금 내려 준 ViewState 를 그대로 되돌려 줘야 성립한다.
 *
 * HTML 파서를 의존성으로 들이지 않는 이유: 필요한 것이 hidden `<input>` 과 결과
 * `<tr>` 뿐이라 파서를 들일 값이 없다. 대신 **무엇을 못 잡는지** 를 적어 둔다.
 *
 * 속성 **순서** 는 상관없다 — `type`/`name`/`value` 를 각각 독립된 정규식으로 태그 전체에서
 * 찾으므로 어느 순서로 나와도 같게 잡힌다. 못 잡는 것은 **따옴표** 다: 세 정규식 모두
 * 큰따옴표로 묶인 값만 본다. 작은따옴표(`name='__VIEWSTATE'`)나 따옴표 없는 값
 * (`name=__VIEWSTATE`)으로 바뀌면 그 필드는 통째로 사라진다.
 *
 * 그때의 결과를 정직하게 적어 둔다: `__VIEWSTATE` 를 놓친 POST 는 서버가 거절하고,
 * 그렇게 돌아온 페이지에는 건수 문구가 없어 `parse.ts` 가 `records = 0` 으로 읽는다.
 * 자기 고장 감지는 `records > 0` 일 때만 걸리므로 **이 경우는 오류가 아니라 조용한
 * 0건이 된다** — `parse.ts` 가 잡아 주지 못하는 사각지대다.
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

/** `$` 는 정규식 메타문자다 — 컨트롤 이름을 패턴에 넣으려면 escape 해야 한다. */
const PAGER_RE = new RegExp(`${PREFIX.replaceAll('$', '\\$')}dlPager2\\$ctl(\\d+)\\$lnkPageNo`, 'g');

/**
 * 이 화면이 **실제로 렌더한** 페이저 postback 대상의 인덱스들(오름차순).
 *
 * 결과 화면의 페이저는 전체 페이지 목록이 아니라 **창(window)** 이다 — 커밋된 픽스처는
 * `ctl01`..`ctl10` 만 낸다. 그런데 `client.ts` 는 절대 페이지 번호를 그대로 컨트롤
 * 인덱스로 쓰므로(`pagerTarget(p-1)`), 그 창 밖을 요청하면 **그 화면에 존재하지 않는
 * 대상** 으로 postback 하게 된다. ASP.NET 은 그것을 오류로 내지 않는다: 실측
 * (2026-08-26, 필드테스트 「심화 관찰 A」) 12페이지 요청이 한 질의에서는 전체의 마지막
 * 페이지로 건너뛰었고 다른 질의에서는 20행(페이지 크기의 두 배)을 돌려주었다.
 *
 * 그래서 상한을 코드에 박지 않고 **화면에서 읽는다.** 창의 폭은 우리 계약이 아니라
 * 포털의 사정이고, 박아 둔 숫자는 포털이 바꾸는 날 조용히 틀려진다.
 *
 * 1페이지(`ctl00`)는 현재 페이지라 링크가 아니고 `href` 도 없어 여기 잡히지 않는다.
 * 창의 마지막 링크가 페이지 번호인지 "Last" 인지는 이 함수가 구별하지 않는다 — 구별할
 * 근거가 화면에 없다. 그래서 이 목록은 "여기까지는 postback 대상이 존재한다" 는 뜻이지
 * "그 페이지가 몇 번째다" 는 뜻이 아니다.
 */
export function pagerIndexes(html: string): number[] {
  const out = new Set<number>();
  for (const m of html.matchAll(PAGER_RE)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
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
