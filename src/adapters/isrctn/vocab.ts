/**
 * ISRCTN 의 WHO 포맷 값과 레지스트리 중립 폐쇄 어휘 사이의 매핑.
 *
 * ctgov 쪽 매핑과 달리 **역매핑(공통 어휘 → ISRCTN 값)이 없다.** 필요가 없어서가
 * 아니라 쓸 자리가 없어서다: ISRCTN 은 상태로 검색할 수 없고(`trialStatus`·
 * `recruitmentStatus` 둘 다 실측에서 죽어 있다), 단계·연구유형 검색은 `default`
 * 포맷의 질의 어휘(`phase:"Phase III"`, `primaryStudyDesign:Interventional`)를 쓰는데
 * 그 값들은 여기 들어오는 WHO 포맷 값과 우연히 같을 뿐 같은 어휘가 아니다. 두 방향을
 * 한 테이블로 묶으면 그 우연에 의존하게 되므로 질의 쪽 어휘는 query.ts 가 따로 쥔다.
 */

import type { StudyType, TrialPhase, TrialStatus } from '../../core/vocab.js';

/**
 * 정의문이 폐쇄 어휘의 정의와 실제로 겹치는 값만 담는다.
 *
 * 여기 **없는** 값들이 이 테이블의 요점이다:
 * - `No longer recruiting` / `No longer recruited` — 모집만 끝난 것(active_not_recruiting)인지
 *   시험이 끝난 것(completed)인지 ISRCTN 정의문이 말하지 않는다. 둘은 임상적으로 다르다.
 * - `Stopped` — terminated 와 withdrawn 을 가르는 기준은 "참가자가 이미 등록됐는가" 인데
 *   ISRCTN 은 그것을 말하지 않는다.
 * 추측해서 폐쇄 어휘에 넣으면 추측이 사실로 나간다. `other` + `statusRaw` 가 무손실이고,
 * 사용자는 원문을 보고 스스로 판단할 수 있다. (조사 문서 registry-field-survey 의 판정과 같다.)
 */
const STATUS_IN: Record<string, TrialStatus> = {
  'Recruiting': 'recruiting',
  'Not yet recruiting': 'not_yet_recruiting',
  'Suspended': 'suspended',
  'Enrolling by invitation': 'enrolling_by_invitation',
};

export function toStatus(raw?: string): { status: TrialStatus; statusRaw?: string } {
  if (raw === undefined || raw === '') return { status: 'unknown' };
  const mapped = STATUS_IN[raw];
  return { status: mapped ?? 'other', statusRaw: raw };
}

/**
 * 문서 3.2.1.12 의 값 목록. 결합 단계는 두 칸으로 편다 — 스펙 §2.3 이 phase 를 배열로
 * 둔 이유가 이것이고, `Phase I/II` 를 한 칸에 밀어 넣으면 "1상이면서 2상" 이라는 사실이
 * 사라진다. 원문은 `phaseRaw` 에 결합된 채로 남으므로 복구할 수 있다.
 */
const PHASE_IN: Record<string, TrialPhase[]> = {
  'Phase I': ['phase_1'],
  'Phase II': ['phase_2'],
  'Phase III': ['phase_3'],
  'Phase IV': ['phase_4'],
  'Phase I/II': ['phase_1', 'phase_2'],
  'Phase II/III': ['phase_2', 'phase_3'],
  'Phase III/IV': ['phase_3', 'phase_4'],
  'Not Applicable': ['na'],
};

export function toPhase(raw?: string): { phase?: TrialPhase[]; phaseRaw?: string[] } {
  // `Not Specified` 는 "레지스트리가 값을 안 적었다" 는 뜻이다 — 부재를 `other` 로
  // 옮기면 "매핑 못한 값이 있다" 로 읽히고, 그건 사실이 아니다.
  if (raw === undefined || raw === '' || raw === 'Not Specified') return {};
  const mapped = PHASE_IN[raw];
  return { phase: mapped ?? ['other'], phaseRaw: [raw] };
}

const STUDY_TYPE_IN: Record<string, StudyType> = {
  Interventional: 'interventional',
  Observational: 'observational',
};

export function toStudyType(raw?: string): { studyType?: StudyType; studyTypeRaw?: string } {
  if (raw === undefined || raw === '') return {};
  const mapped = STUDY_TYPE_IN[raw];
  return { studyType: mapped ?? 'other', studyTypeRaw: raw };
}
