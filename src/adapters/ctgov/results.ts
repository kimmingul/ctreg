import type { Warning } from '../../core/capability.js';
import type { ResultsOpts } from '../../core/query.js';
import type { AdverseEvent, OutcomeResult, TrialResults } from '../../core/record.js';

const OUTCOME_TYPE: Record<string, OutcomeResult['type']> = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
};

const has = (hay: string | undefined, needles: string[]) =>
  hay !== undefined && needles.some((n) => hay.toLowerCase().includes(n.toLowerCase()));

export function extractResults(
  study: unknown,
  id: string,
  o: ResultsOpts,
  fetchedAt: string,
): { results: TrialResults; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const rs = (study as any)?.resultsSection;
  const sections: TrialResults['sections'] = {};

  if (!rs) {
    return {
      results: { id, registry: 'ctgov', hasResults: false, sections, fetchedAt },
      warnings,
    };
  }

  let summarized = false;

  if (o.sections.includes('outcomes')) {
    const raw: any[] = rs.outcomeMeasuresModule?.outcomeMeasures ?? [];
    const keep = (m: any) => o.full || (o.outcomeFilter?.length ? has(m.title, o.outcomeFilter) : false);
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
    const keep = (e: any) =>
      o.full ||
      (o.aeOrganFilter ? has(e.organSystem, [o.aeOrganFilter]) : false) ||
      (o.aeTermFilter ? has(e.term, [o.aeTermFilter]) : false);

    const items: AdverseEvent[] = raw.filter(keep).map((e) => ({
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
    const expandedTerms = new Set(items.map((i) => i.term));
    const byOrganMap = new Map<string, { events: number; expanded: boolean }>();
    for (const e of raw) {
      const organ = e.organSystem ?? '(미분류)';
      const cur = byOrganMap.get(organ) ?? { events: 0, expanded: false };
      byOrganMap.set(organ, {
        events: cur.events + 1,
        expanded: cur.expanded || expandedTerms.has(e.term),
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

  return { results: { id, registry: 'ctgov', hasResults: true, sections, fetchedAt }, warnings };
}
