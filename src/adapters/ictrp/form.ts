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
  /** `butAdd` 가 나라를 옮겨 넣는 자리. 검색에 실제로 반영되는 것은 이쪽이다. */
  countrySelected: `${PREFIX}lstCountriesSelected`,
  /** 텍스트 상자의 나라를 선택 목록으로 옮기는 버튼. 이 왕복이 없으면 필터가 죽는다. */
  butAdd: `${PREFIX}butAdd`,
  phase: `${PREFIX}ListBoxPhase`,
  status: `${PREFIX}ddlRecruitingStatus`,
  pageSize: `${PREFIX}ddlPageSize`,
  search: `${PREFIX}btnSearch`,
} as const;

/**
 * 이 화면이 실제로 렌더한 **번호 링크** 를 "페이지 번호 → postback 대상" 으로 읽는다.
 *
 * 왜 인덱스가 아니라 라벨인가 — 결과 화면의 페이저는 전체 목록이 아니라 **창(window)**
 * 이고, **그 창의 마지막 링크는 페이지 번호가 아니라 `Last`** 다. 커밋된 픽스처가 그렇다:
 * `ctl00`→`1` … `ctl09`→`10`, 그리고 `ctl10`→`Last`.
 *
 * 그래서 컨트롤 인덱스만 세면 한 칸이 남는다. 예전 판이 그랬다: `ctl10` 이 있으니
 * 11페이지도 갈 수 있다고 판단하고 실제로는 `Last` 를 눌러 **전체의 마지막 페이지를
 * 11페이지라고 내주었다.** 결과가 적은 질의일수록 빨리 닿는다 — 링크가 `ctl01`..`ctl03`
 * (2~4페이지) + `ctl04`=`Last` 라면 5페이지 요청이 그렇게 된다.
 *
 * 구별할 근거는 화면에 있다. 앵커 본문이 곧 페이지 번호이고, 그 앵커의 `href` 안에
 * postback 대상 이름이 들어 있다. 둘을 **한 앵커에서 함께** 읽으므로 번호와 대상이
 * 어긋날 수 없다 — 인덱스 산술이 하던 추측이 사라진다.
 *
 * 현재 페이지의 링크는 `disabled` 라 `href` 가 없고, 그래서 여기 잡히지 않는다. 그것도
 * 옳다: 지금 있는 페이지로 postback 할 일은 없다. `Last`·`>>` 처럼 번호가 아닌 라벨도
 * 잡히지 않는다 — 그 자리가 몇 페이지인지 화면이 말해 주지 않기 때문이다.
 */
export function pagerLinks(html: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="[^"]*?(ctl00\$ContentPlaceHolder1\$dlPager2\$ctl\d+\$lnkPageNo)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = m[2]!.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!/^\d+$/.test(label)) continue;
    out.set(Number(label), m[1]!);
  }
  return out;
}

/**
 * `butAdd` 왕복 뒤 응답에서 **선택된** 나라들을 읽는다.
 *
 * 이 값이 검색에 실제로 반영되는 자리다. 텍스트 상자(`txtFreeCountry`)만 채운 POST 는
 * 필터가 통째로 사라져 무필터 결과를 낸다 — 필드테스트가 그렇게 잡았다.
 */
export function countrySelected(html: string): string[] {
  const block = new RegExp(
    `<select[^>]*name="${PREFIX.replaceAll('$', '\\$')}lstCountriesSelected"[\\s\\S]*?</select>`,
    'i',
  ).exec(html);
  if (!block) return [];
  return [...block[0].matchAll(/<option[^>]*value="([^"]*)"/gi)]
    .map((m) => decodeEntities(m[1]!))
    .filter((v) => v !== '');
}

/**
 * 폼 페이지가 들고 있는 **표준 나라 이름** 들(`lstCountries` 의 옵션 값).
 *
 * 목록을 코드에 박지 않고 화면에서 읽는 이유: 박아 두면 포털이 나라를 더하거나 이름을
 * 바꾸는 날 조용히 틀려지고, 그 어긋남은 아무도 보지 못한다. 검색 전에 폼 페이지를 어차피
 * 한 번 받으므로 그 응답에서 그대로 읽는다 — 요청이 늘지 않는다.
 *
 * 왜 이 목록이 필요한가(실측 2026-08-26, `condition=diabetes` · 상태 ALL): 목록에 있는
 * `Japan` 은 2,981건이고, 도시 이름 `Seoul` 과 오타 `Zzzland` 는 0건이라 눈에 보이게
 * 실패한다. 위험한 것은 **`South Korea` 가 94건** 이라는 것이다 — 성공한 필터처럼 보이는데
 * 표준 이름 `Korea, Republic of` 의 713건에 견주면 13% 뿐이다. 조용히 좁히는, 이 도구가
 * 없애려는 실패 그 자체이므로 어댑터가 이 목록으로 걸러 낸다.
 *
 * 값과 라벨이 다르다 — 값이 `Korea, Republic of` 이고 라벨이 `Republic of Korea` 다.
 * 폼에 실어 보내야 하는 것은 **값** 이므로 값을 읽는다.
 *
 * 결과 페이지에는 이 select 가 없다. 그래서 빈 배열이 나오고, 그것이 옳다.
 */
export function countryOptions(html: string): string[] {
  const block = new RegExp(
    `<select[^>]*name="${PREFIX.replaceAll('$', '\\$')}lstCountries"[\\s\\S]*?</select>`,
    'i',
  ).exec(html);
  if (!block) return [];
  return [...block[0].matchAll(/<option[^>]*value="([^"]*)"/gi)]
    .map((m) => decodeEntities(m[1]!))
    .filter((v) => v !== '');
}

/** 옵션 값에는 `&#39;` 같은 엔티티가 그대로 들어 있다(`Korea, Democratic People&#39;s ...`). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
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
