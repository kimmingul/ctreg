import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCtgovAdapter } from '../../src/adapters/ctgov/adapter.js';
import { runAdapterContract } from './adapter-contract.js';

// 두 번째 레지스트리가 생기면 이 파일에 한 줄을 더한다.
runAdapterContract('ctgov', () =>
  createCtgovAdapter({
    cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-contract-')),
    cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 3, ratePerSec: 1000,
    ctgovBaseUrl: 'https://example.test/api/v2',
  }),
);
