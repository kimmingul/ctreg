import type { TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import type { TrialStatus } from '../../core/vocab.js';
import { toPhase, toStudyType } from './vocab.js';

/**
 * 공식 목록 API 가 내는 한 항목. **16개가 전부다**(실측 2026-08-28, 포털의 출력결과 표와
 * 실제 응답이 일치한다). 그래서 이 어댑터의 레코드는 얇다 — 없는 것을 지어내지 않는다.
 */
export type CrisItem = {
  trial_id?: string;
  scientific_title_kr?: string;
  scientific_title_en?: string;
  date_registration?: string;
  date_updated?: string;
  date_enrolment?: string;
  type_enrolment_kr?: string;
  results_date_completed?: string;
  results_type_date_completed_kr?: string;
  study_type_kr?: string;
  i_freetext_kr?: string;
  phase_kr?: string;
  source_name_kr?: string;
  primary_sponsor_kr?: string;
  primary_outcome_1_kr?: string;
};

/**
 * 값을 다듬는다. **줄바꿈을 접는 것이 요점이다** — 실측 2026-08-28: CRIS 제목 안에
 * 줄바꿈이 그대로 들어 있다("면역 항암\n화학요법"). 제목은 한 줄짜리 값이라, 그대로
 * 내보내면 text 출력이 어긋나고 ndjson 소비자도 한 레코드를 두 줄로 본다.
 */
const nonEmpty = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
};

/**
 * `YYYY-MM-DD` 만 통과시킨다. CRIS 가 빈 문자열을 내는 자리가 있고(실측), **오퍼레이션마다
 * 구분자가 다르다** — 같은 `date_registration` 이 목록에서는 `2011-07-18`, 상세에서는
 * `2011/07/18` 로 온다(실측 2026-08-28). 슬래시를 접지 않으면 상세의 날짜가 통째로 사라진다.
 */
