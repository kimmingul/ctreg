import { describe, expect, it } from 'vitest';
import {
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

  it('phase 에는 결합 값(phase_1_2)을 두지 않는다 — 배열로 무손실 보존하기 때문', () => {
    expect(TRIAL_PHASE).not.toContain('phase_1_2');
    expect(TRIAL_PHASE).toContain('phase_1');
    expect(TRIAL_PHASE).toContain('na');
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
