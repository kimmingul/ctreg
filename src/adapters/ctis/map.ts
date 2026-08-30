import type { TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import type { StudyType, TrialPhase, TrialStatus } from '../../core/vocab.js';

/**
 * 검색 응답의 한 항목. **23개가 전부다**(실측 2026-08-30). 상세 조회(`retrieve/{id}`)는
 * 훨씬 두껍지만 구조가 깊고 다르다 — 그쪽은 아직 쓰지 않는다.
 */
export type CtisItem = {
  ctNumber?: string;
  ctTitle?: string;
  shortTitle?: string;
  ctStatus?: number | string;
  conditions?: string;
  product?: string;
  sponsor?: string;
  sponsorType?: string;
  trialPhase?: string;
  trialCountries?: string[];
  totalNumberEnrolled?: string | number;
  ageGroup?: string;
  gender?: string;
  decisionDateOverall?: string;
  lastUpdated?: string;
  lastPublicationUpdate?: string;
  resultsFirstReceived?: string;
  therapeuticAreas?: string[];
  primaryEndPoint?: string;
  endPoint?: string;
};

/**
 * **EMA 법적 고지가 요구하는 출처 표시.**
 *
 * *"Information and documents made available on EMA's webpages are public and may be
 * reproduced and/or distributed … for non-commercial and commercial purposes, provided
 * that EMA is always acknowledged as the source of the material. Such acknowledgement
 * must be included in **each copy** of the material."*
 *
 * 그래서 봉투가 아니라 **레코드마다** 싣는다 — 레코드를 하나씩 꺼내 쓰는 소비자에게도
 * 표시가 따라가야 한다.
 */
export const CTIS_ATTRIBUTION = 'Source: European Medicines Agency (EMA) — Clinical Trials Information System (CTIS)';

const nonEmpty = (v: unknown): string | undefined => {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
};

/** `07/05/2024`(dd/mm/yyyy) 또는 ISO. CTIS 는 화면용 형식으로 내준다(실측). */
const date = (v: unknown): string | undefined => {
  const s = nonEmpty(v);
  if (s === undefined) return undefined;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy !== null) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return iso?.[1];
};

/**
 * 상 문자열 → 공통 어휘. 실측된 값이 `Human Pharmacology (Phase I)-  Other` 처럼
 * 결합·자유 형식이라 **낱말로 찾는다.** 표에 없으면 `other` 로 신고하고 원문을 함께 싣는다 —
 * 모르는 것을 아는 값으로 접지 않는다.
 */
export function toPhase(raw: string | undefined): TrialPhase[] | undefined {
  const s = nonEmpty(raw);
  if (s === undefined) return undefined;
  const found: TrialPhase[] = [];
  if (/phase\s*iv|phase\s*4/i.test(s)) found.push('phase_4');
  if (/phase\s*iii|phase\s*3/i.test(s)) found.push('phase_3');
  if (/phase\s*ii\b|phase\s*2/i.test(s)) found.push('phase_2');
  if (/phase\s*i\b|phase\s*1/i.test(s)) found.push('phase_1');
  return found.length > 0 ? found : ['other'];
}

/**
 * 검색 응답의 `ctStatus` 는 숫자 코드다. **표의 절반만 확정했다**(2026-08-30).
 *
 * 재는 방법: 여러 쪽에서 표본을 모아 숫자를 세고, 각 숫자의 대표 시험을 상세 조회해서
 * 그쪽의 문자열 상태와 맞췄다. 결과:
 *
 * | 코드 | 상세의 문자열 | 판정 |
 * | --- | --- | --- |
 * | 8 | `Ended` | 끝났다 → `completed` |
 * | 11 | `Not authorised` | 허가되지 않았다 → 공통 어휘에 자리가 없어 `other` |
 * | 2·3·4·5 | 전부 `Authorised` | **갈리지 않는다** |
 *
 * 2·3·4·5 는 상세의 최상위 상태가 넷을 하나로 뭉쳐서 구분되지 않았다. 넷이 각각 무엇인지
 * (모집 전/모집 중/모집 종료 …) 짐작할 수는 있지만 **재지 못한 것을 적지는 않는다** —
 * 틀리면 사용자가 모집 중이 아닌 시험을 모집 중으로 읽는다. `unknown` 으로 둔다.
 */
