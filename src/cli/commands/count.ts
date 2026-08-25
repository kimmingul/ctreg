import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError, unsupportedError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { applyLimits, assertSupported, missingAdapterError, zeroResultScope } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * 레지스트리별로 독립 시도한다. 하나가 실패해도 나머지 결과는 살아 있어야 하고,
 * 실패는 해당 레지스트리의 RegistryStatus 에 기록한다 — 프로세스 종료 코드는
 * output.ts 의 exitFor 가 registries[] 전체를 보고 정한다.
 * CtregError 가 아닌 예외는 여기서 삼키지 않고 그대로 던진다.
 */
export async function runCount(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  let total = 0;
  // 실제로 센 레지스트리들. 개수가 아니라 목록인 이유는 둘을 답해야 하기 때문이다 —
  // **하나라도** 셌는가(0 과 "못 셌다" 를 가른다), 그리고 **둘 이상** 셌는가(합이
  // 개수인가를 가른다). `total === 0` 으로는 앞의 것을 대신할 수 없다: 진짜로 0건인
  // 것과 아무도 세지 못한 것이 같은 값이 되고, 그 둘을 가르는 것이 이 CLI 의 일이다.
  const countedKeys: RegistryKey[] = [];

  for (const key of args.registries) {
    try {
      const adapter = adapters[key];
      if (!adapter) throw missingAdapterError(key);
      const cap = adapter.capability();
      warnings.push(...assertSupported(cap, args.query, args.fetch).warnings);
      // capability.count 는 여기서 강제한다 — results.ts 가 cap.results 를 강제하는
      // 것과 같은 자리다. assertSupported 에 넣지 않는 이유: 그쪽은 *요청* 의 속성
      // (어떤 검색 축을 썼나, 어떤 섹션을 달라 했나)을 검사하고 다섯 커맨드가 모두
      // 부른다. cap.count/cap.results 는 요청이 아니라 *커맨드 자체* 가 가능한지에
      // 대한 사실이고, 각각 한 커맨드에만 해당한다. 커맨드 이름을 인자로 받게 만들면
      // 모든 호출자가 자기와 무관한 인자를 채워야 한다.
      //
      // 던지는 쪽을 택한 것은 아래 catch 가 이미 unsupported 를 그 레지스트리의
      // RegistryStatus 로 옮겨 주기 때문이다 — registries[] 가 비어 있다는 것은
      // "어떤 레지스트리도 정해지지 않았다" 는 뜻이라는 봉투 규칙이 그대로 지켜진다.
      if (!cap.count.supported) {
        throw unsupportedError(
          `${cap.name} 은 결과 건수를 셀 수 없습니다 (해당하는 시험이 없는 것이 아니라 레지스트리가 개수를 제공하지 않습니다)`,
          'ctreg search 로 결과를 직접 받아 보세요. ctreg registries 로 지원 여부를 확인할 수 있습니다.',
        );
      }
      // count 자체는 pageSize 를 안 쓰지만(ctgov 는 pageSize:0 으로 개수만 받는다),
      // args.query 는 search 와 이 루프를 공유하므로 여기서도 같은 규칙을 적용해 둔다 —
      // 그래야 어떤 레지스트리를 먼저 도느냐에 따라 클램프 여부가 갈리지 않는다.
      const limited = applyLimits(cap, args.query);
      warnings.push(...limited.warnings);
      const r = await adapter.count(limited.query, args.fetch);
      warnings.push(...r.warnings);
      // search 와 같은 자리·같은 조건이다(그쪽 주석 참고). 여기서는 개수가 곧 결과라
      // total 을 따로 볼 것이 없다.
      if (r.data === 0) warnings.push(...zeroResultScope(cap, limited.query));
      total += r.data;
      countedKeys.push(key);
      registries.push({ registry: key, status: 'ok', total: r.data });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) },
      });
    }
  }
  // 아무도 세지 못했으면 0 이 아니라 null 이다. `registries[]` 를 보지 않는 호출자에게
  // `{ total: 0 }` 은 "해당하는 시험이 없다" 로 읽힌다 — 미지원과 실패가 성공한 0 으로
  // 위장되는 자리다. `results.ts` 도 같은 상황에서 `data: null` 을 낸다.
  //
  // 반대로 **하나라도** 셌으면 부분 합을 남긴다. 여기서 지우면 성공한 레지스트리의 답까지
  // 사라진다 — 부분이라는 사실은 registries[] 와 exitFor 의 exit 5 가 이미 말한다.
  if (countedKeys.length === 0) return { query: args.query, registries, warnings, data: null };

  /**
   * 둘 이상을 셌으면 그 합은 **무엇의 개수도 아니다**(최종 리뷰 I6). 교차 등록은 흔하고
   * — `crossIds` 가 존재하는 이유가 그것이다 — 겹치는 두 수를 더한 값은 합집합이 아니다.
   * 실측(2026-08-25): ctgov 24273 + isrctn 1118 = 25391 이 경고 없이 나갔다.
   *
   * 여기서 중복을 뺄 수는 없다. `count` 는 레코드를 받지 않으므로 `crossIds` 를 볼 수
   * 없고, 받으면 이 커맨드가 존재하는 이유(빠르다)가 사라진다. 그래서 빼는 대신 **숫자
   * 자리에서 내린다** — 바로 위 `data: null` 과 같은 논거다: 틀린 숫자를 숫자 자리에
   * 두지 않는다. 값을 지우면서 이유를 말하지 않으면 호출자는 도구가 고장 났다고 읽으므로
   * 경고가 함께 나간다.
   *
   * `data: null`(아무도 못 셌다)이 아니라 `{ total: null }`(더할 수 없다)인 것이 요점이다.
   * 둘을 같은 값으로 뭉개면 "셀 수 없었다" 와 "더할 수 없다" 가 구별되지 않는다.
   *
   * 레지스트리별 수는 `registries[]` 에 그대로 남는다. 합이 필요한 호출자는 거기서 더하면
   * 되고, 그때는 **자기가 무엇을 더하는지 알고** 더한다. 그 합이 합집합의 상한이라는 것도
   * 참이라, 경고가 수와 함께 그렇게 말한다.
   */
  if (countedKeys.length > 1) {
    warnings.push({
      code: 'totals_not_summable',
      message:
        `${countedKeys.join(', ')} 를 함께 셌습니다. 한 시험이 여러 레지스트리에 등록될 수 있어 ` +
        `레지스트리별 총계를 더한 값은 시험 수가 아니므로 합계를 내지 않습니다 — 그 합 ${total} 은 ` +
        '합집합의 상한입니다. 레지스트리별 수는 registries[] 에 있습니다.',
    });
    return { query: args.query, registries, warnings, data: { total: null } };
  }
  return { query: args.query, registries, warnings, data: { total } };
}
