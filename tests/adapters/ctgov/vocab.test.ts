import { describe, expect, it } from 'vitest';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';
import { fromPhase, fromStatus, toPhases, toStatus, toStudyType } from '../../../src/adapters/ctgov/vocab.js';

describe('CT.gov 어휘 매핑', () => {
  it('알려진 상태를 공통 어휘로 옮기고 원문을 보존한다', () => {
    expect(toStatus('RECRUITING')).toEqual({ status: 'recruiting', statusRaw: 'RECRUITING' });
    expect(toStatus('ACTIVE_NOT_RECRUITING').status).toBe('active_not_recruiting');
    expect(toStatus('WITHDRAWN').status).toBe('withdrawn');
  });

  it('CT.gov 의 UNKNOWN 은 unknown 이고 원문이 남는다', () => {
    expect(toStatus('UNKNOWN')).toEqual({ status: 'unknown', statusRaw: 'UNKNOWN' });
  });

  it('필드가 없으면 unknown 이되 statusRaw 를 만들어내지 않는다', () => {
    expect(toStatus(undefined)).toEqual({ status: 'unknown' });
  });

  it('확대접근 계열은 other 로 떨어지고 원문으로만 판별된다', () => {
    expect(toStatus('AVAILABLE')).toEqual({ status: 'other', statusRaw: 'AVAILABLE' });
    expect(toStatus('APPROVED_FOR_MARKETING').status).toBe('other');
  });

  it('처음 보는 값도 예외 없이 other 로 흡수한다 — 업스트림 enum 추가에 깨지지 않아야 한다', () => {
    expect(toStatus('SOMETHING_NEW')).toEqual({ status: 'other', statusRaw: 'SOMETHING_NEW' });
  });

  it('필터 방향 역매핑은 대문자 CT.gov enum 을 낸다', () => {
    expect(fromStatus('recruiting')).toBe('RECRUITING');
    expect(fromStatus('enrolling_by_invitation')).toBe('ENROLLING_BY_INVITATION');
  });

  it('unknown/other 로는 필터를 걸 수 없다', () => {
    for (const bad of ['unknown', 'other'] as const) {
      try {
        fromStatus(bad);
        expect.unreachable('던져야 한다');
      } catch (e) {
        expect((e as CtregError).exit).toBe(EXIT.USAGE);
      }
    }
  });

  it('phase 는 배열로 무손실 보존한다 — 결합 값을 만들지 않는다', () => {
    expect(toPhases(['PHASE1', 'PHASE2'])).toEqual({
      phase: ['phase_1', 'phase_2'],
      phaseRaw: ['PHASE1', 'PHASE2'],
    });
    expect(toPhases(['NA']).phase).toEqual(['na']);
    expect(toPhases(['EARLY_PHASE1']).phase).toEqual(['early_phase_1']);
  });

  it('모르는 phase 는 other 로 흡수한다', () => {
    expect(toPhases(['PHASE9']).phase).toEqual(['other']);
  });

  it('phase 도 unknown/other 로는 필터를 걸 수 없다', () => {
    for (const bad of ['other'] as const) {
      try {
        fromPhase(bad);
        expect.unreachable('던져야 한다');
      } catch (e) {
        expect((e as CtregError).exit).toBe(EXIT.USAGE);
      }
    }
  });

  it('phase 필드가 없으면 필드 자체를 만들지 않는다', () => {
    expect(toPhases(undefined)).toEqual({});
  });

  it('fromPhase 는 AREA[Phase] 값으로 쓸 CT.gov enum 을 낸다', () => {
    expect(fromPhase('phase_3')).toBe('PHASE3');
    expect(fromPhase('early_phase_1')).toBe('EARLY_PHASE1');
  });

  it('studyType 을 옮긴다', () => {
    expect(toStudyType('INTERVENTIONAL').studyType).toBe('interventional');
    expect(toStudyType('EXPANDED_ACCESS').studyType).toBe('expanded_access');
    expect(toStudyType('WEIRD')).toEqual({ studyType: 'other', studyTypeRaw: 'WEIRD' });
    expect(toStudyType(undefined)).toEqual({});
  });
});
