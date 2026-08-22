import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
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
      assertSupported(adapter.capability(), args.query, args.fetch);
      const r = await adapter.count(args.query, args.fetch);
      warnings.push(...r.warnings);
      total += r.data;
      registries.push({ registry: key, status: 'ok', total: r.data });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message },
      });
    }
  }
  return { query: args.query, registries, warnings, data: { total } };
}
