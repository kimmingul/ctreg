import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { TrialRecord } from '../../core/record.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { assertSupported } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * count 와 같은 루프다 — 레지스트리마다 독립으로 시도하고, 실패는 그 레지스트리의
 * RegistryStatus 에만 기록한다. 종료 코드는 exitFor 가 registries[] 를 보고 정한다.
 *
 * search 만의 책임은 페이지 커서다. nextPageToken 은 페이지 번호가 아니라 불투명한
 * 커서라서, 봉투에 실어 내보내지 않으면 호출자가 다음 페이지를 요청할 방법이 아예 없다.
 * total 도 마찬가지로 레지스트리별로 남긴다 — 스킬은 그 수를 보고 페이지를 더 넘길지
 * 조건을 좁힐지 정한다.
 */
export async function runSearch(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  const data: TrialRecord[] = [];

  for (const key of args.registries) {
    const adapter = adapters[key]!;
    try {
      // 가드가 먼저다. 미지원 축이면 네트워크를 치지 않는다.
      assertSupported(adapter.capability(), args.query, args.fetch);
      const r = await adapter.search(args.query, args.fetch);
      warnings.push(...r.warnings);
      data.push(...r.data);
      registries.push({
        registry: key,
        status: 'ok',
        returned: r.data.length,
        ...(r.total !== undefined ? { total: r.total } : {}),
        ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
      });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) },
      });
    }
  }
  return { query: args.query, registries, warnings, data };
}
