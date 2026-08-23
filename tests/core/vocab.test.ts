import { describe, expect, it } from 'vitest';
import {
  FILTERABLE_PHASE,
  FILTERABLE_STATUS,
  FILTERABLE_STUDY_TYPE,
  STUDY_TYPE,
  TRIAL_PHASE,
  TRIAL_STATUS,
  isFilterablePhase,
  isFilterableStatus,
} from '../../src/core/vocab.js';

describe('폐쇄 어휘', () => {
  it('status 는 10개 값이고 unknown 과 other 를 모두 포함한다', () => {
    expect(TRIAL_STATUS).toHaveLength(10);
    expect(TRIAL_STATUS).toContain('recruiting');
    expect(TRIAL_STATUS).toContain('unknown');
    expect(TRIAL_STATUS).toContain('other');
  });

  it('phase 는 스펙이 고정한 7개 값이며, 결합 값(phase_1_2)을 두지 않는다 — 배열로 무손실 보존하기 때문', () => {
    expect(TRIAL_PHASE).toEqual([
      'early_phase_1',
      'phase_1',
      'phase_2',
      'phase_3',
      'phase_4',
      'na',
      'other',
    ]);
    expect(TRIAL_PHASE).not.toContain('phase_1_2');
  });

  it('studyType 은 4개 값이다', () => {
    expect(STUDY_TYPE).toEqual(['interventional', 'observational', 'expanded_access', 'other']);
  });

  it('unknown 과 other 는 필터 입력으로 받지 않는다', () => {
    expect(isFilterableStatus('recruiting')).toBe(true);
    expect(isFilterableStatus('unknown')).toBe(false);
    expect(isFilterableStatus('other')).toBe(false);
    expect(isFilterableStatus('nonsense')).toBe(false);
  });

  it('phase 도 other 를 필터 입력으로 받지 않는다', () => {
    expect(isFilterablePhase('phase_3')).toBe(true);
    expect(isFilterablePhase('other')).toBe(false);
  });
});

describe('필터로 쓸 수 있는 값 목록', () => {
  /**
   * `unknown` 과 `other` 는 **매핑 결과**이지 검색 조건이 아니다 — 어휘에 자리가
   * 없는 값을 받았을 때 붙이는 이름이라, 그것으로 필터를 걸어 달라고 할 수 없다.
   * 목록을 손으로 적으면 이 규칙이 목록마다 다시 지켜져야 하므로 술어로 거른다.
   */
  it('unknown 과 other 를 뺀 나머지 전부다', () => {
    // `v: string` — TRIAL_PHASE/STUDY_TYPE 어휘엔 'unknown' 이 없어, 리터럴 타입 그대로 비교하면
    // strict 모드가 "겹칠 수 없는 비교"로 막는다. 값 비교의 의도는 그대로이므로 타입만 넓힌다.
    expect(FILTERABLE_STATUS).toEqual(TRIAL_STATUS.filter((v: string) => v !== 'unknown' && v !== 'other'));
    expect(FILTERABLE_PHASE).toEqual(TRIAL_PHASE.filter((v: string) => v !== 'unknown' && v !== 'other'));
    expect(FILTERABLE_STUDY_TYPE).toEqual(STUDY_TYPE.filter((v: string) => v !== 'unknown' && v !== 'other'));
  });

  it('비어 있지 않다 — 빈 목록은 "필터를 걸 수 없다" 로 읽힌다', () => {
    expect(FILTERABLE_STATUS.length).toBeGreaterThan(0);
    expect(FILTERABLE_PHASE.length).toBeGreaterThan(0);
    expect(FILTERABLE_STUDY_TYPE.length).toBeGreaterThan(0);
  });
});
