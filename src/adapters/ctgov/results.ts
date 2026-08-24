import { ZodError } from 'zod';
import type { Warning } from '../../core/capability.js';
import type { ResultsOpts } from '../../core/query.js';
import { TrialResultsSchema, type AdverseEvent, type OutcomeResult, type TrialResults } from '../../core/record.js';
import { upstreamError } from '../../runtime/errors.js';

const OUTCOME_TYPE: Record<string, OutcomeResult['type']> = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
};

const has = (hay: string | undefined, needles: string[]) =>
  hay !== undefined && needles.some((n) => hay.toLowerCase().includes(n.toLowerCase()));

/**
 * 자기 출력을 스스로 검증한다 — mapStudy 가 TrialRecordSchema 로 하는 것과 같은 규율이다.
 * OutcomeResultSchema/AdverseEventSchema 는 오래도록 타입으로만 존재하고 런타임에는
 * 한 번도 파싱되지 않아, measure 없는 outcome 과 term 없는 이상반응이 그대로 봉투로
 * 나갔다. ZodError 를 그대로 던지면 다중 라인 이슈 덤프가 되므로 실패한 필드 경로
 * 한 줄 요약으로 바꿔 upstreamError 로 다시 던진다.
 */
function checked(results: TrialResults, id: string): TrialResults {
  try {
    return TrialResultsSchema.parse(results);
  } catch (e) {
    if (e instanceof ZodError) {
      const detail = e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw upstreamError(
        `${id} 의 결과가 계약을 만족하지 못했습니다 — ${detail}`,
        'CT.gov 의 해당 시험 결과 섹션을 확인하세요.',
      );
    }
    throw e;
  }
}

