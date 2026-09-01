import { createRequire } from 'node:module';

/**
 * 버전은 **`package.json` 하나에서만 온다.**
 *
 * 이 저장소에는 버전이 이미 세 곳에 있다(`package.json`·`plugin.json`·`marketplace.json`)
 * 고 그 셋은 테스트로 묶어 뒀다. 소스에 상수로 박으면 네 번째가 되고, 그것이 갈리면
 * **`--version` 이 거짓말을 한다** — "지금 도는 게 어느 사본인가" 를 가리려고 쓰는 바로
 * 그 자리에서 틀린 답을 주는 것이라 없느니만 못하다.
 *
 * **`.env` 와 달리 여기서 파일을 읽어도 된다.** `bin.ts` 가 파일 읽기를 프로세스 경계로
 * 미룬 이유는 `.env` 가 **실행 디렉터리에 따라 달라지기** 때문이었다. 이쪽은
 * `import.meta.url` 기준이라 어디서 실행하든 같은 파일을 가리킨다 — cwd 와 무관하다.
 *
 * 번들로 말면(`npm run compile`) 이 상대 경로가 성립하지 않는다 — `package.json` 이
 * 옆에 없다. 그래서 그 스크립트가 빌드 시점에 값을 **심는다**(`--define`). 심는 값도
 * `package.json` 에서 오므로 출처는 여전히 하나다.
 *
 * 둘 다 실패하면 **모른다고 말한다** — 지어낸 번호를 내놓으면 그것을 믿고 판단하게 된다.
 */
declare const __CTREG_VERSION__: string | undefined;

export function readVersion(): string {
  // 번들이 심어 둔 값이 있으면 그것이 맞다 — 그 안에는 package.json 이 없다.
  if (typeof __CTREG_VERSION__ === 'string' && __CTREG_VERSION__ !== '') return __CTREG_VERSION__;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
