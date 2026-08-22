import { unsupportedError, usageError } from '../runtime/errors.js';

export const REGISTRY_KEYS = ['ctgov'] as const;
export type RegistryKey = (typeof REGISTRY_KEYS)[number];

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
