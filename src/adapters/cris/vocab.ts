/**
 * CRIS 가 내는 한국어 값 → 공통 어휘.
 *
 * **표는 실측에서 나왔다**(2026-08-28, 공식 목록 API 200건 표본). 문서에 열거된 목록이
 * 아니라 실제로 나온 값이므로, 표에 없는 값이 언제든 올 수 있다 — 그때 `undefined` 를
 * 돌려주고 `map.ts` 가 `other` 로 신고한다. 모르는 값을 아는 값처럼 접지 않는다.
 */

import type { StudyType, TrialPhase } from '../../core/vocab.js';

/** 실측 분포(표본 200): 중재연구 179, 관찰연구 21. */
const STUDY_TYPE: Record<string, StudyType> = {
  중재연구: 'interventional',
  관찰연구: 'observational',
};

/**
 * 실측 분포(표본 200): `해당사항없음` 160, 빈 문자열 19, 필드 없음 21.
 *
 * **이 필드는 대체로 비어 있다.** 중재연구가 179건인데 상 값이 실린 것은 하나도 없었다 —
 * CRIS 가 상을 안 받는 것이 아니라 목록 API 가 이 자리를 잘 채우지 않는다. 그래서
 * `phase` 로 무엇을 판단하면 안 되고, 이 어댑터는 상 검색을 지원하지 않는다고 신고한다.
 */
const PHASE: Record<string, TrialPhase> = {
  해당사항없음: 'na',
  '1상': 'phase_1',
  '2상': 'phase_2',
  '3상': 'phase_3',
  '4상': 'phase_4',
  '초기1상': 'early_phase_1',
};

export const toStudyType = (raw: string | undefined): StudyType | undefined =>
  raw === undefined || raw === '' ? undefined : (STUDY_TYPE[raw] ?? 'other');

export const toPhase = (raw: string | undefined): TrialPhase | undefined =>
  raw === undefined || raw === '' ? undefined : (PHASE[raw] ?? 'other');