export function extractResults(
  study: unknown,
  id: string,
  o: ResultsOpts,
  fetchedAt: string,
): { results: TrialResults; warnings: Warning[] } {
  // 입력을 mapStudy 와 같은 기준으로 검사한다. "이 시험은 결과를 게시하지 않았다" 는
  // 임상적 주장이고, `null` / `42` / `{}` / 잘린 응답이 조용히 그 주장으로 둔갑하면
  // 안 된다 — 그 넷은 전부 hasResults:false, 경고 0개로 나갔다. 시험 문서라는 증거
  // (nctId)가 있어야만 그 시험에 대해 무언가를 단언한다.
  if (study === null || typeof study !== 'object') {
    throw upstreamError('CT.gov 결과 응답이 예상한 형태(객체)가 아닙니다.', 'CT.gov API 상태를 확인하세요.');
  }
  if (!(study as any)?.protocolSection?.identificationModule?.nctId) {
    throw upstreamError(
      `${id} 의 결과 응답에 nctId 가 없습니다 — 시험 문서로 보이지 않습니다.`,
      '응답이 잘렸거나 미러가 빈 문서를 내주고 있을 수 있습니다. 개별 study 응답을 확인하세요.',
    );
  }

  const warnings: Warning[] = [];
  const rs = (study as any).resultsSection;
  const sections: TrialResults['sections'] = {};

  if (!rs) {
    return {
      results: checked({ id, registry: 'ctgov', hasResults: false, sections, fetchedAt }, id),
      warnings,
    };
  }

  let summarized = false;

  if (o.sections.includes('outcomes')) {
    const raw: any[] = rs.outcomeMeasuresModule?.outcomeMeasures ?? [];
    // `--full` 은 **요약할 것인가**, 필터는 **무엇을 고를 것인가** 를 정한다. 두 질문이
    // 다르므로 플래그도 직교한다 — 필터가 있으면 그것이 선택을 정하고, 없을 때만
    // `--full` 이 "전부" 를 뜻한다. 예전에는 `o.full ||` 가 앞에 있어 `--full` 이 필터를
    // 삼켰고, 좁혀 달라는 요청에 넓은 답이 경고 없이 돌아갔다(F13).
    const keep = (m: any) => (o.outcomeFilter?.length ? has(m.title, o.outcomeFilter) : o.full);
    const items: OutcomeResult[] = raw.filter(keep).map((m) => ({
      type: OUTCOME_TYPE[m.type] ?? 'other',
      measure: m.title,
      ...(m.timeFrame ? { timeFrame: m.timeFrame } : {}),
      ...(m.description ? { description: m.description } : {}),
    }));
    sections.outcomes = { total: raw.length, expanded: items.length, items };
    if (items.length < raw.length) summarized = true;
  }

  if (o.sections.includes('adverse')) {
    const raw: any[] = [
      ...(rs.adverseEventsModule?.seriousEvents ?? []).map((e: any) => ({ ...e, serious: true })),
      ...(rs.adverseEventsModule?.otherEvents ?? []).map((e: any) => ({ ...e, serious: false })),
    ];
    // 결과지표와 같은 규칙(위 주석 참고). 두 필터 중 하나라도 주어졌으면 그 둘의 OR 이
    // 선택을 정하고, 둘 다 없을 때만 `--full` 이 전부를 뜻한다.
    const filtered = o.aeOrganFilter !== undefined || o.aeTermFilter !== undefined;
    const keep = (e: any) =>
      filtered
        ? (o.aeOrganFilter ? has(e.organSystem, [o.aeOrganFilter]) : false) ||
          (o.aeTermFilter ? has(e.term, [o.aeTermFilter]) : false)
        : o.full;

    const kept = raw.filter(keep);
    const items: AdverseEvent[] = kept.map((e) => ({
      term: e.term,
      ...(e.organSystem ? { organ: e.organSystem } : {}),
      serious: e.serious,
      ...(() => {
        const stats: any[] = e.stats ?? [];
        const affected = stats.reduce((n, s) => n + (s.numAffected ?? 0), 0);
        const atRisk = stats.reduce((n, s) => n + (s.numAtRisk ?? 0), 0);
        return { ...(affected ? { affected } : {}), ...(atRisk ? { atRisk } : {}) };
      })(),
    }));

    // 롤업은 전개 여부와 무관하게 항상 낸다 — 전개 없이도 형태를 파악할 수 있어야 한다.
    // 전개 여부는 organ+term 복합키로 판정한다 — term 만으로 키를 잡으면 서로 다른
    // 기관계에 동일한 term(MedDRA 코드 특성상 실제로 발생한다)이 있을 때 필터링되지
    // 않은 기관계까지 잘못 "전개됨"으로 표시된다. JSON.stringify 로 구조적으로 묶어 값 자체가
    // 구분자를 위조할 수 없게 한다 (cache.ts 의 cacheKey 와 같은 이유).
    const organOf = (e: any) => e.organSystem ?? '(미분류)';
    const rollupKey = (organ: string, term: string) => JSON.stringify([organ, term]);
    const expandedKeys = new Set(kept.map((e) => rollupKey(organOf(e), e.term)));
    const byOrganMap = new Map<string, { events: number; expanded: boolean }>();
    for (const e of raw) {
      const organ = organOf(e);
      const cur = byOrganMap.get(organ) ?? { events: 0, expanded: false };
      byOrganMap.set(organ, {
        events: cur.events + 1,
        expanded: cur.expanded || expandedKeys.has(rollupKey(organ, e.term)),
      });
    }
    const byOrgan = [...byOrganMap.entries()].map(([organ, v]) => ({ organ, ...v }));

    sections.adverse = { total: raw.length, expanded: items.length, byOrgan, items };
    if (items.length < raw.length) summarized = true;
  }

  // flow / baseline 은 레지스트리마다 구조가 달라 정규화하지 않는다.
  // 참여자 흐름과 기저 특성은 등록소마다 표현이 크게 달라 공통 스키마로 억지로 맞추면
  // 거짓이 된다 — 개수만 세고 원문 구조를 그대로 통과시킨다.
  if (o.sections.includes('flow') && rs.participantFlowModule) {
    const items: unknown[] = rs.participantFlowModule.periods ?? [];
    sections.flow = { total: items.length, items: o.full ? items : [] };
    if (!o.full && items.length > 0) summarized = true;
  }
  if (o.sections.includes('baseline') && rs.baselineCharacteristicsModule) {
    const items: unknown[] = rs.baselineCharacteristicsModule.measures ?? [];
    sections.baseline = { total: items.length, items: o.full ? items : [] };
    if (!o.full && items.length > 0) summarized = true;
  }

  if (o.full) {
    warnings.push({
      code: 'results_full',
      message: '결과 전체를 전개했습니다. 페이로드가 매우 클 수 있습니다.',
      id,
    });
  } else if (summarized) {
    warnings.push({
      code: 'results_summarized',
      message: '요약만 냈습니다. --outcome / --ae-organ / --ae-term 으로 필요한 항목만 전개하세요.',
      id,
    });
  }

  return { results: checked({ id, registry: 'ctgov', hasResults: true, sections, fetchedAt }, id), warnings };
}
