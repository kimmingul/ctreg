/**
 * ClinicalTrials.gov 의 대문자 enum 값과 레지스트리 중립 폐쇄 어휘 사이의 양방향 매핑.
 *
 * `unknown` 과 `other` 는 서로 다르다: `unknown` 은 레지스트리가 모른다고 말했거나 필드가 아예 없는
 * 경우, `other` 는 값은 있지만 우리 어휘에 대응하는 슬롯이 없는 경우다 (예: 확대접근 상태들).
 * 무손실 매핑이 깨지는 자리에는 항상 `*Raw` 를 남겨 원문을 복구할 수 있게 한다 — 단, 필드가 정말
 * 없을 때는 `*Raw` 도 만들지 않는다.
 */

import { isFilterablePhase, isFilterableStatus, type StudyType, type TrialPhase, type TrialStatus } from '../../core/vocab.js';
import { usageError } from '../../runtime/errors.js';

const STATUS_IN: Record<string, TrialStatus> = {
  RECRUITING: 'recruiting',
  NOT_YET_RECRUITING: 'not_yet_recruiting',
  ENROLLING_BY_INVITATION: 'enrolling_by_invitation',
  ACTIVE_NOT_RECRUITING: 'active_not_recruiting',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
  COMPLETED: 'completed',
  WITHDRAWN: 'withdrawn',
  UNKNOWN: 'unknown',
};

/**
 * 역매핑은 정방향에서 파생한다 — 두 테이블이 어긋나는 사고를 원천 차단한다.
 * `STATUS_IN['UNKNOWN']` 은 `'unknown'` 으로 매핑되지만, `isFilterableStatus` 로 걸러내지 않으면
 * 파생된 역매핑에 `unknown -> 'UNKNOWN'` 이 그대로 들어가 필터 입력으로 다시 쓰일 수 있다.
 */
const STATUS_OUT = Object.fromEntries(
  Object.entries(STATUS_IN)
    .filter(([, v]) => isFilterableStatus(v))
    .map(([k, v]) => [v, k]),
) as Partial<Record<TrialStatus, string>>;

/** CT.gov OverallStatus 원문 → 공통 어휘. 필드가 없으면 statusRaw 를 만들지 않는다. */
export function toStatus(raw?: string): { status: TrialStatus; statusRaw?: string } {
  if (raw === undefined || raw === '') return { status: 'unknown' };
  const mapped = STATUS_IN[raw];
  return { status: mapped ?? 'other', statusRaw: raw };
}

/** 공통 어휘 → CT.gov OverallStatus 필터 값. `unknown`/`other` 는 검색 조건이 될 수 없다. */
export function fromStatus(s: TrialStatus): string {
  const out = STATUS_OUT[s];
  if (!out) {
    throw usageError(
      `'${s}' 로는 필터를 걸 수 없습니다`,
      "'unknown' 과 'other' 는 매핑 결과일 뿐 검색 조건이 아닙니다.",
    );
  }
  return out;
}

const PHASE_IN: Record<string, TrialPhase> = {
  EARLY_PHASE1: 'early_phase_1',
  PHASE1: 'phase_1',
  PHASE2: 'phase_2',
  PHASE3: 'phase_3',
  PHASE4: 'phase_4',
  NA: 'na',
};

/** 같은 이유로 필터링한다 — PHASE_IN 에 언젠가 'other'/'unknown' 계열 값이 추가되어도 안전하다. */
const PHASE_OUT = Object.fromEntries(
  Object.entries(PHASE_IN)
    .filter(([, v]) => isFilterablePhase(v))
    .map(([k, v]) => [v, k]),
) as Partial<Record<TrialPhase, string>>;

/** CT.gov Phase 배열 원문 → 공통 어휘. 배열을 그대로 보존한다 — 결합 값을 만들지 않는다. */
export function toPhases(raw?: string[]): { phase?: TrialPhase[]; phaseRaw?: string[] } {
  if (!raw || raw.length === 0) return {};
  return { phase: raw.map((p) => PHASE_IN[p] ?? 'other'), phaseRaw: raw };
}

/** 공통 어휘 → AREA[Phase] 필터에 쓸 CT.gov enum 값. `unknown`/`other` 는 검색 조건이 될 수 없다. */
export function fromPhase(p: TrialPhase): string {
  const out = PHASE_OUT[p];
  if (!out) {
    throw usageError(
      `'${p}' 로는 필터를 걸 수 없습니다`,
      "'unknown' 과 'other' 는 매핑 결과일 뿐 검색 조건이 아닙니다.",
    );
  }
  return out;
}

const STUDY_TYPE_IN: Record<string, StudyType> = {
  INTERVENTIONAL: 'interventional',
  OBSERVATIONAL: 'observational',
  EXPANDED_ACCESS: 'expanded_access',
};

/** CT.gov StudyType 원문 → 공통 어휘. 필드가 없으면 아무 키도 만들지 않는다. */
export function toStudyType(raw?: string): { studyType?: StudyType; studyTypeRaw?: string } {
  if (raw === undefined || raw === '') return {};
  const mapped = STUDY_TYPE_IN[raw];
  return { studyType: mapped ?? 'other', studyTypeRaw: raw };
}
