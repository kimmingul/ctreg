import { unsupportedError, usageError } from '../runtime/errors.js';

export const REGISTRY_KEYS = ['ctgov', 'isrctn', 'ictrp', 'cris'] as const;
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

type IdSpec = {
  pattern: RegExp;
  normalize: (s: string) => string;
  /**
   * 접두사 없는 입력을 이 레지스트리로 **추론해도 되는가.**
   *
   * 아래 추론은 `REGISTRY_KEYS.find(...)` 라 배열 순서대로 첫 매치가 이긴다. 자기
   * 형식이 뚜렷한 레지스트리는 안전하지만, **집계 레지스트리는 아니다** — ICTRP 의
   * ID 는 스무 곳의 형식이 섞여 있어 패턴이 관대해질 수밖에 없고, 그러면 맨
   * `NCT01234567` 이 ctgov 대신 그리로 가거나(기존 호출자 전원의 동작이 조용히
   * 바뀐다) 지금 exit 2 가 나는 입력이 0건으로 바뀐다.
   *
   * 매치되지 않는 정규식으로 같은 효과를 낼 수 있지만 그것은 트릭이라, 다음 사람이
   * 버그로 알고 "고칠" 위험이 있다. 이유를 그 자리에 남기는 것이 이 저장소의 규율이다.
   */
  inferable: boolean;
};

/**
 * 레지스트리별 접두사 없는 원문 ID 패턴. `Record<RegistryKey, ...>` 이므로
 * `REGISTRY_KEYS` 에 키를 추가하고 여기 항목을 빠뜨리면 컴파일이 깨진다 —
 * 어댑터를 늘릴 때는 두 곳을 다 채워야 하고, 컴파일러가 그것을 강제한다.
 */
const ID_PATTERNS: Record<RegistryKey, IdSpec> = {
  ctgov: { pattern: /^nct\d{8}$/i, normalize: (s) => s.toUpperCase(), inferable: true },
  /**
   * ISRCTN 은 자기 식별자를 두 가지로 쓴다 — `<isrctn>` 요소는 숫자만(`30583116`),
   * `publicIdentifierCanonical` 과 WHO 포맷의 `trial_id` 는 접두사까지(`ISRCTN30583116`).
   * 둘 다 받아 접두사 붙은 쪽으로 접는다: 정규 형태가 둘이면 같은 시험이 두 개의 ctreg
   * id 를 갖고, not_found 대조와 캐시 키가 사용자가 어떻게 쳤는지에 따라 갈린다.
   * 숫자만 있는 형태가 ctgov 패턴과 겹치지 않으므로(NCT 접두사 필수) 추론도 안전하다.
   */
  isrctn: {
    pattern: /^(isrctn)?\d{8}$/i,
    normalize: (s) => `ISRCTN${s.replace(/^isrctn/i, '')}`,
    inferable: true,
  },
  /**
   * ICTRP 는 집계자라 원문 ID 가 원 레지스트리의 것이다 — `NCT…`, `ISRCTN…`,
   * `CTRI/2026/07/113311`, `JPRN-jRCT…`, `DRKS…`. 형식을 열거할 수 없으므로 패턴은
   * "비어 있지 않은 것" 이고, 그래서 **추론에 참여하지 않는다**(`inferable: false`).
   * `ICTRP:` 접두사가 언제나 필요하다.
   *
   * 귀결: 같은 시험이 `CTGOV:NCT07749586` 과 `ICTRP:NCT07749586` 두 개의 ctreg id 를
   * 갖는다. 「연계하지 않는다」 는 설계의 직접적 귀결이고, 의도된 것이다.
   */
  ictrp: { pattern: /^\S+$/, normalize: (s) => s.trim(), inferable: false },
  /**
   * CRIS 의 등록번호는 `KCT` + 숫자 일곱이다(실측 2026-08-28: KCT0000145 … KCT0012524).
   * 형식이 뚜렷하고 다른 셋과 겹치지 않으므로 추론에 참여한다 — ctgov 는 `NCT`+8,
   * ISRCTN 은 숫자 8 또는 `ISRCTN`+8 이라 `KCT` 로 시작하는 것과 부딪히지 않는다.
   */
  cris: { pattern: /^kct\d{7}$/i, normalize: (s) => s.toUpperCase(), inferable: true },
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

  const inferred = REGISTRY_KEYS.find(
    (key) => ID_PATTERNS[key].inferable && ID_PATTERNS[key].pattern.test(trimmed),
  );
  if (!inferred) {
    throw usageError(
      `'${input}' 에서 레지스트리를 알아낼 수 없습니다`,
      'CTGOV:NCT01234567 처럼 접두사를 붙이거나, 접두사 없는 NCT 번호를 주세요.',
    );
  }
  const registryId = ID_PATTERNS[inferred].normalize(trimmed);
  return { registry: inferred, registryId, id: formatTrialId(inferred, registryId) };
}