const date = (v: string | undefined): string | undefined => {
  const s = nonEmpty(v)?.replace(/\//g, '-');
  return s !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

export function mapItem(item: CrisItem, fetchedAt: string): TrialRecord {
  const registryId = (item.trial_id ?? '').trim();
  /**
   * 제목은 국문을 정본으로 삼고 영문을 `officialTitle` 에 둔다. 국문이 비면 영문으로
   * 넘어간다 — 스키마가 `title` 을 비워 두는 것을 허락하지 않으므로 둘 다 없으면
   * 레코드를 만들 수 없고, 그 판단은 호출자(adapter)가 한다.
   */
  const kr = nonEmpty(item.scientific_title_kr);
  const en = nonEmpty(item.scientific_title_en);
  const title = kr ?? en ?? '';

  const dates: Record<string, string> = {};
  const start = date(item.date_enrolment);
  const completion = date(item.results_date_completed);
  const firstPosted = date(item.date_registration);
  const lastUpdated = date(item.date_updated);
  if (start !== undefined) dates.start = start;
  if (completion !== undefined) dates.completion = completion;
  if (firstPosted !== undefined) dates.firstPosted = firstPosted;
  if (lastUpdated !== undefined) dates.lastUpdated = lastUpdated;

  const studyType = toStudyType(item.study_type_kr);
  const phase = toPhase(item.phase_kr);
  const sponsorLead = nonEmpty(item.primary_sponsor_kr);
  const intervention = nonEmpty(item.i_freetext_kr);

  return {
    id: formatTrialId('cris', registryId),
    registry: 'cris',
    registryId,
    /**
     * **CRIS 는 등록번호로 가는 영구 링크를 공개하지 않는다.** 자기 화면은 내부 `seq` 로
     * 가고(ICTRP 가 보관한 원본 링크도 `search_result_st01.jsp?seq=1488` 이다), 그 `seq` 는
     * 공식 API 16항목 어디에도 없다. 포털의 파일 데이터셋 안내도 "검색 버튼을 활용하여
     * 확인" 이라고 적는다 — 즉 사람이 검색해서 찾으라는 뜻이다.
     *
     * 그래서 **같은 등록을 담은 WHO ICTRP 사본** 을 가리킨다. 실제로 열리는 것을 확인했다
     * (KCT0000145 → 같은 시험이 뜬다). 지어낸 주소보다 낫지만 공짜는 아니다: CRIS 에 갓
     * 올라와 아직 ICTRP 에 실리지 않은 등록이면 이 링크는 비어 있을 수 있다. 이 사실은
     * capability 의 scope 에도 적어 둔다.
     */
    url: `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(registryId)}`,
    title,
    ...(kr !== undefined && en !== undefined ? { officialTitle: en } : {}),
    /**
     * **`unknown` 은 지어낸 값이 아니라 사실이다.** 목록 API 16항목에 모집상태가 없다 —
     * 공통 어휘의 `unknown` 이 뜻하는 "레지스트리가 (여기서) 모른다" 가 정확히 이 상태다.
     * `other`(매핑이 없다)와 다르고, `statusRaw` 는 원문이 없으므로 싣지 않는다.
     */
    status: 'unknown',
    ...(phase !== undefined ? { phase: [phase], phaseRaw: [item.phase_kr!] } : {}),
    ...(studyType !== undefined ? { studyType, studyTypeRaw: item.study_type_kr! } : {}),
    // 질환명 필드가 목록에 없다. 빈 배열은 "질환이 없다" 가 아니라 "이 API 가 안 낸다" 다.
    conditions: [],
    ...(intervention !== undefined ? { interventions: [{ name: intervention }] } : {}),
    ...(sponsorLead !== undefined ? { sponsor: { lead: sponsorLead } } : {}),
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
    fetchedAt,
  };
}

/**
 * 상세 조회(`/detail`)가 내는 레코드. 목록보다 훨씬 두껍다 — 연구책임자 성명, 모집현황,
 * 목표대상자 수, 참여기관, 결과변수가 여기 있다.
 *
 * **그래서 `get` 과 `search` 의 레코드가 다르다.** 목록 레코드의 `status: 'unknown'` 은
 * 그 오퍼레이션이 정말 모르기 때문이고, 여기서는 읽어서 신고한다.
 */
export type CrisDetail = Record<string, unknown>;

/** 실측 값 → 공통 어휘. 표에 없는 값은 `other` 로 신고하고 원문을 함께 싣는다. */
const STATUS: Record<string, TrialStatus> = {
  '모집 중': 'recruiting',
  '모집중': 'recruiting',
  '모집전': 'not_yet_recruiting',
  '모집중지': 'suspended',
  '모집종료': 'active_not_recruiting',
  '연구종결': 'completed',
  '연구중단': 'terminated',
  '초청등록': 'enrolling_by_invitation',
};

const str = (o: CrisDetail, k: string): string | undefined =>
  typeof o[k] === 'string' ? nonEmpty(o[k] as string) : undefined;

const firstOf = (o: CrisDetail, listKey: string, itemKey: string): string | undefined => {
  const list = o[listKey];
  if (!Array.isArray(list)) return undefined;
  for (const x of list) {
    if (typeof x === 'object' && x !== null) {
      const v = (x as Record<string, unknown>)[itemKey];
      if (typeof v === 'string' && nonEmpty(v) !== undefined) return nonEmpty(v);
    }
  }
  return undefined;
};

export function mapDetail(d: CrisDetail, fetchedAt: string): TrialRecord {
  const base = mapItem(
    {
      trial_id: str(d, 'trial_id'),
      scientific_title_kr: str(d, 'scientific_title_kr'),
      scientific_title_en: str(d, 'scientific_title_en'),
      date_registration: str(d, 'date_registration'),
      date_updated: str(d, 'date_updated'),
      date_enrolment: str(d, 'date_enrolment'),
      results_date_completed: str(d, 'results_date_completed'),
      study_type_kr: str(d, 'study_type_kr'),
      i_freetext_kr: str(d, 'i_freetext_kr'),
      phase_kr: str(d, 'phase_kr'),
      primary_sponsor_kr: firstOf(d, 'sponsor_items', 'primary_sponsor_kr'),
    },
    fetchedAt,
  );

  const statusRaw = str(d, 'recruitment_status_kr');
  const status = statusRaw === undefined ? undefined : (STATUS[statusRaw] ?? 'other');

  const size = d.target_size;
  const count = typeof size === 'number' ? size : typeof size === 'string' && /^\d+$/.test(size) ? Number(size) : undefined;
  // 실측: `실제등록` = 실제로 등록된 수, `예정` = 계획된 수. 스키마 어휘로는 actual / estimated 다.
  const basis = str(d, 'type_enrolment_kr') === '실제등록' ? 'actual' : 'estimated';

  /**
   * **연구책임자를 싣는다.** 이것이 상세 조회를 쓰는 가장 큰 이유다 — 목록 API 16항목에는
   * 사람 이름이 아예 없다. 국문·영문이 따로 오므로 둘 다 싣는다(실측: `김민걸` / `Min gul Kim`).
   * 표기가 다르므로 어느 하나만 실으면 그 표기로 찾는 쪽이 못 찾는다.
   */
  const contacts: { name?: string; role?: string }[] = [];
  const sciKr = str(d, 'scientific_name_kr');
  const sciEn = str(d, 'scientific_name_en');
  if (sciKr !== undefined) contacts.push({ name: sciKr, role: '연구책임자' });
  if (sciEn !== undefined && sciEn !== sciKr) contacts.push({ name: sciEn, role: 'Principal Investigator' });
  const pubKr = str(d, 'public_name_kr');
  if (pubKr !== undefined) contacts.push({ name: pubKr, role: '연구실무담당자' });

  const site = firstOf(d, 'research_items', 'site_name_kr');
  const country = site === undefined ? undefined : { country: 'Korea, Republic of', facility: site };

  return {
    ...base,
    ...(status !== undefined ? { status, statusRaw } : {}),
    ...(count !== undefined ? { enrollment: { count, basis } } : {}),
    ...(contacts.length > 0 ? { contacts } : {}),
    ...(country !== undefined ? { locations: [country], locationsTotal: (d.research_items as unknown[]).length } : {}),
  };
}
