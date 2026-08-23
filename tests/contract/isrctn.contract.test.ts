import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsrctnAdapter } from '../../src/adapters/isrctn/adapter.js';
import { parseIsrctnXml } from '../../src/adapters/isrctn/xml.js';
import { runAdapterContract } from './adapter-contract.js';

const fixture = (n: string) => readFileSync(join(__dirname, '../fixtures/isrctn', `${n}.xml`), 'utf8');

/**
 * ISRCTN 은 XML 만 낸다. 그래서 이 항목은 `wire`(선으로 나가는 바이트)와
 * `respond`(그 바이트를 자료로 본 모습) 를 **같은 픽스처에서** 파생시킨다 — 손으로
 * 두 벌을 유지하면 둘이 어긋나는 순간 `--raw` 의 source 검사가 거짓 실패한다.
 */
const searchWho = fixture('search-who');
const countDefault = fixture('count-default');

// 레코드는 WHO 포맷, 총계는 default 포맷의 limit=0 응답에서 온다(map.ts 의 주석 참고).
const isCount = (url: string) => url.includes('/format/default');
const wireFor = (url: string) => (isCount(url) ? countDefault : searchWho);

runAdapterContract('isrctn', {
  make: (fetchImpl) =>
    createIsrctnAdapter(
      {
        cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-isrctn-contract-')),
        cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
        ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
      },
      { fetchImpl, sleep: async () => {} },
    ),
  respond: (url) => parseIsrctnXml(wireFor(url)),
  wire: (url) => ({ text: wireFor(url), contentType: 'application/xml' }),
  sampleId: 'ISRCTN:ISRCTN64724266',
});
