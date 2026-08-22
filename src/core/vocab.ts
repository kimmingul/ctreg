/** 레지스트리 간 공통 폐쇄 어휘. `unknown`(레지스트리가 모른다) 과 `other`(매핑 없음) 는 다르다. */

export const TRIAL_STATUS = [
  'recruiting',
  'not_yet_recruiting',
  'enrolling_by_invitation',
  'active_not_recruiting',
  'suspended',
  'terminated',
  'completed',
  'withdrawn',
  'unknown',
  'other',
] as const;
export type TrialStatus = (typeof TRIAL_STATUS)[number];

export const TRIAL_PHASE = [
  'early_phase_1',
  'phase_1',
  'phase_2',
  'phase_3',
  'phase_4',
  'na',
  'other',
] as const;
export type TrialPhase = (typeof TRIAL_PHASE)[number];

export const STUDY_TYPE = ['interventional', 'observational', 'expanded_access', 'other'] as const;
export type StudyType = (typeof STUDY_TYPE)[number];

/** 사용자가 `--status` 로 넣을 수 있는 값. `unknown`/`other` 로 거르는 것은 의미가 없다. */
const NOT_FILTERABLE = new Set<string>(['unknown', 'other']);

export function isFilterableStatus(v: string): v is TrialStatus {
  return !NOT_FILTERABLE.has(v) && (TRIAL_STATUS as readonly string[]).includes(v);
}

export function isFilterablePhase(v: string): v is TrialPhase {
  return !NOT_FILTERABLE.has(v) && (TRIAL_PHASE as readonly string[]).includes(v);
}

/** studyType 도 마찬가지다 — `other` 는 매핑 결과이지 필터 입력이 아니다. */
export function isFilterableStudyType(v: string): v is StudyType {
  return !NOT_FILTERABLE.has(v) && (STUDY_TYPE as readonly string[]).includes(v);
}
