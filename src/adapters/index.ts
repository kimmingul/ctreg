import type { RegistryAdapter } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import type { Config } from '../runtime/config.js';
import type { HttpDeps } from '../runtime/http.js';
import { createCtgovAdapter } from './ctgov/adapter.js';

/** 두 번째 레지스트리를 붙이는 작업은 여기에 한 줄을 더하는 것으로 끝나야 한다. */
export function createAdapters(cfg: Config, deps: HttpDeps = {}): Record<RegistryKey, RegistryAdapter> {
  return { ctgov: createCtgovAdapter(cfg, deps) };
}
