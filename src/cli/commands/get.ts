import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { TrialRecord } from '../../core/record.js';
import { parseTrialId, type RegistryKey } from '../../core/registry.js';
import { CtregError, usageError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { assertSupported } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * ID 를 레지스트리별로 나눠 각 어댑터에 자기 것만 보낸다. 다른 레지스트리의 ID
 * 하나가 요청 전체를 가라앉히면 안 된다 — 알아보지 못하는 ID 는 그 레지스트리의
 * RegistryStatus 에만 기록되고, 나머지 어댑터는 그대로 돌아간다.
 */
export async function runGet(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  if (args.positionals.length === 0) {
    throw usageError('get 은 ID 를 하나 이상 요구합니다', 'ctreg get CTGOV:NCT01234567 [ID...]');
  }

  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  const data: TrialRecord[] = [];

  // ID 를 레지스트리별로 나눈다 — 각 어댑터는 자기 것만 받는다.
  // 어댑터가 없는 레지스트리의 ID 하나가 요청 전체를 가라앉히면 안 된다. 그런 ID 는
  // 경고로 남기고 나머지는 그대로 조회한다 — 어댑터가 개별 ID 의 not_found 를 경고로
  // 다루는 것과 같은 규칙이다. registry 필드는 RegistryKey 라서 어댑터가 없는
  // 레지스트리는 registries[] 에 담을 수 없고, 그래서 경고가 유일한 자리다.
  const byRegistry = new Map<RegistryKey, string[]>();
  let firstIdError: CtregError | undefined;
  for (const raw of args.positionals) {
    try {
      const { registry, id } = parseTrialId(raw);
      byRegistry.set(registry, [...(byRegistry.get(registry) ?? []), id]);
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      firstIdError ??= e;
      warnings.push({ code: 'id_unroutable', message: e.message, id: raw });
    }
  }
  // 하나도 라우팅하지 못했으면 물어볼 곳이 없다. 빈 성공(exit 0)은 "그런 시험이 없다"
  // 로 읽히므로, 원래 오류를 그대로 던져 사용법 2 / 미지원 3 을 남긴다.
  // 위에서 ID 가 하나 이상임을 확인했으므로 여기 오면 firstIdError 는 반드시 있다.
  if (byRegistry.size === 0) throw firstIdError as CtregError;

  for (const [key, ids] of byRegistry) {
    const adapter = adapters[key]!;
    try {
      // get 은 검색 축을 쓰지 않으므로 질의는 빈 것으로 검사한다. 그래도 --include 는
      // 봐야 한다: 레지스트리가 담지 않는 섹션을 조용히 빠뜨린 레코드를 주면
      // "이 시험엔 그 정보가 없다" 로 오독된다 (guard.ts 가 막으려는 바로 그 혼동).
      assertSupported(adapter.capability(), {}, args.fetch);
      const r = await adapter.get(ids, args.fetch);
      warnings.push(...r.warnings);
      data.push(...r.data);
      registries.push({ registry: key, status: 'ok', returned: r.data.length });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message },
      });
    }
  }
  return { query: { ids: args.positionals }, registries, warnings, data };
}
