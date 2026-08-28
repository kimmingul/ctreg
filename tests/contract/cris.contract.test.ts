import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCrisAdapter } from '../../src/adapters/cris/adapter.js';
import { runAdapterContract } from './adapter-contract.js';

/**
 * 픽스처는 공식 API 의 실제 응답이다(2026-08-28, `srchWord=메트포르민`, 3건).
 * 인증키는 응답에 들어가지 않으므로 그대로 커밋해도 된다 — 저장 시 확인했다.
 */
const list = JSON.parse(readFileSync(join(__dirname, '../fixtures/cris/list.json'), 'utf8')) as unknown;

runAdapterContract('cris', {
  make: (fetchImpl) =>
    createCrisAdapter(
      {
        cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-cris-contract-')),
        cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
        ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
        ictrpBaseUrl: 'https://ictrp.example.test',
        crisBaseUrl: 'https://cris.example.test',
        // 계약 스위트는 키가 있는 상태를 본다. 키가 없을 때의 동작은 adapter.test.ts 가 본다.
        crisServiceKey: 'CONTRACT_TEST_KEY',
      },
      { fetchImpl, sleep: async () => {} },
    ),
  respond: () => list,
  /**
   * 이 어댑터는 `--term` 없이는 검색하지 않는다(그렇게 부르면 전체 첫 쪽이 오고, 그것을
   * 검색 결과로 내보내면 조용히 틀린 답이 된다). 계약 스위트가 쓰는 최소 질의도 term 이어야 한다.
   */
  probeQuery: { term: 'x' },
  locationsSupported: false,
  sampleId: 'CRIS:KCT0009342',
});
