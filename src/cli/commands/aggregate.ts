import { AGGREGATE_AXES, type AggregateData, type AggregateQuery, type RegistryAdapter, type Warning } from '../../core/capability.js';
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

export async function runAggregate(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  const terms = (args.query.term ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const by = args.aggregateBy!;
  const q: AggregateQuery = { by, terms, limit: args.query.pageSize ?? 20, ...(args.query.status ? { status: args.query.status } : {}) };
  const warnings: Warning[] = [];
  const registries: RegistryStatus[] = [];
  const cris = adapters.cris;
  if (!cris) throw missingAdapterError('cris');

  const feature = cris.capability().aggregate;
  if (!feature?.supported || !cris.aggregate) {
    registries.push({
      registry: 'cris', status: 'unsupported',
      error: {
        code: 'unsupported',
        message: `CRIS (한국 임상연구정보서비스): 축별 집계(${by})를 지원하지 않습니다 — 이 문(공식 API)은 목록에 그 축을 싣지 않습니다`,
        hint: feature?.scope ?? 'CRIS 사본(CTREG_CRIS_MIRROR_URL)을 붙이면 됩니다. 공식 API 로는 목록을 읽어 세야 하고 그것은 전수가 아닙니다.',
      },
    });
    return { query: { aggregate: by, terms }, registries, warnings, data: null };
  }
  if (!feature.axes.includes(by)) {
    registries.push({ registry: 'cris', status: 'unsupported', error: { code: 'unsupported', message: `이 문은 축 '${by}' 를 받지 않습니다`, hint: `받는 축: ${feature.axes.join(', ')}` } });
    return { query: { aggregate: by, terms }, registries, warnings, data: null };
  }

  try {
    const r = await cris.aggregate(q, args.fetch);
    warnings.push(...r.warnings);
    registries.push({ registry: 'cris', status: 'ok', total: r.data.matched });
    const data: AggregateResult = { ...r.data, terms, basis: AGGREGATE_BASIS };
    return { query: { aggregate: by, terms, status: q.status, limit: q.limit }, registries, warnings, data };
  } catch (e) {
    if (!(e instanceof CtregError)) throw e;
    registries.push({ registry: 'cris', status: e.code === 'unsupported' ? 'unsupported' : 'error', error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } });
    return { query: { aggregate: by, terms }, registries, warnings, data: null };
  }
}
