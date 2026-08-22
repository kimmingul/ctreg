import { unsupportedError, usageError } from '../runtime/errors.js';

export const REGISTRY_KEYS = ['ctgov'] as const;
export type RegistryKey = (typeof REGISTRY_KEYS)[number];

/**
 * `--registry` 를 주지 않았을 때 조회할 레지스트리 (스펙 §4.1: `기본 ctgov`).
 *
 * 이름 붙인 하나여야 한다 — "등록된 모든 키" 로 두면 어댑터를 하나 붙이는 순간
 * `--registry` 를 쓴 적 없는 기존 호출자 전원의 기본 동작이 조용히 팬아웃으로
 * 바뀐다. 어댑터를 더해도 이 심(seam) 위쪽은 그대로여야 한다는 것이 이 설계의
 * 전제이므로, 그 전제를 깨는 유일한 자리를 여기서 못 박는다. 팬아웃은 호출자가
 * `--registry a --registry b` 로 명시적으로 요청할 때만 일어난다.
 */
export const DEFAULT_REGISTRY: RegistryKey = 'ctgov';

export function isRegistryKey(v: string): v is RegistryKey {
  return (REGISTRY_KEYS as readonly string[]).includes(v);
}

export function formatTrialId(registry: RegistryKey, registryId: string): string {
  return `${registry.toUpperCase()}:${registryId}`;
}

type IdSpec = { pattern: RegExp; normalize: (s: string) => string };

/**
 * 레지스트리별 접두사 없는 원문 ID 패턴. `Record<RegistryKey, ...>` 이므로
 * `REGISTRY_KEYS` 에 키를 추가하고 여기 항목을 빠뜨리면 컴파일이 깨진다 —
 * 어댑터를 늘릴 때는 두 곳을 다 채워야 하고, 컴파일러가 그것을 강제한다.
 */
const ID_PATTERNS: Record<RegistryKey, IdSpec> = {
  ctgov: { pattern: /^nct\d{8}$/i, normalize: (s) => s.toUpperCase() },
};

export function parseTrialId(input: string): {
  registry: RegistryKey;
  registryId: string;
  id: string;
} {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(':');

  if (colon > 0) {
    const prefix = trimmed.slice(0, colon).toLowerCase();
    const rest = trimmed.slice(colon + 1);
    if (!isRegistryKey(prefix)) {
      throw unsupportedError(
        `레지스트리 '${prefix}' 어댑터가 없습니다`,
        `ctreg registries 로 사용 가능한 레지스트리를 확인하세요. 현재: ${REGISTRY_KEYS.join(', ')}`,
      );
    }
    const registryId = ID_PATTERNS[prefix].normalize(rest);
    return { registry: prefix, registryId, id: formatTrialId(prefix, registryId) };
  }

  const inferred = REGISTRY_KEYS.find((key) => ID_PATTERNS[key].pattern.test(trimmed));
  if (!inferred) {
    throw usageError(
      `'${input}' 에서 레지스트리를 알아낼 수 없습니다`,
      'CTGOV:NCT01234567 처럼 접두사를 붙이거나, 접두사 없는 NCT 번호를 주세요.',
    );
  }
  const registryId = ID_PATTERNS[inferred].normalize(trimmed);
  return { registry: inferred, registryId, id: formatTrialId(inferred, registryId) };
}
