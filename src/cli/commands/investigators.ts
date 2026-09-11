import type { InvestigatorRank, InvestigatorRankQuery, RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { missingAdapterError } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * `investigators` — 검색어에 걸린 시험 **전체**를 연구책임자로 묶어 등록 건수순으로.
 *
 * **순위 질문은 도구가 세야 한다.** 에이전트가 "당뇨 관련 우수한 연구자 5명" 을 목록 40건에서 후보를
 * 뽑아 하나씩 센 실측(2026-09-12): 273건 중 40건만 봄, 간호·영양 중재 책임자는 모델이 제외, 국문·
 * 영문 검색어 겹침 미확인, 17스텝 147초. 여기서는 어댑터가 사본 전체를 SQL 로 묶어 한 번에 낸다 —
 * 후보 누락도 판단 개입도 없고 시험은 등록번호로 한 번만 센다.
 *
 * **할 수 있는 문이 하나뿐이다.** CRIS 사본(KCTIS)만 연구책임자를 목록 축으로 갖는다. 공식 API 문은
 * 목록에 연구책임자가 없어 원리상 못 하고, 다른 레지스트리는 이 축을 신고하지 않는다 — exit 3.
 *
 * **이것은 우수성이 아니다.** 등록 건수다. 동명이인은 갈라내지 않는다(소속 목록이 신호다).
 * 그 사실이 `basis` 에 실리고, 소비자는 그것을 답에 밝혀야 한다.
 */
export type InvestigatorsResult = InvestigatorRank & { terms: string[]; basis: string };

export const INVESTIGATORS_BASIS = '등록 건수(연구책임자 기준). 우수성·순위 판정이 아니다. 동명이인은 갈라내지 않았다 — 소속이 여럿이면 섞였을 수 있다.';

export async function runInvestigators(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  const terms = (args.query.term ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const q: InvestigatorRankQuery = { terms, limit: args.query.pageSize ?? 20, ...(args.query.status ? { status: args.query.status } : {}) };
  const warnings: Warning[] = [];
  const registries: RegistryStatus[] = [];
  const cris = adapters.cris;
  if (!cris) throw missingAdapterError('cris');

  const feature = cris.capability().investigators;
  if (!feature?.supported || !cris.investigators) {
    registries.push({
      registry: 'cris', status: 'unsupported',
      error: {
        code: 'unsupported',
        message: 'CRIS (한국 임상연구정보서비스): 연구책임자 집계를 지원하지 않습니다 — 이 문(공식 API)은 목록에 연구책임자를 싣지 않습니다',
        hint: feature?.scope ?? 'CRIS 사본(CTREG_CRIS_MIRROR_URL)을 붙이면 됩니다. 공식 API 로는 후보를 하나씩 열어야 하고 그래도 전수가 아닙니다.',
      },
    });
    return { query: { investigators: terms }, registries, warnings, data: null };
  }

  try {
    const r = await cris.investigators(q, args.fetch);
    warnings.push(...r.warnings);
    registries.push({ registry: 'cris', status: 'ok', total: r.data.matched });
    const data: InvestigatorsResult = { ...r.data, terms, basis: INVESTIGATORS_BASIS };
    return { query: { investigators: terms, status: q.status, limit: q.limit }, registries, warnings, data };
  } catch (e) {
    if (!(e instanceof CtregError)) throw e;
    registries.push({ registry: 'cris', status: e.code === 'unsupported' ? 'unsupported' : 'error', error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } });
    return { query: { investigators: terms }, registries, warnings, data: null };
  }
}
