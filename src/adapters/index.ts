import type { RegistryAdapter } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import type { Config } from '../runtime/config.js';
import type { HttpDeps } from '../runtime/http.js';
import { createCrisAdapter } from './cris/adapter.js';
import { createCrisMirrorAdapter } from './cris/mirror.js';
import { createCtisAdapter } from './ctis/adapter.js';
import { createCtgovAdapter } from './ctgov/adapter.js';
import { createIctrpAdapter } from './ictrp/adapter.js';
import { createIsrctnAdapter } from './isrctn/adapter.js';

/**
 * 두 번째 레지스트리를 붙이는 작업은 여기에 한 줄을 더하는 것으로 끝나야 한다.
 *
 * 반환형이 `Partial<>` 인 것은 REGISTRY_KEYS 에 키를 등록했지만 이 함수에는 아직
 * 그 키를 채우지 않은 중간 상태를 타입이 금지하지 않기 위해서다 — 그 상태에서
 * 다섯 커맨드가 무엇을 하는지는 guard.ts 의 missingAdapterError 가 정한다.
 */
export function createAdapters(cfg: Config, deps: HttpDeps = {}): Partial<Record<RegistryKey, RegistryAdapter>> {
  return {
    ctgov: createCtgovAdapter(cfg, deps),
    isrctn: createIsrctnAdapter(cfg, deps),
    ictrp: createIctrpAdapter(cfg, deps),
    // 같은 레지스트리, 다른 문. 사본(KCTIS)이 설정돼 있으면 그쪽 — 연구책임자가 목록 축이 된다.
    cris: cfg.crisMirrorUrl ? createCrisMirrorAdapter(cfg, deps) : createCrisAdapter(cfg, deps),
    ctis: createCtisAdapter(cfg, deps),
  };
}
