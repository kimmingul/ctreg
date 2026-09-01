#!/usr/bin/env node
import { envFilePaths, loadEnvFile } from '../runtime/config.js';
import { run } from './index.js';

/**
 * 현재 디렉터리의 `.env` 를 먼저 읽는다. CRIS 인증키를 셸 환경변수로만 받으면 사용자가
 * 매번 export 해야 하고 셸 히스토리에 키가 남는다.
 *
 * **여기(bin)에서 읽는 이유** — `run()` 은 env 를 인자로 받는 순수한 자리이고,
 * 테스트가 그 자리에 자기 env 를 넣는다. 파일 읽기를 그 안에 넣으면 테스트가 실행
 * 디렉터리에 따라 다르게 돈다. 파일에서 읽어 오는 일은 프로세스 경계인 여기서 한다.
 */
for (const path of envFilePaths()) loadEnvFile(path);

/**
 * 소비자가 파이프를 먼저 닫으면(`| head`) 쓰기가 EPIPE 로 실패한다. Node 는 이것을
 * 처리되지 않은 error 이벤트로 던져 스택트레이스와 exit 1 을 낸다 — 1 은 이 CLI 의
 * 공표된 종료 코드 계약(0/2/3/4/5)에 없는 값이다. 파이프가 닫힌 것은 오류가 아니라
 * 소비자가 충분히 읽었다는 뜻이므로 삼킨다.
 */
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
    // 여기서 종료하지 않는다 — run() 이 정상적으로 끝나 자기 종료 코드를 돌려주게 둔다.
    // 즉시 exit(0) 하면 부분 실패(5)나 사용법 오류(2)가 성공으로 보고된다.
  });
}

const code = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exitCode = code;
