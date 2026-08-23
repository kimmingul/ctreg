import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { TrialRecord } from '../../core/record.js';
import { parseTrialId, type RegistryKey } from '../../core/registry.js';
import { CtregError, usageError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { assertSupported, missingAdapterError } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * 던지면서도 봉투에 실을 경고를 잃지 않기 위한 운반체.
 *
 * ID 라우팅은 어댑터를 부르기 전에 끝나므로 실패하면 던질 수밖에 없는데, 그냥 던지면
 * index.ts 의 최상위 catch 가 봉투를 새로 만들면서 그때까지 모은 경고를 버린다. 그러면
 * 나쁜 ID 두 개 중 하나만 이름이 불리고, 호출자는 고쳐서 다시 돌린 뒤에야 나머지를 안다.
 */
export class IdRoutingError extends CtregError {
  constructor(cause: CtregError, readonly warnings: Warning[]) {
    super(cause.message, cause.code, cause.exit, cause.hint, { cause });
    this.name = 'IdRoutingError';
  }
  static override is(e: unknown): e is IdRoutingError {
    return e instanceof IdRoutingError;
  }
}

/**
 * ID 를 레지스트리별로 나눠 각 어댑터에 자기 것만 보낸다. 다른 레지스트리의 ID
 * 하나가 요청 전체를 가라앉히면 안 된다 — 알아보지 못하는 ID 는 그 레지스트리의
 * RegistryStatus 에만 기록되고, 나머지 어댑터는 그대로 돌아간다.
 */
export async function runGet(
  args: ParsedArgs,
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  if (args.positionals.length === 0) {
    throw usageError('get 은 ID 를 하나 이상 요구합니다', 'ctreg get CTGOV:NCT01234567 [ID...]');
  }

  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  const data: TrialRecord[] = [];

  // ID 를 레지스트리별로 나눈다 — 각 어댑터는 자기 것만 받는다.
  //
  // parseTrialId 는 서로 다른 두 사실에 대해 던지고, 둘을 같이 다루면 안 된다:
  //  - unsupported: 접두사는 알아봤지만 어댑터가 없다(EUCTR:…). 호출자가 고칠 것이
  //    없고 나머지 ID 는 멀쩡하므로 경고로 격하하고 계속한다.
  //  - usage: ID 형식 자체를 못 알아본다(NCT0000010). 호출자의 오타이고 스펙 §5.3 이
  //    exit 2 로 못박은 경우다. 같은 오타가 다른 인자의 유무에 따라 2 도 되고 0 도
  //    되면 종료 코드로 분기하는 스킬에게 계약이 아니게 된다.
  // 어느 쪽이든 ID 전부를 훑은 뒤에 판단한다 — 첫 번째에서 바로 던지면 두 번째
  // 나쁜 ID 는 아무 데도 안 남는다.
  const byRegistry = new Map<RegistryKey, string[]>();
  let typo: CtregError | undefined;
  let unroutable: CtregError | undefined;
  for (const raw of args.positionals) {
    try {
      const { registry, id } = parseTrialId(raw);
      byRegistry.set(registry, [...(byRegistry.get(registry) ?? []), id]);
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      warnings.push({ code: 'id_unroutable', message: e.message, id: raw });
      if (e.code === 'usage') typo ??= e;
      else unroutable ??= e;
    }
  }
  // 오타는 무조건 exit 2 다. 어떤 레지스트리도 부르지 않고 여기서 끝난다 — 요청이
  // 성립하지 않았으므로 registries[] 는 비어 있는 것이 맞다.
  if (typo) throw new IdRoutingError(typo, warnings);
  // 오타는 없는데 하나도 라우팅하지 못했다면 물어볼 곳이 없다. 빈 성공(exit 0)은
  // "그런 시험이 없다" 로 읽히므로 미지원 3 을 그대로 낸다.
  if (byRegistry.size === 0) throw new IdRoutingError(unroutable as CtregError, warnings);

  for (const [key, ids] of byRegistry) {
    try {
      const adapter = adapters[key];
      if (!adapter) throw missingAdapterError(key);
      // get 은 검색 축을 쓰지 않으므로 질의는 빈 것으로 검사한다. 그래도 --include 는
      // 봐야 한다: 레지스트리가 담지 않는 섹션을 조용히 빠뜨린 레코드를 주면
      // "이 시험엔 그 정보가 없다" 로 오독된다 (guard.ts 가 막으려는 바로 그 혼동).
      // 빈 질의라 축 경고가 나올 일은 없지만, 세 호출 지점의 모양을 맞춘다.
      warnings.push(...assertSupported(adapter.capability(), {}, args.fetch).warnings);
      const r = await adapter.get(ids, args.fetch);
      warnings.push(...r.warnings);
      data.push(...r.data);
      registries.push({ registry: key, status: 'ok', returned: r.data.length });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) },
      });
    }
  }
  return { query: { ids: args.positionals }, registries, warnings, data };
}
