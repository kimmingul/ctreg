import type { RegistryAdapter } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import type { ParsedArgs } from '../args.js';
import type { Envelope } from '../output.js';

/**
 * 어댑터가 스스로 신고하는 capability 를 그대로 낸다 — 네트워크를 전혀 건드리지 않는다.
 * 스킬이 요청을 조립하기 전에 먼저 부르는 커맨드이므로 공짜여야 하고 즉시 응답해야 한다.
 */
export function runRegistries(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Envelope {
  const caps = args.registries.map((k) => adapters[k]!.capability());
  return {
    query: { registries: args.registries },
    registries: args.registries.map((k) => ({ registry: k, status: 'ok' as const })),
    warnings: [],
    data: caps,
  };
}
