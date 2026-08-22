#!/usr/bin/env node
import { run } from './index.js';

/**
 * 소비자가 파이프를 먼저 닫으면(`| head`) 쓰기가 EPIPE 로 실패한다. Node 는 이것을
 * 처리되지 않은 error 이벤트로 던져 스택트레이스와 exit 1 을 낸다 — 1 은 이 CLI 의
 * 공표된 종료 코드 계약(0/2/3/4/5)에 없는 값이다. 파이프가 닫힌 것은 오류가 아니라
 * 소비자가 충분히 읽었다는 뜻이므로 조용히 끝낸다.
 */
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

const code = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exitCode = code;
