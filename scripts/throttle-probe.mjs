// 여러 프로세스가 동시에 슬롯을 예약해도 요청률이 지켜지는지 확인하는 프로브.
// 빌드된 dist 를 쓴다 — 실제 배포 산출물을 검증하기 위함이다.
import { appendFileSync } from 'node:fs';
import { reserveSlot } from '../dist/runtime/throttle.js';

const [dir, logPath, ratePerSec] = process.argv.slice(2);
await reserveSlot({ dir, registry: 'probe', ratePerSec: Number(ratePerSec) });
appendFileSync(logPath, `${Date.now()}\n`);
