import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError, unsupportedError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { assertSupported } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * 레지스트리별로 독립 시도한다. 하나가 실패해도 나머지 결과는 살아 있어야 하고,
 * 실패는 해당 레지스트리의 RegistryStatus 에 기록한다 — 프로세스 종료 코드는
 * output.ts 의 exitFor 가 registries[] 전체를 보고 정한다.
 * CtregError 가 아닌 예외는 여기서 삼키지 않고 그대로 던진다.
 */
export async function runCount(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  let total = 0;

  for (const key of args.registries) {
    const adapter = adapters[key]!;
    try {
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
      const r = await adapter.count(args.query, args.fetch);
      warnings.push(...r.warnings);
      total += r.data;
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
  return { query: args.query, registries, warnings, data: { total } };
}
