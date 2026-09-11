import type { AggregateAxis, AggregateData, AggregateItem } from './capability.js';
import type { TrialRecord } from './record.js';

/**
 * 레코드 집계 — 집계 API 가 없는 레지스트리(ctgov·isrctn·ctis)를 위해 **검색 결과를 받아 세는** 순수
 * 함수. 사본(CRIS 미러)이 SQL 로 하는 것과 같은 축, 같은 결과 모양. 차이 둘:
 * - 상한이 있다. 레코드를 다 받아야 하므로 모수가 크면 호출자가 잘라야 하고, 그것을 말해야 한다.
 * - 정규화 마스터가 없다. 이름은 원문에서 공백·대소문자만 정리한다 — "Pfizer" 와 "Pfizer Inc." 는 갈린다.
 *   그래서 `mapped` 는 0 이고 provenance 가 그렇게 말한다.
 */
const key = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

const PI_ROLES = /principal|investigator|연구책임자/i;

function facets(r: TrialRecord, by: AggregateAxis): { name: string; extra?: Record<string, string> }[] {
  switch (by) {
    case 'sponsor': return r.sponsor?.lead ? [{ name: r.sponsor.lead }] : [];
    case 'site': return (r.locations ?? []).flatMap((l) => (l.facility ? [{ name: l.facility, ...(l.country ? { extra: { country: l.country } } : {}) }] : []));
    case 'year': { const d = r.dates?.start ?? r.dates?.firstPosted; return d && /^\d{4}/.test(d) ? [{ name: d.slice(0, 4) }] : []; }
    case 'intervention_type': return (r.interventions ?? []).flatMap((i) => (i.type ? [{ name: i.type }] : []));
    case 'drug': return (r.interventions ?? []).map((i) => ({ name: i.name, ...(i.type ? { extra: { type: i.type } } : {}) }));
    case 'condition': return (r.conditions ?? []).map((c) => ({ name: c }));
    case 'investigator': return (r.contacts ?? []).flatMap((c) => (c.name && PI_ROLES.test(c.role ?? '') ? [{ name: c.name }] : []));
  }
}

const PROVENANCE: Record<AggregateAxis, string> = {
  sponsor: '레코드의 주 의뢰기관(sponsor.lead) 원문 — 정규화 마스터 없음, 표기가 다르면 갈린다.',
  site: '레코드의 시험 장소(locations[].facility) 원문 — 장소는 레코드당 상한이 있어 큰 다기관 시험은 일부만 센다.',
  year: '시작일(dates.start, 없으면 최초 게시일) 앞 네 자리.',
  intervention_type: '중재 유형(interventions[].type) 원문.',
  drug: '중재 이름(interventions[].name) 원문 — 성분·상품명이 섞이고 표기가 다르면 갈린다.',
  condition: '질환(conditions[]) 원문 — 같은 질환의 표기가 여럿이면 갈린다.',
  investigator: '연락처 중 연구책임자 역할(contacts[].role) 원문 — 검색 결과에 연락처가 실려야 센다.',
};

export function aggregateRecords(records: TrialRecord[], by: AggregateAxis, limit = 20): AggregateData {
  const seen = new Set<string>();
  const buckets = new Map<string, { name: string; trials: number; extra?: Record<string, string> }>();
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const perTrial = new Set<string>();
    for (const f of facets(r, by)) {
      const k = key(f.name);
      if (k === '' || perTrial.has(k)) continue;   // 한 시험 안에서 같은 항목은 한 번
      perTrial.add(k);
      const b = buckets.get(k) ?? { name: f.name.trim().replace(/\s+/g, ' '), trials: 0, ...(f.extra ? { extra: f.extra } : {}) };
      b.trials += 1;
      buckets.set(k, b);
    }
  }
  const items: AggregateItem[] = [...buckets.entries()]
    .sort((a, b) => b[1].trials - a[1].trials || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([k, b]) => ({ key: k, name: b.name, trials: b.trials, mapped: false, ...(b.extra ? { extra: b.extra } : {}) }));
  return { by, matched: seen.size, items, mapped: 0, provenance: `${PROVENANCE[by]} 레코드 ${seen.size}건에서 셈.` };
}
