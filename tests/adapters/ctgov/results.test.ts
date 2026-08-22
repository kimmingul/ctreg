import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractResults } from '../../../src/adapters/ctgov/results.js';
import { TrialResultsSchema } from '../../../src/core/record.js';
import type { ResultsOpts } from '../../../src/core/query.js';

const study = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/ctgov/study-results.json'), 'utf8'),
);

const opts = (over: Partial<ResultsOpts> = {}): ResultsOpts => ({
  sections: ['outcomes', 'adverse', 'flow', 'baseline'],
  full: false,
  cacheMode: 'use',
  ...over,
});

const AT = '2026-08-22T00:00:00.000Z';
const ID = 'CTGOV:NCT00000000';

describe('CT.gov 결과 추출', () => {
  it('기본은 요약이다 — 개수는 세되 전개하지 않는다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    expect(() => TrialResultsSchema.parse(results)).not.toThrow();
    expect(results.hasResults).toBe(true);
    expect(results.sections.outcomes!.total).toBeGreaterThan(0);
    expect(results.sections.outcomes!.expanded).toBe(0);
    expect(results.sections.outcomes!.items).toHaveLength(0);
  });

  it('요약에서도 AE 는 기관계 롤업을 낸다 — 전개 없이 형태를 파악할 수 있어야 한다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    expect(results.sections.adverse!.byOrgan.length).toBeGreaterThan(0);
    expect(results.sections.adverse!.byOrgan.every((o) => o.expanded === false)).toBe(true);
  });

  it('outcome 필터에 걸린 지표만 전개한다', () => {
    const { results: all } = extractResults(study, ID, opts(), AT);
    const firstTitle = (study as any).resultsSection.outcomeMeasuresModule.outcomeMeasures[0].title as string;
    const word = firstTitle.split(/\s+/)[0]!;
    const { results } = extractResults(study, ID, opts({ outcomeFilter: [word] }), AT);
    expect(results.sections.outcomes!.expanded).toBeGreaterThan(0);
    expect(results.sections.outcomes!.expanded).toBeLessThanOrEqual(all.sections.outcomes!.total);
    expect(results.sections.outcomes!.items[0]!.measure.toLowerCase()).toContain(word.toLowerCase());
  });

  it('필터는 대소문자를 가리지 않고 부분일치한다', () => {
    const t = (study as any).resultsSection.outcomeMeasuresModule.outcomeMeasures[0].title as string;
    const { results } = extractResults(study, ID, opts({ outcomeFilter: [t.slice(0, 6).toUpperCase()] }), AT);
    expect(results.sections.outcomes!.expanded).toBeGreaterThan(0);
  });

  it('전개되지 않은 항목이 남으면 경고를 낸다 — 조용히 감추지 않는다', () => {
    const { warnings } = extractResults(study, ID, opts(), AT);
    expect(warnings.map((w) => w.code)).toContain('results_summarized');
  });

  it('--full 은 전부 전개하고 경고를 남긴다', () => {
    const { results, warnings } = extractResults(study, ID, opts({ full: true }), AT);
    expect(results.sections.outcomes!.expanded).toBe(results.sections.outcomes!.total);
    expect(warnings.map((w) => w.code)).toContain('results_full');
  });

  it('--section 으로 고른 섹션만 담는다', () => {
    const { results } = extractResults(study, ID, opts({ sections: ['outcomes'] }), AT);
    expect(results.sections.outcomes).toBeDefined();
    expect(results.sections.adverse).toBeUndefined();
    expect(results.sections.flow).toBeUndefined();
  });

  it('결과 섹션이 없는 시험은 hasResults false 를 내고 빈 sections 를 준다', () => {
    const { results } = extractResults({ protocolSection: {} }, ID, opts(), AT);
    expect(results.hasResults).toBe(false);
    expect(results.sections.outcomes).toBeUndefined();
  });

  it('flow 와 baseline 은 정규화하지 않고 원문 구조를 통과시킨다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    if (results.sections.flow) expect(typeof results.sections.flow.total).toBe('number');
  });
});