const STATUS_BY_CODE: Readonly<Record<string, { status: TrialStatus; raw: string }>> = {
  '8': { status: 'completed', raw: 'Ended' },
  '11': { status: 'other', raw: 'Not authorised' },
};

/** CTIS 는 의약품 임상시험 등록부다 — 관찰연구를 담지 않는다. */
const STUDY_TYPE: StudyType = 'interventional';

/** `"Spain:11"` 처럼 나라와 시험기관 수가 붙어 온다(실측). 나라 이름만 뽑는다. */
const country = (v: string): string | undefined => nonEmpty(v.split(':')[0]);

/**
 * `locationCap` 은 **CLI 가 정하고 어댑터는 읽는다**(`o.caps.locations`). 여기서 자체
 * 상한을 쓰면 `--include locations` 로 캡을 올려도 조용히 그만큼만 나온다.
 * 잘렸는지는 `locationsTotal` 과 `locations.length` 의 차이로 호출자가 알 수 있다.
 */
/** 확정된 코드만 접는다. 나머지는 `unknown` 이고 원문도 싣지 않는다 — 숫자는 원문이 아니다. */
function statusOf(code: number | string | undefined): { status: TrialStatus; statusRaw?: string } {
  const hit = code === undefined ? undefined : STATUS_BY_CODE[String(code)];
  return hit === undefined ? { status: 'unknown' } : { status: hit.status, statusRaw: hit.raw };
}

export function mapItem(item: CtisItem, fetchedAt: string, locationCap = Number.POSITIVE_INFINITY): TrialRecord {
  const registryId = nonEmpty(item.ctNumber) ?? '';
  const title = nonEmpty(item.ctTitle) ?? nonEmpty(item.shortTitle) ?? '';

  const dates: Record<string, string> = {};
  const start = date(item.decisionDateOverall);
  const updated = date(item.lastUpdated);
  if (start !== undefined) dates.start = start;
  if (updated !== undefined) dates.lastUpdated = updated;

  const countries = (item.trialCountries ?? [])
    .map(country)
    .filter((c): c is string => c !== undefined);

  const enrolled = Number(nonEmpty(item.totalNumberEnrolled));
  const phase = toPhase(item.trialPhase);
  const conditions = nonEmpty(item.conditions);
  const sponsor = nonEmpty(item.sponsor);
  const product = nonEmpty(item.product);

  return {
    id: formatTrialId('ctis', registryId),
    registry: 'ctis',
    registryId,
    url: `https://euclinicaltrials.eu/ctis-public/view/${encodeURIComponent(registryId)}`,
    title,
    ...(nonEmpty(item.shortTitle) !== undefined && nonEmpty(item.shortTitle) !== title
      ? { officialTitle: nonEmpty(item.shortTitle)! }
      : {}),
    // 확정된 코드만 접는다(위 표). 나머지는 unknown — 짐작한 상태를 내놓지 않는다.
    ...statusOf(item.ctStatus),
    ...(phase !== undefined ? { phase, phaseRaw: [item.trialPhase!] } : {}),
    studyType: STUDY_TYPE,
    // 여러 질환이 한 문자열로 붙어 온다. 쪼개는 규칙을 재지 못해 통째로 하나로 둔다.
    conditions: conditions === undefined ? [] : [conditions],
    ...(product !== undefined ? { interventions: [{ name: product }] } : {}),
    ...(sponsor !== undefined ? { sponsor: { lead: sponsor } } : {}),
    ...(Number.isFinite(enrolled) && enrolled > 0
      ? { enrollment: { count: enrolled, basis: 'estimated' as const } }
      : {}),
    ...(countries.length > 0
      ? {
          locations: countries.slice(0, locationCap).map((c) => ({ country: c })),
          locationsTotal: countries.length,
        }
      : {}),
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
    attribution: CTIS_ATTRIBUTION,
    fetchedAt,
  };
}
