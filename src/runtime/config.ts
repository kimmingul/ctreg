import { homedir } from 'node:os';
import { join } from 'node:path';
import { usageError } from './errors.js';

export type Config = {
  cacheDir: string;
  cacheTtlSec: number;
  timeoutMs: number;
  maxRetries: number;
  /**
   * 전역 오버라이드. 레지스트리마다 예산이 다르므로(스펙 §6.2) 이 값은 더 이상
   * "모든 레지스트리의 rate" 가 아니다 — 미설정(undefined)이면 http.ts 가 각
   * 어댑터의 `capability.limits.ratePerSec` 를 그대로 쓴다. 이 필드가 있는 건
   * 오직 운영자가 명시적으로 개입할 때뿐이다(공유 네트워크에서 전부 늦추거나,
   * 특별 허가로 전부 올리거나). 레지스트리별 선언이 전역 기본값에 조용히 지는
   * 일은 없어야 하므로 기본값 1을 없앴다 — 예전엔 미설정 = 하드코딩 1이었고,
   * 지금은 미설정 = 어댑터 선언값이다.
   */
  ratePerSec?: number;
  ctgovBaseUrl: string;
  isrctnBaseUrl: string;
};

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw usageError(`${name} 이 숫자가 아닙니다: '${raw}'`, `${name} 을 숫자로 두거나 지우세요.`);
  }
  return parsed;
}

function optNum(env: NodeJS.ProcessEnv, name: string): number | undefined {
  if (env[name] === undefined || env[name] === '') return undefined;
  return num(env, name, 0 /* 사용되지 않음 — 위에서 이미 값이 있음을 확인했다 */);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cacheDir =
    env.CTREG_CACHE_DIR ??
    (env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, 'ctreg') : join(homedir(), '.cache', 'ctreg'));

  return {
    cacheDir,
    cacheTtlSec: num(env, 'CTREG_CACHE_TTL_SEC', 3600),
    timeoutMs: num(env, 'CTREG_TIMEOUT_MS', 30000),
    maxRetries: num(env, 'CTREG_MAX_RETRIES', 3),
    ratePerSec: optNum(env, 'CTREG_RATE_PER_SEC'),
    ctgovBaseUrl: env.CTREG_CTGOV_BASE_URL ?? 'https://clinicaltrials.gov/api/v2',
    // ctgov 와 달리 경로에 버전이 없다 — ISRCTN 의 엔드포인트는 `/api/query/...` 로
    // 사이트 루트에 바로 붙는다(API 문서 3: "base URL for all API calls is the URL of
    // the site"). 그래서 여기 담기는 것은 호스트까지다.
    isrctnBaseUrl: env.CTREG_ISRCTN_BASE_URL ?? 'https://www.isrctn.com',
  };
}
