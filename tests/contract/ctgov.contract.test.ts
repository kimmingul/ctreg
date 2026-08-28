import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCtgovAdapter } from '../../src/adapters/ctgov/adapter.js';
import { runAdapterContract } from './adapter-contract.js';

const fixture = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures/ctgov', `${n}.json`), 'utf8'));

const searchPage = fixture('search-page') as { studies: { protocolSection: { identificationModule: { nctId: string } } }[] };
const studyFull = fixture('study-full');

// 두 번째 레지스트리가 생기면 이 파일에 한 줄을 더한다.
runAdapterContract('ctgov', {
  make: (fetchImpl) =>
    createCtgovAdapter(
      {
        cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-contract-')),
        cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
        ctgovBaseUrl: 'https://example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
        ictrpBaseUrl: 'https://ictrp.example.test',
        crisBaseUrl: 'https://cris.example.test',
      },
      { fetchImpl, sleep: async () => {} },
    ),
  // CT.gov 는 목록(`/studies`)과 개별 시험(`/studies/{nctId}`)이 다른 모양을 낸다.
  respond: (url) => (/\/studies\/[^?]/.test(url) ? studyFull : searchPage),
  sampleId: `CTGOV:${searchPage.studies[0]!.protocolSection.identificationModule.nctId}`,
});
