import type { RegistryAdapter } from '../../core/capability.js';
import { parseTrialId, type RegistryKey } from '../../core/registry.js';
import { CtregError, unsupportedError, usageError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * ID 하나만 받는다 — 결과는 시험 하나 단위로 크고, 섹션 필터도 시험 하나를 가정한다.
 *
 * 레지스트리가 결과를 아예 담지 않으면 빈 결과가 아니라 exit 3 이다.
 * "이 레지스트리는 결과 데이터를 싣지 않는다" 와 "이 시험은 이상반응이 없었다" 는
 * 다른 사실이고, 앞의 것을 뒤의 것으로 읽은 호출자는 틀린 결론을 내린다.
 */
export async function runResults(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  if (args.positionals.length !== 1) {
    throw usageError(
      `results 는 ID 를 정확히 하나 요구합니다 (${args.positionals.length}개 받음)`,
      'ctreg results CTGOV:NCT01234567',
    );
  }
  const { registry, id } = parseTrialId(args.positionals[0]!);
  const adapter = adapters[registry]!;
  const cap = adapter.capability();
  if (!cap.results) {
    throw unsupportedError(
      `${cap.name} 은 결과 데이터를 제공하지 않습니다`,
      'ctreg registries 로 결과를 제공하는 레지스트리를 확인하세요. 결과가 없는 것이 아니라 레지스트리가 결과를 담지 않습니다.',
    );
  }

  const registries: RegistryStatus[] = [];
  try {
    const r = await adapter.results(id, args.results);
    registries.push({ registry, status: 'ok', returned: 1 });
    return { query: { id, sections: args.results.sections }, registries, warnings: r.warnings, data: r.data };
  } catch (e) {
    if (!CtregError.is(e)) throw e;
    registries.push({
      registry,
      status: e.code === 'unsupported' ? 'unsupported' : 'error',
      error: { code: e.code, message: e.message },
    });
    return { query: { id }, registries, warnings: [], data: null };
  }
}
