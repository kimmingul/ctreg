import { describe, expect, it } from 'vitest';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';
import {
  CTGOV_FILTERABLE,
  fromPhase,
  fromStatus,
  fromStudyType,
  toPhases,
  toStatus,
  toStudyType,
} from '../../../src/adapters/ctgov/vocab.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../../../src/core/vocab.js';

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
    expect(toStudyType('OBSERVATIONAL').studyType).toBe('observational');
    expect(toStudyType('WEIRD')).toEqual({ studyType: 'other', studyTypeRaw: 'WEIRD' });
    expect(toStudyType(undefined)).toEqual({});
  });

  /**
   * status/phase 와 같은 규율을 studyType 에도 건다: 역매핑은 정방향 테이블에서
   * 파생하고, 손으로 유지하는 두 번째 테이블을 만들지 않는다. 손 테이블이 어긋나
   * 실제 버그가 났던 자리라 이 규율이 존재한다. 이전에는 query.ts 가
   * `.toUpperCase()` 를 인라인으로 써서, 공통 어휘 문자열과 CT.gov enum 이 우연히
   * 일치한다는 사실에만 기대고 있었다 — 어휘를 하나 더하면(예: 'basic_science')
   * 조용히 없는 enum 을 보내게 된다.
   */
  it('fromStudyType 은 AREA[StudyType] 값으로 쓸 CT.gov enum 을 낸다', () => {
    expect(fromStudyType('interventional')).toBe('INTERVENTIONAL');
    expect(fromStudyType('observational')).toBe('OBSERVATIONAL');
    expect(fromStudyType('expanded_access')).toBe('EXPANDED_ACCESS');
  });

  it("fromStudyType 은 'other' 를 필터 입력으로 받지 않는다 — 매핑 결과일 뿐이다", () => {
    try {
      fromStudyType('other');
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
    }
  });

  it('정방향에 있는 모든 필터 가능 값이 역매핑을 왕복한다', () => {
    for (const t of ['interventional', 'observational', 'expanded_access'] as const) {
      expect(toStudyType(fromStudyType(t)).studyType).toBe(t);
    }
  });
});

describe('ctgov 가 필터로 받는 값', () => {
  /**
   * ctgov 는 공통 어휘 전부를 받는다. 이 사실 자체보다 중요한 것은 **목록이 매핑
   * 테이블에서 파생된다**는 것이다 — 어휘에 값을 하나 더하고 매핑을 빠뜨리면 이
   * 테스트가 그 자리에서 깨진다.
   */
  it('공통 어휘의 필터 가능한 값 전부를 받는다', () => {
    expect([...CTGOV_FILTERABLE.status].sort()).toEqual([...FILTERABLE_STATUS].sort());
    expect([...CTGOV_FILTERABLE.phase].sort()).toEqual([...FILTERABLE_PHASE].sort());
    expect([...CTGOV_FILTERABLE.studyType].sort()).toEqual([...FILTERABLE_STUDY_TYPE].sort());
  });

  it('신고한 값은 전부 실제로 필터 문자열로 변환된다', () => {
    for (const v of CTGOV_FILTERABLE.status) expect(() => fromStatus(v)).not.toThrow();
    for (const v of CTGOV_FILTERABLE.phase) expect(() => fromPhase(v)).not.toThrow();
    for (const v of CTGOV_FILTERABLE.studyType) expect(() => fromStudyType(v)).not.toThrow();
  });
});
