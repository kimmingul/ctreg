import { unsupportedError, usageError } from '../runtime/errors.js';

export const REGISTRY_KEYS = ['ctgov'] as const;
export type RegistryKey = (typeof REGISTRY_KEYS)[number];

export function isRegistryKey(v: string): v is RegistryKey {
  return (REGISTRY_KEYS as readonly string[]).includes(v);
}

export function formatTrialId(registry: RegistryKey, registryId: string): string {
  return `${registry.toUpperCase()}:${registryId}`;
}

/** 접두사 없는 원문 ID 를 레지스트리로 되돌리는 패턴. 어댑터가 늘면 여기에 줄이 는다. */
const ID_PATTERNS: { registry: RegistryKey; pattern: RegExp; normalize: (s: string) => string }[] = [
  { registry: 'ctgov', pattern: /^nct\d{8}$/i, normalize: (s) => s.toUpperCase() },
];

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
    const match = ID_PATTERNS.find((p) => p.registry === prefix);
    const registryId = match?.normalize(rest) ?? rest;
    return { registry: prefix, registryId, id: formatTrialId(prefix, registryId) };
  }

  const inferred = ID_PATTERNS.find((p) => p.pattern.test(trimmed));
  if (!inferred) {
    throw usageError(
      `'${input}' 에서 레지스트리를 알아낼 수 없습니다`,
      'CTGOV:NCT01234567 처럼 접두사를 붙이거나, 접두사 없는 NCT 번호를 주세요.',
    );
  }
  const registryId = inferred.normalize(trimmed);
  return { registry: inferred.registry, registryId, id: formatTrialId(inferred.registry, registryId) };
}
