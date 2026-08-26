import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIctrpAdapter } from '../../src/adapters/ictrp/adapter.js';
import { runAdapterContract } from './adapter-contract.js';

const form = readFileSync(join(__dirname, '../fixtures/ictrp/advsearch-form.html'), 'utf8');
const results = readFileSync(join(__dirname, '../fixtures/ictrp/results-page1.html'), 'utf8');
void form;

/**
 * ICTRP 는 HTML 만 낸다. `wire` 가 선으로 나가는 바이트이고 `respond` 는 그것을
 * 자료로 본 모습이다 — 같은 픽스처에서 파생시켜 둘이 어긋날 일을 없앤다.
 *
 * 이 스위트는 GET 과 POST 를 구분하지 못하고 URL 만 준다. ICTRP 는 두 요청이 같은
 * 경로라, 폼과 결과를 URL 로 가를 수 없다. 그래서 **결과 페이지를 낸다** — 그 안에도
 * hidden 필드가 있어 폼 수확이 성립하고, 검색 결과도 담겨 있다.
 */
runAdapterContract('ictrp', {
  make: (fetchImpl) =>
    createIctrpAdapter(
      {
        cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ictrp-contract-')),
        cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
        ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
        ictrpBaseUrl: 'https://ictrp.example.test',
      },
      { fetchImpl, sleep: async () => {} },
    ),
  respond: () => results,
  wire: () => ({ text: results, contentType: 'text/html' }),
  sampleId: 'ICTRP:NCT07749586',
  // ICTRP 는 배치 ID 조회 창구가 없다 — get() 은 unsupportedError 를 던진다(adapter.ts).
  getSupported: false,
  // ddlPageSize 를 실으면 검색이 0건으로 깨진다(query.ts) — pageSize 는 항상 고정 10이다.
  pageSizeConfigurable: false,
});
