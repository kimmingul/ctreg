import type { Capability, RegistryAdapter } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import type { ParsedArgs } from '../args.js';
import { missingAdapterError } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * 어댑터가 스스로 신고하는 capability 를 그대로 낸다 — 네트워크를 전혀 건드리지 않는다.
 * 스킬이 요청을 조립하기 전에 먼저 부르는 커맨드이므로 공짜여야 하고 즉시 응답해야 한다.
 *
 * 등록된 키인데 어댑터가 아직 없으면(두 번째 어댑터를 붙이는 중간 상태) capability 를
 * 낼 수 없다 — 물어볼 곳이 없다. 다른 네 커맨드와 같은 모양으로 그 키를 registries[]
 * 에 `unsupported` 로 남기고 data 에서는 건너뛴다. 이 커맨드 자체가 "지금 무엇을 쓸 수
 * 있는가" 를 답하는 발견용 커맨드이므로, 없는 키를 조용히 빼거나 죽이는 대신 명시적으로
 * "아직 없다" 고 말하는 쪽이 그 목적에 맞는다 — 호출자가 registries[] 만 봐도 이 빌드가
 * 무엇을 지원하는지 판단할 수 있다(exitFor 는 전부 unsupported 면 3, 하나라도 ok 면 5 로 접는다).
 */
export function runRegistries(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Envelope {
  const registries: RegistryStatus[] = [];
  const data: Capability[] = [];
  for (const k of args.registries) {
    const adapter = adapters[k];
    if (!adapter) {
      const err = missingAdapterError(k);
      registries.push({
        registry: k,
        status: 'unsupported',
        error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) },
      });
      continue;
    }
    data.push(adapter.capability());
    registries.push({ registry: k, status: 'ok' });
  }
  return { query: { registries: args.registries }, registries, warnings: [], data };
}
