import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { NormalizedQuery } from '../../core/query.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { missingAdapterError } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * `names` — 한국어 이름을 **실제로 등록된** 로마자 표기로.
 *
 * 왜 이 커맨드가 있나. 로마자 표기가 결과를 가른다 — 실측(ctgov `--investigator`):
 * `Min-Gul Kim` 45건 · `Mingul Kim` 17건. 겹치지 않는 두 집합이다. 모델이 "김민걸" 을
 * 영어로 옮기면 둘 중 하나를 고르고, 어느 쪽이든 절반을 놓친 채 자신 있게 답한다.
 *
 * CRIS 는 국문·영문을 나란히 싣는 이중언어 레지스트리라 대조표가 된다. 그리고 **이것은
 * 새 API 가 아니다** — `search --investigator` 가 이미 내는 연락처에서 영문 이름을 뽑아
 * 세는 것이다. 코어를 새로 쓰지 않고, CRIS 어댑터의 대조(후보를 하나씩 열어 연구책임자를
 * 맞추는 것)를 그대로 쓴다. 그래서 `--term` 이 필수다 — 후보를 좁힐 축이 그것뿐이다.
 *
 * **표기를 합치지 않는다.** `Min Gul KIm`(오타)이 실측에서 실제로 나왔다. 대소문자나
 * 공백을 정규화해 합치면 사용자는 그 오타가 등록돼 있다는 것을 모르고, ctgov 에 그 오타로
 * 물어야 걸리는 시험을 놓친다. 이 도구의 존재 이유가 "표기가 다르면 다른 사람" 이므로
 * 원문을 그대로 보존하고 빈도만 센다.
 */
export type NameVariant = {
  /** CRIS 에 등록된 영문 표기 원문 그대로. */
  name: string;
  /** 이 표기가 연구책임자로 실린 CRIS 시험 수. */
  crisTrials: number;
  /** `--ctgov` 를 줬을 때만. 이 표기로 ctgov `--investigator` 를 물으면 몇 건인가. */
  ctgovTrials?: number;
};

export type NamesResult = {
  korean: string;
  /** 후보를 좁힌 말. 결과가 이 범위에 갇힌다는 것을 소비자가 알아야 한다. */
  term: string;
  /** 대조에 쓴 CRIS 시험 수(이 이름이 연구책임자로 걸린 것). */
  crisMatched: number;
  /** 많이 쓴 표기가 먼저. */
  variants: NameVariant[];
};

const hasLatin = (s: string): boolean => /[A-Za-z]/.test(s);

export async function runNames(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  const korean = args.positionals[0]!.trim();
  const term = args.query.term!;
  const warnings: Warning[] = [];
  const registries: RegistryStatus[] = [];

  const cris = adapters.cris;
  if (!cris) throw missingAdapterError('cris');

  // 1) CRIS 에서 이 이름이 연구책임자인 시험을 모은다 — 어댑터의 대조를 그대로 쓴다.
  const query: NormalizedQuery = { ...args.query, investigator: korean, term };
  let matched;
  try {
    matched = await cris.search(query, args.fetch);
  } catch (e) {
    if (!(e instanceof CtregError)) throw e;
    registries.push({ registry: 'cris', status: e.code === 'unsupported' ? 'unsupported' : 'error', error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } });
    return { query: { names: korean, term }, registries, warnings, data: null };
  }
  warnings.push(...matched.warnings);
  registries.push({ registry: 'cris', status: 'ok', total: matched.total });

  // 2) 연락처에서 영문 표기를 뽑아 센다. 한국어 원문과 같은 것은 표기가 아니다.
  const counts = new Map<string, number>();
  for (const rec of matched.data) {
    // 한 시험 안에서 같은 표기가 두 역할로 실려도 한 번만 센다 — 세는 것은 시험 수다.
    const seen = new Set<string>();
    for (const c of rec.contacts ?? []) {
      const name = (c.name ?? '').trim();
      if (name === '' || name === korean || !hasLatin(name) || seen.has(name)) continue;
      seen.add(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const variants: NameVariant[] = [...counts]
    .map(([name, crisTrials]) => ({ name, crisTrials }))
    .sort((a, b) => b.crisTrials - a.crisTrials || a.name.localeCompare(b.name));

  if (variants.length === 0) {
    /**
     * **0건은 오류가 아니다 — 그러나 "그런 사람이 없다" 도 아니다.** 국내에 등록한 적이
     * 없거나, `--term` 이 그 사람의 시험에 닿지 않은 것이다. 둘 중 무엇인지 이 도구는
     * 모르고, 그 사실을 봉투가 말해야 한다. 조용한 빈 목록은 "없다" 로 읽힌다.
     */
    warnings.push({
      code: 'names_none_found',
      message:
        `CRIS 에서 '${korean}' 이(가) 연구책임자인 시험을 '${term}' 범위 안에서 찾지 못했습니다. ` +
        '국내에 등록한 적이 없을 수도 있고, --term 이 그 사람의 시험에 닿지 않은 것일 수도 있습니다 — ' +
        '기관명·연구 주제 등 다른 말로 다시 물어 보세요.',
    });
  }

  // 3) --ctgov: 표기마다 ctgov 건수. 요청이 표기 수만큼 늘어 기본은 끈다.
  if (args.namesCtgov) {
    const ctgov = adapters.ctgov;
    if (!ctgov) throw missingAdapterError('ctgov');
    let ctgovTotal = 0;
    for (const v of variants) {
      try {
        const r = await ctgov.count({ investigator: v.name }, args.fetch);
        warnings.push(...r.warnings);
        v.ctgovTrials = r.data;
        ctgovTotal += r.data;
      } catch (e) {
        if (!(e instanceof CtregError)) throw e;
        registries.push({ registry: 'ctgov', status: 'error', error: { code: e.code, message: e.message } });
        break;
      }
    }
    if (!registries.some((r) => r.registry === 'ctgov')) registries.push({ registry: 'ctgov', status: 'ok', total: ctgovTotal });
    if (variants.length > 1) {
      /**
       * 표기별 건수를 더하면 안 된다는 것을 말해 둔다 — 같은 시험이 두 표기로 등록됐을 수
       * 있고(실측: 45 와 17 은 겹치지 않았지만 늘 그렇다는 보장은 없다), 스킬의
       * "범주별 건수를 더하지 마라" 와 같은 성질이다.
       */
      warnings.push({
        code: 'names_ctgov_not_additive',
        message: '표기별 ctgov 건수는 서로 겹칠 수 있습니다. 더하지 말고, 전수를 보려면 각 표기로 따로 검색해 등록번호로 합치세요.',
      });
    }
  }

  const data: NamesResult = { korean, term, crisMatched: matched.data.length, variants };
  return { query: { names: korean, term, ctgov: args.namesCtgov }, registries, warnings, data };
}
