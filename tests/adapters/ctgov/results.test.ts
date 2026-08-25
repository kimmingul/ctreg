import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractResults } from '../../../src/adapters/ctgov/results.js';
import { TrialResultsSchema } from '../../../src/core/record.js';
import type { ResultsOpts } from '../../../src/core/query.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import { CtregError } from '../../../src/runtime/errors.js';

// 결과 추출 픽스처와 Task 10 매핑 픽스처는 의도적으로 같은 시험(study-full.json,
// NCT04280705)을 쓴다 — 둘 다 실제 응답을 검증에 쓰지만, 별도 파일로 두면 한쪽만
// 갱신됐을 때 두 테스트가 같은 시험에 대해 서로 다른 내용을 전제하게 되는
// 드리프트 위험이 생긴다. 실제로 resultsSection 이 있는 픽스처는 이거 하나뿐이다.
const study = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/ctgov/study-full.json'), 'utf8'),
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

  it('aeOrganFilter 는 조직계로 AE 를 필터링한다', () => {
    // NCT04280705 픽스처: 전체 110건 중 organSystem 에 'Cardiac' 을 포함하는 건 15건.
    const { results } = extractResults(
      study,
      ID,
      opts({ sections: ['adverse'], aeOrganFilter: 'Cardiac' }),
      AT,
    );
    expect(results.sections.adverse!.total).toBe(110);
    expect(results.sections.adverse!.expanded).toBe(15);
    expect(
      results.sections.adverse!.items.every((i) => (i.organ ?? '').toLowerCase().includes('cardiac')),
    ).toBe(true);
  });

  it('aeTermFilter 는 용어로 AE 를 필터링한다', () => {
    // 같은 픽스처: 전체 110건 중 term 에 'anaemia' 를 포함하는 건 2건(둘 다 'Anaemia').
    const { results } = extractResults(
      study,
      ID,
      opts({ sections: ['adverse'], aeTermFilter: 'anaemia' }),
      AT,
    );
    expect(results.sections.adverse!.total).toBe(110);
    expect(results.sections.adverse!.expanded).toBe(2);
    expect(results.sections.adverse!.items.every((i) => i.term.toLowerCase().includes('anaemia'))).toBe(
      true,
    );
  });

  it('AE 롤업의 전개 여부는 organ+term 복합키로 판정한다 — 서로 다른 기관계의 동일 term 을 잘못 전개된 것으로 표시하지 않는다', () => {
    // term 만으로 판정하면, 필터링되지 않은 기관계라도 다른(필터링된) 기관계에
    // 동일한 term 이 있으면 expanded: true 로 잘못 표시된다 — MedDRA 코드 특성상
    // 서로 다른 기관계에 같은 용어가 실제로 나타날 수 있어 이 픽스처로는 재현되지
    // 않는 케이스를 직접 구성해서 고정한다.
    const synthetic = {
      protocolSection: { identificationModule: { nctId: 'NCT00000000' } },
      resultsSection: {
        adverseEventsModule: {
          seriousEvents: [],
          otherEvents: [
            { term: 'Headache', organSystem: 'Nervous system disorders', stats: [] },
            { term: 'Headache', organSystem: 'Cardiac disorders', stats: [] },
          ],
        },
      },
    };
    const { results } = extractResults(
      synthetic,
      ID,
      opts({ sections: ['adverse'], aeOrganFilter: 'Nervous' }),
      AT,
    );
    const byOrgan = results.sections.adverse!.byOrgan;
    const nervous = byOrgan.find((o) => o.organ === 'Nervous system disorders');
    const cardiac = byOrgan.find((o) => o.organ === 'Cardiac disorders');
    expect(nervous?.expanded).toBe(true);
    expect(cardiac?.expanded).toBe(false);
  });

  it('전개되지 않은 항목이 남으면 경고를 낸다 — 조용히 감추지 않는다', () => {
    const { warnings } = extractResults(study, ID, opts(), AT);
    expect(warnings.map((w) => w.code)).toContain('results_summarized');
  });

  /**
   * F6. 한 코드가 두 상황을 덮고 있었다 — **아무것도 안 펼친 것** 과 **일부만 펼친 것**.
   * 후자에서 `results_summarized` 의 문구("요약만 냈습니다. --outcome / --ae-organ /
   * --ae-term 으로 필요한 항목만 전개하세요")는 **거짓** 이다: 호출자는 이미 필터를 썼고
   * 펼쳐진 항목도 받았다. 이미 한 일을 하라고 시키는 경고는 오독을 막는 대신 새 오독을
   * 만든다(F4 와 같은 뿌리).
   */
  it('일부만 펼쳤으면 전개 전과 다른 코드를 낸다', () => {
    const { results, warnings } = extractResults(study, ID, opts({ outcomeFilter: ['Time to Recovery'] }), AT);
    const o = results.sections.outcomes!;
    // 이 픽스처에서 필터가 실제로 일부만 고르는지 먼저 고정한다 — 0 이나 전부면
    // 이 검사는 다른 상황을 보고 있는 것이고, 제목이 거짓말하게 된다.
    expect(o.expanded).toBeGreaterThan(0);
    expect(o.expanded).toBeLessThan(o.total);

    const codes = warnings.map((w) => w.code);
    expect(codes).toContain('results_partially_expanded');
    expect(codes).not.toContain('results_summarized');
  });

  it('아무것도 안 펼쳤으면 results_summarized 그대로다 — 두 상황이 갈렸을 뿐이다', () => {
    const codes = extractResults(study, ID, opts(), AT).warnings.map((w) => w.code);
    expect(codes).toContain('results_summarized');
    expect(codes).not.toContain('results_partially_expanded');
  });

  /**
   * flow/baseline 은 필터가 없는 섹션이라 `--full` 없이는 개수만 나간다. 그 사실도
   * 경고가 말해야 한다 — 이 두 섹션만 요청했을 때 침묵하면, 감춘 항목이 있는데
   * 아무도 그것을 말하지 않는 상태가 된다.
   *
   * 사보타주로 이 자리가 무방비였음을 확인하고 넣었다: 두 섹션의 계수를 빼도
   * 465개가 전부 통과했다. outcomes/adverse 가 늘 함께 있는 픽스처로만 검사하면
   * 이 이음매는 원리상 드러나지 않는다.
   */
  it('flow 만 요청해도 전개되지 않은 항목을 경고한다', () => {
    const { results, warnings } = extractResults(study, ID, opts({ sections: ['flow'] }), AT);
    expect(results.sections.flow!.total).toBeGreaterThan(0);
    expect(results.sections.flow!.items).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain('results_summarized');
  });

  it('baseline 만 요청해도 마찬가지다', () => {
    const { results, warnings } = extractResults(study, ID, opts({ sections: ['baseline'] }), AT);
    expect(results.sections.baseline!.total).toBeGreaterThan(0);
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
    const noResults = { protocolSection: { identificationModule: { nctId: 'NCT00000000' } } };
    const { results } = extractResults(noResults, ID, opts(), AT);
    expect(results.hasResults).toBe(false);
    expect(results.sections.outcomes).toBeUndefined();
  });

  /**
   * I2 회귀. "이 시험은 결과를 게시하지 않았다" 는 임상적 주장이다. 잘린 응답,
   * `{}` 를 내주는 미러, 업스트림 스키마 변경이 모두 그 주장으로 둔갑하면 안 된다 —
   * mapStudy 는 같은 계층에서 정반대로 하고 있었다(객체가 아니면 던지고, nctId 가
   * 없으면 던진다). 같은 규칙을 여기에도 적용한다.
   */
  it('study 페이로드가 아니면 빈 결과가 아니라 크게 던진다', () => {
    for (const bad of [null, 42, 'a string', {}, { protocolSection: {} }]) {
      expect(() => extractResults(bad, ID, opts(), AT)).toThrow(CtregError);
    }
  });

  /**
   * I2 회귀 (출력). OutcomeResultSchema/AdverseEventSchema 는 존재만 하고 런타임에
   * 한 번도 파싱되지 않는 타입이었다 — measure 없는 outcome, term 없는 이상반응이
   * 그대로 봉투로 나갔다. mapStudy 가 TrialRecordSchema 로 자기 출력을 검증하는 것과
   * 같은 규율을 건다.
   */
  it('계약을 못 지키는 항목은 통과시키지 않고 던진다', () => {
    const noMeasure = {
      protocolSection: { identificationModule: { nctId: 'NCT00000000' } },
      resultsSection: { outcomeMeasuresModule: { outcomeMeasures: [{ type: 'PRIMARY' }] } },
    };
    expect(() => extractResults(noMeasure, ID, opts({ full: true }), AT)).toThrow(CtregError);

    const noTerm = {
      protocolSection: { identificationModule: { nctId: 'NCT00000000' } },
      resultsSection: {
        adverseEventsModule: { seriousEvents: [{ organSystem: 'Cardiac', stats: [{ numAtRisk: 120 }] }] },
      },
    };
    expect(() => extractResults(noTerm, ID, opts({ full: true }), AT)).toThrow(CtregError);
  });

  it('던지는 오류는 어느 필드가 계약을 어겼는지 이름을 부른다', () => {
    const noMeasure = {
      protocolSection: { identificationModule: { nctId: 'NCT00000000' } },
      resultsSection: { outcomeMeasuresModule: { outcomeMeasures: [{ type: 'PRIMARY' }] } },
    };
    try {
      extractResults(noMeasure, ID, opts({ full: true }), AT);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.UPSTREAM);
      expect((e as CtregError).message).toContain('measure');
    }
  });

  it('flow 와 baseline 은 정규화하지 않고 원문 구조를 통과시킨다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    if (results.sections.flow) expect(typeof results.sections.flow.total).toBe('number');
  });

  it('--full 로 전개하면 flow/baseline 항목이 원문 구조와 완전히 동일하다', () => {
    // 위 테스트는 개수 타입만 확인해 통과 여부가 사실상 무의미하다(가드된 if 뒤에
    // number 검사뿐) — --full 로 실제 전개시켜 원문과의 구조적 동일성을 직접 검증한다.
    const rs = (study as any).resultsSection;
    const { results } = extractResults(study, ID, opts({ full: true, sections: ['flow', 'baseline'] }), AT);
    expect(results.sections.flow!.total).toBe(rs.participantFlowModule.periods.length);
    expect(results.sections.flow!.items).toEqual(rs.participantFlowModule.periods);
    expect(results.sections.baseline!.total).toBe(rs.baselineCharacteristicsModule.measures.length);
    expect(results.sections.baseline!.items).toEqual(rs.baselineCharacteristicsModule.measures);
  });
});

