/**
 * `Trial2.aspx` 레코드 페이지 파싱.
 *
 * 검색 결과 행이 싣는 것은 모집상태·ID·제목·등록일 넷뿐인데, 이 페이지는 WHO TRDS
 * 24항목을 싣는다(실측 2026-08-27). 그래서 `get` 으로 온 레코드는 `search` 로 온 것보다
 * 충실하고, **특히 상태가 다르다**: 결과 행은 `Recruiting`/`Not Recruiting` 이진이지만
 * 여기는 레지스트리가 신고한 값 그대로다(`Completed`·`Pending`·`Not yet recruiting`…).
 * 같은 시험이 경로에 따라 다른 충실도로 오는 것은 사실이므로 문서가 그것을 말한다.
 *
 * **마크업 관찰:** 라벨이 `<span>Label:</span>` 같은 구조가 아니라 그냥 텍스트 노드다.
 * 그래서 태그를 벗겨 줄로 만든 뒤 "라벨 줄 다음 줄이 값" 으로 읽는다. 레지스트리 다섯 곳
 * (NCT·ISRCTN·ChiCTR·ACTRN·JPRN)에서 같은 모양임을 확인했다.
 *
 * **못 잡는 것:** 값이 여러 줄인 항목(적격기준 전문 등)은 첫 줄만 잡힌다. 첫 판이 core
 * 필드만 다루므로 지금은 문제가 아니지만, detail 섹션을 열 때는 이 방식으로는 부족하다.
 */

/** 페이지에서 읽은 원문 그대로. 공통 어휘로의 변환은 `map.ts` 의 몫이다. */
export type IctrpRecord = {
  register?: string;
  mainId?: string;
  publicTitle: string;
  scientificTitle?: string;
  primarySponsor?: string;
  /** ICTRP 가 **자기 사본을 수확한** 날. 시험이 갱신된 날이 아니다. */
  lastRefreshedOn?: string;
  dateOfRegistration?: string;
  /** 시험의 시작일(TRDS "Date of first enrolment"). 등록일과 다른 것이다. */
  firstEnrolment?: string;
  targetSampleSize?: string;
  /** 레지스트리가 신고한 값 그대로. 결과 행의 이진값과 다르다. */
  recruitmentStatus?: string;
  studyType?: string;
  phase?: string;
  countries: string[];
  conditions: string[];
  interventions: string[];
};

/** 값이 이어지는 항목의 끝을 알리는 섹션 제목들. 목록에 이것들이 섞이면 안 된다. */
const SECTION_HEADS = new Set([
  'Main', 'Contacts', 'Countries of recruitment', 'Key inclusion & exclusion criteria',
  'Key inclusion &amp; exclusion criteria', 'Health Condition(s)', 'or Problem(s) studied',
  'Intervention(s)', 'Primary Outcome(s)', 'Secondary Outcome(s)', 'Secondary ID(s)',
  'Source(s) of Monetary Support', 'Secondary Sponsor(s)', 'Ethics review', 'Results',
  'Age minimum:', 'Age maximum:', 'Gender:',
]);

function textLines(html: string): string[] {
  const stripped = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '\n');
  return stripped
    .split('\n')
    .map((s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '');
}

/** `라벨:` 바로 다음 줄. 다음 줄이 또 라벨이면 그 항목은 비어 있는 것이다. */
function labelled(lines: string[], label: string): string | undefined {
  const i = lines.indexOf(label);
  if (i < 0 || i + 1 >= lines.length) return undefined;
  const v = lines[i + 1]!;
  return v.endsWith(':') || SECTION_HEADS.has(v) ? undefined : v;
}

/** 섹션 제목 다음부터 다음 섹션 제목(또는 라벨) 전까지. 국가·조건·중재가 이 모양이다. */
function section(lines: string[], head: string): string[] {
  const i = lines.indexOf(head);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const v = lines[j]!;
    if (SECTION_HEADS.has(v) || v.endsWith(':')) break;
    out.push(v);
  }
  return out;
}

/**
 * **빈 껍데기면 `undefined` 다.** 실측(2026-08-27): `Trial2.aspx` 는 내용이 없는 시험에도
 * 200 과 함께 섹션 제목만 있는 페이지를 낸다(정확히 23,501바이트의 고정 페이지). 표본
 * 11건 중 2건이 그랬고 둘 다 ISRCTN 이었지만 다른 ISRCTN 둘은 내용이 있었다 — 레지스트리
 * 전체가 아니라 시험별이다.
 *
 * 이때 레코드를 만들면 안 된다. 제목 없는 레코드는 스키마를 어기고, 무엇보다 "그 시험은
 * 이렇다" 는 거짓이 된다. 호출자는 이것을 `not_found` 로 신고한다 — ctgov 가 배치에서
 * 빠진 ID 를 다루는 것과 같은 자리다.
 */
export function parseRecord(html: string): IctrpRecord | undefined {
  const lines = textLines(html);
  const publicTitle = labelled(lines, 'Public title:');
  if (publicTitle === undefined) return undefined;

  return {
    ...(labelled(lines, 'Register:') !== undefined ? { register: labelled(lines, 'Register:') } : {}),
    ...(labelled(lines, 'Main ID:') !== undefined ? { mainId: labelled(lines, 'Main ID:') } : {}),
    publicTitle,
    ...(labelled(lines, 'Scientific title:') !== undefined
      ? { scientificTitle: labelled(lines, 'Scientific title:') } : {}),
    ...(labelled(lines, 'Primary sponsor:') !== undefined
      ? { primarySponsor: labelled(lines, 'Primary sponsor:') } : {}),
    ...(labelled(lines, 'Last refreshed on:') !== undefined
      ? { lastRefreshedOn: labelled(lines, 'Last refreshed on:') } : {}),
    ...(labelled(lines, 'Date of registration:') !== undefined
      ? { dateOfRegistration: labelled(lines, 'Date of registration:') } : {}),
    ...(labelled(lines, 'Date of first enrolment:') !== undefined
      ? { firstEnrolment: labelled(lines, 'Date of first enrolment:') } : {}),
    ...(labelled(lines, 'Target sample size:') !== undefined
      ? { targetSampleSize: labelled(lines, 'Target sample size:') } : {}),
    ...(labelled(lines, 'Recruitment status:') !== undefined
      ? { recruitmentStatus: labelled(lines, 'Recruitment status:') } : {}),
    ...(labelled(lines, 'Study type:') !== undefined ? { studyType: labelled(lines, 'Study type:') } : {}),
    ...(labelled(lines, 'Phase:') !== undefined ? { phase: labelled(lines, 'Phase:') } : {}),
    countries: section(lines, 'Countries of recruitment'),
    conditions: section(lines, 'or Problem(s) studied'),
    interventions: section(lines, 'Intervention(s)'),
  };
}
