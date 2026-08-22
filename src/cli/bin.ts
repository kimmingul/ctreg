#!/usr/bin/env node
import { run } from './index.js';

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