/**
 * F13. `--full` 은 **요약할 것인가** 를 정하고, 필터는 **무엇을 고를 것인가** 를 정한다.
 * 예전에는 `keep = full || (필터 ? 매칭 : false)` 라서 `--full` 이 필터를 삼켰다 —
 * 심장 관련만 달라고 하면서 전부 펼쳐 달라고 하면 **전부** 를 받았고, 경고는
 * "페이로드가 클 수 있다" 뿐이라 요청이 무시됐다는 사실은 어디에도 없었다.
 * "조용히 좁히지 않는다" 의 반대 방향(조용히 넓힌다)이지만 같은 계열의 결함이다.
 *
 * 네 조합을 전부 고정한다. 바뀌는 것은 하나뿐이고, 나머지 셋이 그대로라는 것도
 * 검사해야 이 변경이 다른 경로를 건드리지 않았음을 알 수 있다.
 */
describe('F13 — --full 과 필터의 관계', () => {
  const adverse = (over: Partial<ResultsOpts>) =>
    extractResults(study, ID, opts({ sections: ['adverse'], ...over }), AT).results.sections.adverse!;

  it('둘 다 주면 필터가 이긴다 — 심장 관련만, 전부 전개', () => {
    const s = adverse({ full: true, aeOrganFilter: 'Cardiac' });
    expect(s.total).toBe(110);
    expect(s.expanded).toBe(15);
    expect(s.items.every((i) => (i.organ ?? '').toLowerCase().includes('cardiac'))).toBe(true);
  });

  it('--full 단독은 그대로 전부 전개한다', () => {
    const s = adverse({ full: true });
    expect(s.expanded).toBe(110);
  });

  it('필터 단독은 그대로 매칭만 전개한다', () => {
    const s = adverse({ aeOrganFilter: 'Cardiac' });
    expect(s.expanded).toBe(15);
  });

  it('둘 다 없으면 그대로 요약이다', () => {
    const s = adverse({});
    expect(s.expanded).toBe(0);
  });

  /** 결과지표 축도 같은 규칙이다 — 한쪽만 고치면 두 축이 서로 다르게 동작한다. */
  it('결과지표에서도 --full 보다 outcome 필터가 이긴다', () => {
    const all = extractResults(study, ID, opts({ sections: ['outcomes'], full: true }), AT)
      .results.sections.outcomes!;
    const word = all.items[0]!.measure.split(/\s+/)[0]!;
    const filtered = extractResults(
      study, ID, opts({ sections: ['outcomes'], full: true, outcomeFilter: [word] }), AT,
    ).results.sections.outcomes!;
    expect(filtered.expanded).toBeLessThan(all.expanded);
    expect(filtered.items.every((i) => i.measure.toLowerCase().includes(word.toLowerCase()))).toBe(true);
  });

  /**
   * `results_full` 은 유지된다. `flow`/`baseline` 은 필터가 아예 없어서 `--full` 이면
   * 여전히 통째로 전개되므로 "페이로드가 클 수 있다" 는 주장이 계속 참이다.
   */
  it('필터와 함께 써도 results_full 경고는 그대로 난다', () => {
    const { warnings } = extractResults(study, ID, opts({ full: true, aeOrganFilter: 'Cardiac' }), AT);
    expect(warnings.map((w) => w.code)).toContain('results_full');
  });
});
