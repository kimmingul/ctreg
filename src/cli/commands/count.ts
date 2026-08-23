import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError, unsupportedError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { applyLimits, assertSupported, missingAdapterError } from '../guard.js';
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
  // 하나라도 실제로 셌는지. `total === 0` 으로는 대신할 수 없다 — 진짜로 0건인 것과
  // 아무도 세지 못한 것이 같은 값이 되기 때문이고, 그 둘을 가르는 것이 이 CLI 의 일이다.
  let counted = false;

  for (const key of args.registries) {
    try {
      const adapter = adapters[key];
      if (!adapter) throw missingAdapterError(key);
      const cap = adapter.capability();
      assertSupported(cap, args.query, args.fetch);
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
      if (!cap.count) {
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
      total += r.data;
      counted = true;
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
  return { query: args.query, registries, warnings, data: counted ? { total } : null };
}
