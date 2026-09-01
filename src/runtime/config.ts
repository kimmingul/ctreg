import { readFileSync } from 'node:fs';
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
  ictrpBaseUrl: string;
  crisBaseUrl: string;
  ctisBaseUrl: string;
  /**
   * CRIS(공공데이터포털) 인증키. **없을 수 있다** — 나머지 세 레지스트리는 키가
   * 필요 없으므로, 키가 없다고 CLI 전체가 못 뜨면 안 된다. 없을 때 무슨 일이
   * 일어나는지는 어댑터가 정한다(exit 4 로 "키가 없다" 를 말한다).
   */
  crisServiceKey?: string;
  /**
   * **ICTRP 를 자동 조회해도 된다고 사용자가 표시했는가.**
   *
   * 왜 필요한가(2026-08-29 확인) — 이 어댑터는 사람이 쓰는 검색 화면을 포스트백으로
   * 조작한다. WHO 가 자동 접근용으로 내놓은 것은 Web Service 와 Crawling Service 둘인데
   * **둘 다 사무국과의 합의와 비용을 요구하고**(크롤 조건: "an agreed partner website"),
   * `trialsearch.who.int/robots.txt` 는 `Disallow: /` 다.
   *
   * 그래서 기본값이 꺼짐이다. 기능을 지우지는 않는다 — 합의가 있는 사용자에게서 뺏을
   * 이유가 없다. 나머지 세 레지스트리는 이 값과 무관하게 그대로 동작한다.
   */
  ictrpAcknowledged: boolean;
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

/**
 * `.env` 를 읽어 환경에 채운다. **이미 있는 값은 덮지 않는다** — 파일은 기본값이고
 * 그때그때의 개입(셸 환경변수)이 우선이라야, 다른 키로 한 번 돌려 보는 일이 파일을
 * 고쳤다 되돌리는 일이 되지 않는다.
 *
 * 파일이 없으면 **아무 일도 하지 않는다.** 네 레지스트리 중 키가 필요한 것은 CRIS
 * 하나뿐이라, 파일이 없다고 CLI 가 못 뜨면 나머지 셋을 쓰는 사람이 막힌다.
 *
 * `node:util` 의 파서를 쓰지 않고 직접 읽는 이유는 형식을 우리가 정할 수 있어야 하기
 * 때문이다 — 여기서 다루는 것은 주석·빈 줄·따옴표·값 안의 등호까지다. 값 안의 등호를
 * 자르면 키가 조용히 잘려 인증이 이유 없이 실패한다.
 */
/**
 * `.env` 를 찾는 자리와 **그 순서.**
 *
 * 전에는 실행 디렉터리 하나뿐이었다. 그런데 이 CLI 는 **전역으로 설치해서 아무 폴더에서나
 * 쓰는 물건** 이라, 그 규칙은 "설정이 프로젝트마다 따로" 를 뜻했다 — CRIS 키를 넣어 둔
 * 폴더를 벗어나면 인증이 실패했고, 사용자 눈에는 도구가 고장난 것으로 보였다.
 *
 * 그래서 **사용자 수준 자리를 하나 더 본다.** 캐시 디렉터리와 같은 관례를 쓴다
 * (`XDG_CONFIG_HOME` → 없으면 `~/.config/ctreg`) — 한 도구가 두 규칙을 갖지 않는다.
 *
 * **순서가 곧 우선순위다.** `loadEnvFile` 이 이미 있는 값을 덮지 않으므로, 앞에 오는 것이
 * 이긴다: 셸 환경변수 → 실행 디렉터리 → 사용자 설정. 가까운 것이 이겨야 다른 키로 한 번
 * 돌려 보는 일이 전역 설정을 고쳤다 되돌리는 일이 되지 않는다.
 */
export function envFilePaths(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string[] {
  const userDir = env.XDG_CONFIG_HOME
    ? join(env.XDG_CONFIG_HOME, 'ctreg')
    : join(homedir(), '.config', 'ctreg');
  return [join(cwd, '.env'), join(userDir, '.env')];
}

/**
 * `envFilePaths()` 의 자리를 **순서대로 전부** 읽는다.
 *
 * **이 반복이 `bin.ts` 에 있으면 테스트가 닿지 않는다.** 사보타주로 확인했다: `bin.ts` 가
 * 첫 자리만 읽게 바꿨더니 스위트가 그대로 초록이었고(817 통과) 실물에서만 키를 못 읽었다.
 * 프로세스 경계에는 **부르는 한 줄만** 남기고 규칙은 여기 둔다.
 */
export function loadEnvFiles(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): void {
  for (const path of envFilePaths(env, cwd)) loadEnvFile(path, env);
}

export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (env[name] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    env[name] = value;
  }
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
    ictrpBaseUrl: env.CTREG_ICTRP_BASE_URL ?? 'https://trialsearch.who.int',
    // 값이 있으면 켠다. 없거나 빈 문자열이면 꺼짐 — 기본값을 실수로 켜지 못하게.
    ictrpAcknowledged: (env.CTREG_ICTRP_ACKNOWLEDGED ?? '') !== '',
    // 공공데이터포털의 `질병관리청_임상연구 DB`. 경로에 오퍼레이션(`/list`)이 붙는다.
    crisBaseUrl: env.CTREG_CRIS_BASE_URL ?? 'https://apis.data.go.kr/1352159/crisinfodataview',
    // EMA 의 CTIS 공개 포털. 인증이 없고, 재사용은 출처 표시만 요구한다(법적 고지).
    ctisBaseUrl: env.CTREG_CTIS_BASE_URL ?? 'https://euclinicaltrials.eu/ctis-public-api',
    ...(env.CTREG_CRIS_SERVICE_KEY ? { crisServiceKey: env.CTREG_CRIS_SERVICE_KEY } : {}),
  };
}
