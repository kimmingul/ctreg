import type { RegistryAdapter } from '../../core/capability.js';
import { parseTrialId, type RegistryKey } from '../../core/registry.js';
import { CtregError, usageError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import type { Envelope, RegistryStatus } from '../output.js';

/**
 * ID 하나만 받는다 — 결과는 시험 하나 단위로 크고, 섹션 필터도 시험 하나를 가정한다.
 *
 * 레지스트리가 결과를 아예 담지 않으면 빈 결과가 아니라 exit 3 이다.
 * "이 레지스트리는 결과 데이터를 싣지 않는다" 와 "이 시험은 이상반응이 없었다" 는
 * 다른 사실이고, 앞의 것을 뒤의 것으로 읽은 호출자는 틀린 결론을 내린다.
 *
 * 봉투 모양은 search/count/get 과 하나로 맞춘다: **registries[] 가 비어 있다는 것은
 * 어떤 레지스트리도 정해지지 않았다는 뜻이다.** 그래서 "레지스트리가 결과를 안 싣는다"
 * 는 던지지 않고 그 레지스트리의 RegistryStatus 로 남긴다 — 레지스트리는 이미
 * 정해졌고(parseTrialId 가 풀었다), 못 한다고 말하는 주체가 바로 그 레지스트리다.
 * 반대로 사용법 오류는 어떤 레지스트리도 부르기 전에 요청을 반려하는 것이므로
 * registries[] 가 비어 있는 채로 던진다.
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
  const query = { id, sections: args.results.sections };

  if (!cap.results) {
    // RegistryStatus.error 에는 hint 를 담을 자리가 없다. 그래서 이 오류의 핵심
    // 구분("결과가 없는 게 아니라 안 싣는다")은 메시지 안에 있어야 한다 — 힌트로
    // 미루면 봉투에서 사라진다.
    return {
      query,
      registries: [
        {
          registry,
          status: 'unsupported',
          error: {
            code: 'unsupported',
            message: `${cap.name} 은 결과 데이터를 제공하지 않습니다 (결과가 없는 것이 아니라 레지스트리가 결과를 싣지 않습니다)`,
          },
        },
      ],
      warnings: [],
      data: null,
    };
  }

  const registries: RegistryStatus[] = [];
  try {
    const r = await adapter.results(id, args.results);
    registries.push({ registry, status: 'ok', returned: 1 });
    return { query, registries, warnings: r.warnings, data: r.data };
  } catch (e) {
    if (!CtregError.is(e)) throw e;

    // 없는 시험은 업스트림 장애가 아니다. http 층은 404 를 exit 4 로 신고하고 그건
    // 그 층에서 맞다(다른 호출자는 원래 사실을 원한다). 하지만 exit 4 는 "백오프 후
    // 재시도" 계약이라, 영영 존재하지 않을 시험을 스킬이 무한히 다시 물어보게 된다.
    // get 은 같은 사실을 not_found 경고 + exit 0 으로 낸다. 여기서도 맞춘다.
    if (e.code === 'not_found') {
      return {
        query,
        registries: [{ registry, status: 'ok', returned: 0 }],
        warnings: [{ code: 'not_found', message: `${cap.name} 에서 찾지 못했습니다.`, id }],
        data: null,
      };
    }

    registries.push({
      registry,
      status: e.code === 'unsupported' ? 'unsupported' : 'error',
      error: { code: e.code, message: e.message },
    });
    return { query: { id }, registries, warnings: [], data: null };
  }
}
