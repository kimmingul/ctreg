/**
 * 스위트 전체가 시작되기 전에 **한 번** `dist/` 를 만든다.
 *
 * **왜 여기인가.** 예전에는 `runtime/throttle.process.test.ts` 의 `beforeAll` 이
 * `bun run build` 를 돌렸다. vitest 는 파일을 병렬로 돌리므로 그 빌드가
 * `cli/epipe.test.ts` 가 `node dist/cli/bin.js` 를 띄우는 **동안** 겹쳤다. `tsc` 는 dist 를
 * 한 파일씩 쓰기 때문에 그 사이 dist 는 내부적으로 어긋나 있고(한 파일은 새 판, 옆 파일은
 * 옛 판), 그때 실행하면 모듈 로드가 깨진다.
 *
 * 깨진 스택트레이스에는 `node:internal` 이 들어 있어 「스택트레이스를 내지 않는다」가
 * 실패하는데, **그 테스트가 주장하는 것과 무관한 이유로** 실패한다. 이 저장소는 그 실패를
 * 세 번 보고 세 번 다 이름을 못 잡은 채 "벽시계 의존 플레이크"(O3·O4)로 분류했다.
 * 원인은 타이밍이 아니라 **스위트가 스스로 만드는 경쟁** 이었다(2026-08-27 확정).
 *
 * globalSetup 은 어떤 테스트 파일보다 먼저, 한 번만 돈다 — 그래서 빌드가 다른 파일의
 * 실행 창과 겹칠 수 없다. `npx vitest run` 이 깨끗한 체크아웃에서도 그대로 동작하는 것은
 * 예전과 같다(빌드가 사라진 것이 아니라 자리를 옮겼을 뿐이다).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

export default function setup(): void {
  // 셸을 거치지 않는다 — 고정 문자열이라 주입면은 없지만 셸이 필요한 이유도 없다.
  execFileSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (!existsSync(join(ROOT, 'dist/cli/bin.js'))) {
    throw new Error('빌드가 끝났는데 dist/cli/bin.js 가 없습니다 — 빌드 산출물을 확인하세요.');
  }
}
