import { AGGREGATE_AXES, type AggregateData, type AggregateQuery, type RegistryAdapter, type Warning } from '../../core/capability.js';
import { aggregateRecords } from '../../core/aggregate.js';
import type { NormalizedQuery } from '../../core/query.js';
import type { TrialRecord } from '../../core/record.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { missingAdapterError } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * `aggregate` — 검색어에 걸린 시험 **전체**를 한 축으로 묶어 등록 건수순으로.
 *
 * **순위·현황 질문은 도구가 세야 한다.** 에이전트가 "당뇨 관련 우수한 연구자 5명" 을 목록 40건에서
 * 후보를 뽑아 하나씩 센 실측(2026-09-12): 273건 중 40건만 봄, 간호·영양 중재 책임자는 모델이 제외,
 * 국문·영문 검색어 겹침 미확인, 17스텝 147초. 여기서는 어댑터가 사본 전체를 SQL 로 묶어 한 번에 낸다.
 * 처음엔 연구자 하나(`investigators`)였고, 사용자가 "연구자별·의뢰사별·실시기관별·질환별·의약품별" 을
 * 말해 축을 인자로 일반화했다 — 축은 `AGGREGATE_AXES` 하나가 정본이다.
 *
 * **할 수 있는 문이 하나뿐이다.** CRIS 사본(KCTIS)만 이 축들을 목록에서 갖는다. 공식 API 문은 목록에
 * 연구책임자도 의뢰기관 항목도 없어 원리상 못 하고, 다른 레지스트리는 이 축을 신고하지 않는다 — exit 3.
 *
 * **이것은 우수성이 아니다.** 등록 건수다. 축마다 근거와 한계(`provenance`)가 다르다 — 의뢰사·기관은
 * 정규화 마스터에 맞은 비율(`mapped`)이 있고, 의약품·질환은 사전 문자열 매칭이다. 소비자는 그것을
 * 답에 밝혀야 한다.
 */
export const AXES = AGGREGATE_AXES;
export type AggregateResult = AggregateData & { terms: string[]; basis: string };

export const AGGREGATE_BASIS = '등록 건수 기준. 우수성·순위 판정이 아니다. 한 시험이 여러 항목(의뢰사·기관·약물)에 속할 수 있어 축 안의 합이 모수보다 클 수 있다. 동명이인·동일기관 표기 차이는 완전히 갈라내지 못한다.';

/**
 * 집계 API 가 없는 레지스트리에서 걸어 받는 레코드 상한. ctgov 는 쪽당 200건이라 다섯 번이다. 잰 수가
 * 아니라 정한 정책이다 — 요청률 1/s 인 레지스트리에서 5초쯤. 넘으면 그만큼만 세고 **잘렸다고 말한다.**
 */
export const AGGREGATE_WALK_CAP = 1000;

