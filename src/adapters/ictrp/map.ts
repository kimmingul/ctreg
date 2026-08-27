import type { TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import type { IctrpRow } from './parse.js';
import type { IctrpRecord } from './record.js';
import type { TrialPhase } from '../../core/vocab.js';

/**
 * ICTRP 결과 행의 상태 → 공통 어휘.
 *
 * 행이 싣는 값은 `Recruiting` / `Not Recruiting` **이진** 이다(실측). 후자를
 * `completed` 로 접으면 거짓이 된다 — 완료·중단·모집종료를 한데 묶은 굵은 통이라
 * 여덟 개 중 어느 것과도 같지 않다. 어휘의 정의대로 `other`(매핑 없음)이고,
 * `unknown`(레지스트리가 모른다)이 아니다. 원문은 `statusRaw` 가 보존한다.
 */
function toStatus(raw: string): TrialRecord['status'] {
  return raw.trim().toLowerCase() === 'recruiting' ? 'recruiting' : 'other';
}

/**
 * 결과 행 하나를 레코드로. **행이 싣지 않는 것은 만들어 내지 않는다** — 조건·단계·
 * 등록 인원은 이 화면에 없으므로 비운다. 등록일은 `dates.start` 에 넣지 않는다:
 * 그것은 **등록일**이지 시험의 시작일이 아니고, 세 날짜 축을 전부 끈 것과 같은
 * 이유다(다른 것을 같은 이름으로 신고하지 않는다).
 */
export function mapRow(row: IctrpRow, fetchedAt: string): TrialRecord {
  return {
    id: formatTrialId('ictrp', row.trialId),
    registry: 'ictrp',
    registryId: row.trialId,
    url: `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(row.trialId)}`,
    title: row.title,
    status: toStatus(row.statusRaw),
    ...(row.statusRaw ? { statusRaw: row.statusRaw } : {}),
    conditions: [],
    fetchedAt,
  };
}

/**
 * 레코드 페이지의 모집 상태 → 공통 어휘.
 *
 * **잰 값만 매핑한다.** 표본은 다섯 건이고(NCT·ISRCTN·ChiCTR·ACTRN·JPRN, 2026-08-27)
 * 거기서 본 것은 `Completed`·`Recruiting`·`Not yet recruiting`·`Pending` 이다. ICTRP 가
 * 쓰는 어휘 전체를 본 것이 아니므로 못 본 값은 추측해 접지 않고 `other` + 원문이다.
 *
 * `Pending` 을 `not_yet_recruiting` 으로 접고 싶어지지만 그 둘이 같다는 근거가 없다 —
 * 포털이 뜻을 적어 두지 않는다. 접으면 그 시험이 조용히 다른 것으로 신고된다.
 */
const RECORD_STATUS: Record<string, TrialRecord['status']> = {
  'recruiting': 'recruiting',
  'not yet recruiting': 'not_yet_recruiting',
  'completed': 'completed',
  'suspended': 'suspended',
  'terminated': 'terminated',
  'withdrawn': 'withdrawn',
  'enrolling by invitation': 'enrolling_by_invitation',
  'active, not recruiting': 'active_not_recruiting',
};

/**
 * 단계 표기가 레지스트리마다 다르다(실측): ctgov 계열은 `Phase 3`, JPRN 은 맨 `3`,
 * 해당 없음은 `N/A` 와 `Not Applicable` 둘 다 나온다. 앞의 `Phase ` 를 벗기고 숫자만
 * 남기면 두 표기가 하나로 모인다.
 */
function toPhase(raw: string): TrialPhase | undefined {
  const s = raw.trim().toLowerCase();
  if (s === 'n/a' || s === 'not applicable' || s === 'na') return 'na';
  const n = /^(?:phase\s*)?([0-4])$/.exec(s)?.[1];
  if (n === '0') return 'early_phase_1';
  if (n !== undefined) return `phase_${n}` as TrialPhase;
  return undefined;
}

const RECORD_STUDY_TYPE: Record<string, TrialRecord['studyType']> = {
  'interventional': 'interventional',
  'observational study': 'observational',
  'observational': 'observational',
  'expanded access': 'expanded_access',
};

/**
 * 레코드 페이지 하나를 `TrialRecord` 로. `mapRow` 와 달리 TRDS 항목이 다 있어 훨씬
 * 충실하다 — 특히 **상태가 이진이 아니다.**
 *
 * 없는 항목은 비운다. 등록일(`dateOfRegistration`)은 **어디에도 넣지 않는다**: 이 스키마의
 * 세 날짜 축(갱신·시작·완료) 중 어느 것도 아니고, 뜻이 다른 것을 같은 이름으로 신고하지
 * 않는 것이 이 어댑터가 날짜 축을 전부 끈 이유와 같다.
 */
/**
 * `caps.locations` 는 **CLI 가 정하는 정책** 이고 어댑터는 읽기만 한다(스펙 §5.2).
 * 여기서 자체 상수를 쓰거나 캡을 무시하면 `--include locations` 로 캡을 올린 호출자가
 * 그 효과를 못 받고, 반대로 좁힌 호출자는 요청보다 많이 받는다. 계약 스위트가 이 자리를
 * 검사하고, 실제로 이 어댑터의 첫 판이 그 검사에 걸렸다.
 */
export function mapRecord(
  rec: IctrpRecord,
  registryId: string,
  fetchedAt: string,
  capLocations: number,
): TrialRecord {
  const statusRaw = rec.recruitmentStatus;
  const phase = rec.phase !== undefined ? toPhase(rec.phase) : undefined;
  const studyType = rec.studyType !== undefined
    ? RECORD_STUDY_TYPE[rec.studyType.trim().toLowerCase()]
    : undefined;
  const count = rec.targetSampleSize !== undefined ? Number(rec.targetSampleSize) : undefined;

  return {
    id: formatTrialId('ictrp', registryId),
    registry: 'ictrp',
    registryId,
    url: `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(registryId)}`,
    title: rec.publicTitle,
    ...(rec.scientificTitle ? { officialTitle: rec.scientificTitle } : {}),
    status: statusRaw !== undefined ? RECORD_STATUS[statusRaw.trim().toLowerCase()] ?? 'other' : 'unknown',
    ...(statusRaw ? { statusRaw } : {}),
    ...(phase ? { phase: [phase] } : {}),
    ...(rec.phase ? { phaseRaw: [rec.phase] } : {}),
    ...(studyType ? { studyType } : {}),
    ...(rec.studyType ? { studyTypeRaw: rec.studyType } : {}),
    conditions: rec.conditions,
    ...(rec.interventions.length > 0
      ? { interventions: rec.interventions.map((name) => ({ name })) } : {}),
    ...(rec.primarySponsor ? { sponsor: { lead: rec.primarySponsor } } : {}),
    ...(count !== undefined && Number.isFinite(count)
      ? { enrollment: { count, basis: 'estimated' as const } } : {}),
    ...(rec.firstEnrolment ? { dates: { start: rec.firstEnrolment } } : {}),
    ...(rec.countries.length > 0
      ? {
          locations: rec.countries.slice(0, capLocations).map((country) => ({ country })),
          // 캡에 걸렸든 아니든 **진짜 개수** 를 남긴다 — 그래야 호출자가 목록이 전부인지
          // 아닌지 알 수 있다. ctgov 가 같은 자리에서 하는 것과 같다.
          locationsTotal: rec.countries.length,
        }
      : {}),
    ...(rec.lastRefreshedOn ? { sourceRefreshedAt: rec.lastRefreshedOn } : {}),
    fetchedAt,
  };
}
