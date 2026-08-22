import { homedir } from 'node:os';
import { join } from 'node:path';
import { usageError } from './errors.js';

export type Config = {
  cacheDir: string;
  cacheTtlSec: number;
  timeoutMs: number;
  maxRetries: number;
  ratePerSec: number;
  ctgovBaseUrl: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cacheDir =
    env.CTREG_CACHE_DIR ??
    (env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, 'ctreg') : join(homedir(), '.cache', 'ctreg'));

  return {
    cacheDir,
    cacheTtlSec: num(env, 'CTREG_CACHE_TTL_SEC', 3600),
    timeoutMs: num(env, 'CTREG_TIMEOUT_MS', 30000),
    maxRetries: num(env, 'CTREG_MAX_RETRIES', 3),
    ratePerSec: num(env, 'CTREG_RATE_PER_SEC', 1),
    ctgovBaseUrl: env.CTREG_CTGOV_BASE_URL ?? 'https://clinicaltrials.gov/api/v2',
  };
}