export async function runAggregate(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  const terms = (args.query.term ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const by = args.aggregateBy!;
  const limit = args.query.pageSize ?? 20;
  const q: AggregateQuery = { by, terms, limit, ...(args.query.status ? { status: args.query.status } : {}), ...(args.query.location ? { site: args.query.location } : {}), ...(args.query.sponsor ? { sponsor: args.query.sponsor } : {}) };
  const warnings: Warning[] = [];
  const registries: RegistryStatus[] = [];
  const key = args.registries[0]!;
  const adapter = adapters[key];
  if (!adapter) throw missingAdapterError(key);
  const cap = adapter.capability();

  // 1) 집계를 자기가 하는 문(CRIS 사본) — 신고가 계약이다. 신고 없이 메서드만 있어도 부르지 않는다.
  const feature = cap.aggregate;
  if (feature?.supported && adapter.aggregate) {
    // 사본은 term·status 만 적용한다. 다른 축(location·condition·phase …)을 조용히 버리면 "미국 의뢰사 순위" 가
    // 세계 순위로 둔갑한다 — 받지 못하는 축이 오면 그렇게 말한다.
    const extra = Object.entries(args.query)
      .filter(([k, v]) => v !== undefined && !['term', 'status', 'pageSize', 'pageToken', 'location', 'sponsor'].includes(k))
      .map(([k]) => k);
    if (extra.length > 0) {
      registries.push({ registry: key, status: 'unsupported', error: { code: 'unsupported', message: `${cap.name}: 집계에 ${extra.join(', ')} 축을 적용할 수 없습니다 — 사본은 term(쉼표 OR)·status·location(실시기관·소속)·sponsor 만 받습니다`, hint: '그 조건을 검색어에 담거나(예: 기관명을 term 에), 다른 레지스트리(registry ctgov)로 물으세요.' } });
      return { query: { aggregate: by, terms }, registries, warnings, data: null };
    }
    if (!feature.axes.includes(by)) {
      registries.push({ registry: key, status: 'unsupported', error: { code: 'unsupported', message: `${cap.name}: 축 '${by}' 를 받지 않습니다`, hint: `받는 축: ${feature.axes.join(', ')}` } });
      return { query: { aggregate: by, terms }, registries, warnings, data: null };
    }
    try {
      const r = await adapter.aggregate(q, args.fetch);
      warnings.push(...r.warnings);
      registries.push({ registry: key, status: 'ok', total: r.data.matched });
      const data: AggregateResult = { ...r.data, terms, basis: AGGREGATE_BASIS };
      return { query: { aggregate: by, terms, status: q.status, limit, registry: key }, registries, warnings, data };
    } catch (e) {
      if (!(e instanceof CtregError)) throw e;
      registries.push({ registry: key, status: e.code === 'unsupported' ? 'unsupported' : 'error', error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } });
      return { query: { aggregate: by, terms }, registries, warnings, data: null };
    }
  }

  // 2) 집계가 없는 문 — 검색을 상한까지 걸어 서버가 센다. 검색어 축(term)이 없으면 그것도 못 한다.
  if (feature && !feature.supported) {
    registries.push({ registry: key, status: 'unsupported', error: { code: 'unsupported', message: `${cap.name}: 축별 집계(${by})를 지원하지 않습니다 — 이 문은 목록에 그 축을 싣지 않습니다`, hint: feature.scope } });
    return { query: { aggregate: by, terms }, registries, warnings, data: null };
  }
  if (!cap.search.term.supported) {
    registries.push({ registry: key, status: 'unsupported', error: { code: 'unsupported', message: `${cap.name}: 검색어 축이 없어 집계의 모수를 만들 수 없습니다`, hint: cap.search.term.scope } });
    return { query: { aggregate: by, terms }, registries, warnings, data: null };
  }
  try {
    const pageSize = Math.min(cap.limits.maxPageSize, AGGREGATE_WALK_CAP);
    const base: NormalizedQuery = { ...args.query, term: terms.join(','), pageSize };
    // 연구책임자 축은 연락처가 실려야 센다 — include 를 넓힌다.
    const fetch = by === 'investigator' ? { ...args.fetch, include: [...new Set([...args.fetch.include, 'contacts' as const])] } : args.fetch;
    const records: TrialRecord[] = [];
    let token: string | undefined;
    let total: number | undefined;
    for (;;) {
      const r = await adapter.search({ ...base, ...(token ? { pageToken: token } : {}) }, fetch);
      for (const w of r.warnings) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
      records.push(...r.data);
      // total 은 첫 쪽에만 올 수 있다(ctgov 의 countTotal). 뒤 쪽의 undefined 로 덮으면 모수가 레코드 수로 둔갑한다 — 실측 3,361 → 1,199.
      total ??= r.total;
      token = r.nextPageToken;
      if (!token || records.length >= AGGREGATE_WALK_CAP) break;
    }
    const matched = total ?? records.length;
    if (records.length < matched) {
      warnings.push({
        code: 'aggregate_truncated',
        message: `모수 ${matched.toLocaleString()}건 중 ${records.length.toLocaleString()}건까지만 받아 셌습니다 — 이 레지스트리에는 집계 API 가 없어 레코드를 받아 세는데, 상한이 ${AGGREGATE_WALK_CAP.toLocaleString()}건입니다. 순위·비율은 그 안의 것입니다. 검색어를 좁혀 모수를 줄이세요.`,
        registry: key,
      });
    }
    const agg = aggregateRecords(records, by, limit);
    registries.push({ registry: key, status: 'ok', total: matched });
    const data: AggregateResult = { ...agg, matched, terms, basis: AGGREGATE_BASIS };
    return { query: { aggregate: by, terms, status: q.status, limit, registry: key }, registries, warnings, data };
  } catch (e) {
    if (!(e instanceof CtregError)) throw e;
    registries.push({ registry: key, status: e.code === 'unsupported' ? 'unsupported' : 'error', error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } });
    return { query: { aggregate: by, terms }, registries, warnings, data: null };
  }
}
