import { describe, expect, it } from 'vitest';
import { toPhase, toStatus, toStudyType } from '../../../src/adapters/isrctn/vocab.js';

describe('ISRCTN 상태 어휘', () => {
  it('레지스트리 정의와 폐쇄 어휘의 정의가 일치하는 값만 매핑한다', () => {
    expect(toStatus('Recruiting')).toEqual({ status: 'recruiting', statusRaw: 'Recruiting' });
    expect(toStatus('Not yet recruiting')).toEqual({ status: 'not_yet_recruiting', statusRaw: 'Not yet recruiting' });
    expect(toStatus('Suspended')).toEqual({ status: 'suspended', statusRaw: 'Suspended' });
    expect(toStatus('Enrolling by invitation')).toEqual({
      status: 'enrolling_by_invitation',
      statusRaw: 'Enrolling by invitation',
    });
  });

  /**
   * 조사 문서(registry-field-survey)가 이미 판정한 값들이다: ISRCTN 의 "No longer
   * recruited" 류는 "모집만 끝났다(active_not_recruiting)"인지 "시험이 끝났다(completed)"인지
   * 정의문이 말해주지 않고, "Stopped" 는 terminated 와 withdrawn 을 가르는 기준 —
   * 참가자가 이미 등록됐는지 — 을 말해주지 않는다. 추측해서 폐쇄 어휘에 밀어 넣으면
   * 그 추측이 사실처럼 나간다. `other` + `statusRaw` 가 무손실이다.
   */
  it('정의가 모호한 값은 추측하지 않고 other 로 두되 원문을 남긴다', () => {
    expect(toStatus('No longer recruiting')).toEqual({ status: 'other', statusRaw: 'No longer recruiting' });
    expect(toStatus('No longer recruited')).toEqual({ status: 'other', statusRaw: 'No longer recruited' });
    expect(toStatus('Stopped')).toEqual({ status: 'other', statusRaw: 'Stopped' });
  });

  it('값이 없으면 unknown 이고 statusRaw 를 만들지 않는다 — 없는 것과 모르는 것은 다르다', () => {
    expect(toStatus(undefined)).toEqual({ status: 'unknown' });
    expect(toStatus('')).toEqual({ status: 'unknown' });
  });
});

describe('ISRCTN 단계 어휘', () => {
  it('단일 단계를 매핑한다', () => {
    expect(toPhase('Phase I')).toEqual({ phase: ['phase_1'], phaseRaw: ['Phase I'] });
    expect(toPhase('Phase IV')).toEqual({ phase: ['phase_4'], phaseRaw: ['Phase IV'] });
    expect(toPhase('Not Applicable')).toEqual({ phase: ['na'], phaseRaw: ['Not Applicable'] });
  });

  /** 결합 단계는 배열로 무손실 보존한다 — 스펙 §2.3 이 배열로 둔 이유가 이것이다. */
  it('결합 단계를 배열 두 칸으로 편다', () => {
    expect(toPhase('Phase I/II')).toEqual({ phase: ['phase_1', 'phase_2'], phaseRaw: ['Phase I/II'] });
    expect(toPhase('Phase II/III')).toEqual({ phase: ['phase_2', 'phase_3'], phaseRaw: ['Phase II/III'] });
    expect(toPhase('Phase III/IV')).toEqual({ phase: ['phase_3', 'phase_4'], phaseRaw: ['Phase III/IV'] });
  });

  it("'Not Specified' 와 빈 값은 단계를 만들지 않는다 — 부재는 부재다", () => {
    expect(toPhase('Not Specified')).toEqual({});
    expect(toPhase(undefined)).toEqual({});
  });

  it('모르는 값은 other 로 두되 원문을 남긴다', () => {
    expect(toPhase('Phase 0')).toEqual({ phase: ['other'], phaseRaw: ['Phase 0'] });
  });
});

describe('ISRCTN 연구유형 어휘', () => {
  it('두 값을 매핑한다', () => {
    expect(toStudyType('Interventional')).toEqual({ studyType: 'interventional', studyTypeRaw: 'Interventional' });
    expect(toStudyType('Observational')).toEqual({ studyType: 'observational', studyTypeRaw: 'Observational' });
  });

  it('값이 없으면 아무것도 만들지 않는다', () => {
    expect(toStudyType(undefined)).toEqual({});
  });

  it('모르는 값은 other 로 두되 원문을 남긴다', () => {
    expect(toStudyType('Basic science')).toEqual({ studyType: 'other', studyTypeRaw: 'Basic science' });
  });
});
