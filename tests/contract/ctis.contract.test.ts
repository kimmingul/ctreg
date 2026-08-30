import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCtisAdapter } from '../../src/adapters/ctis/adapter.js';
import { runAdapterContract } from './adapter-contract.js';

/**
 * 픽스처는 공개 API 의 실제 응답이다(2026-08-30, `medicalCondition=diabetes`, 3건).
 * 인증이 없는 API 라 비밀값이 섞일 자리가 없다.
 */
const search = JSON.parse(readFileSync(join(__dirname, '../fixtures/ctis/search.json'), 'utf8')) as unknown;

runAdapterContract('ctis', {
  make: (fetchImpl) =>
    createCtisAdapter(
      {
        cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ctis-contract-')),
        cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
        ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
        ictrpBaseUrl: 'https://ictrp.example.test',
        crisBaseUrl: 'https://cris.example.test',
        ctisBaseUrl: 'https://ctis.example.test',
        ictrpAcknowledged: true,
      },
      { fetchImpl, sleep: async () => {} },
    ),
  respond: () => search,
  /**
   * 이 어댑터는 조건 없이는 검색하지 않는다 — 조건 없이 부르면 전체 12,317건의 첫 쪽이
   * 오고, 그것을 검색 결과로 내보내면 조용히 틀린 답이 된다. `condition` 은 실제로 거르는
   * 축이므로(medicalCondition, 실측 201건) 하네스의 기본 질의를 그대로 쓸 수 있다.
   */
  probeQuery: { condition: 'x' },
  // 참여국이 여섯인 시험을 고른다 — 하나짜리를 고르면 장소 캡 검사가 공허하게 통과한다.
  sampleId: 'CTIS:2025-523260-20-00',
});
