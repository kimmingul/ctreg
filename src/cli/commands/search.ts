import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { TrialRecord } from '../../core/record.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { applyLimits, assertSupported, missingAdapterError, zeroResultScope } from '../guard.js';
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
  adapters: Partial<Record<RegistryKey, RegistryAdapter>>,
): Promise<Envelope> {
  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  const data: TrialRecord[] = [];

  for (const key of args.registries) {
    try {
      const adapter = adapters[key];
      if (!adapter) throw missingAdapterError(key);
      // 가드가 먼저다. 미지원 축이면 네트워크를 치지 않는다.
      warnings.push(...assertSupported(adapter.capability(), args.query, args.fetch).warnings);
      // 이 레지스트리의 maxPageSize 로 클램프한다. args.query 자체는 건드리지 않는다 —
      // 여러 레지스트리가 이 루프에서 같은 객체를 공유하므로, 여기서 낮추면 다음
      // 레지스트리가 이미 깎인 값을 물려받는다(guard.ts 의 applyLimits 주석 참고).
      const limited = applyLimits(adapter.capability(), args.query);
      warnings.push(...limited.warnings);
      const r = await adapter.search(limited.query, args.fetch);
      warnings.push(...r.warnings);
      // 0건일 때만, 이 질의가 쓴 축이 무엇을 보는지 말한다(F2). 문구는 가드가 만들고
      // 여기서는 **낼지 말지만** 정한다 — 0건이라는 사실은 search() 뒤에야 알 수 있어
      // 가드가 발화 시점을 정할 수 없기 때문이다(guard.ts 의 zeroResultScope 주석).
      //
      // `total` 을 함께 보는 이유: 페이지 끝을 넘겨 받은 빈 페이지는 이 경고의 사례가
      // 아니다. 업스트림이 걸린 것이 있다고 말하고 있으므로 모호함이 없다.
      if (r.data.length === 0 && (r.total ?? 0) === 0) {
        warnings.push(...zeroResultScope(adapter.capability(), limited.query));
      }
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
