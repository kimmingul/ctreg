# ctreg 슬라이스 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ClinicalTrials.gov 어댑터 하나를 가진 `ctreg` CLI를 만든다. 정규화 계약과 어댑터 심을 먼저 고정해, 두 번째 레지스트리가 어댑터 파일 하나 추가로 붙게 한다.

**Architecture:** 순수 계약 층(`core/`) → 프로세스 간 공유 런타임(`runtime/`) → 레지스트리 어댑터(`adapters/ctgov/`) → CLI 표면(`cli/`) 순으로 아래에서 위로 쌓는다. 어댑터는 `RegistryAdapter` 인터페이스 뒤에 있고 CLI는 구체 레지스트리를 모른다. 요청률·캐시 상태는 단명 프로세스들이 공유해야 하므로 디스크에 둔다.

**Tech Stack:** TypeScript / Bun(개발·테스트) / Node 호환 ESM(빌드) / vitest / zod / proper-lockfile

**Spec:** `docs/superpowers/specs/2026-08-22-ctreg-design.md`

## Global Constraints

스펙에서 그대로 옮긴 프로젝트 전역 요구사항. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **런타임 의존성은 `zod` 와 `proper-lockfile` 둘뿐.** 그 외 런타임 의존성 추가 금지. 인자 파싱은 Node 내장 `util.parseArgs`.
- **빌드 산출물은 Node 호환 ESM.** `npx ctreg` 가 동작해야 한다. `engines.node >= 22`.
- **stdout 은 기계용, stderr 는 사람용.** 로그·진행상황·타이밍은 어떤 경우에도 stdout 을 오염시키지 않는다.
- **조용한 절단 금지.** 잘라낸 모든 지점은 `warnings[]` 항목 하나와 레코드 안의 `*Truncated` 플래그를 남긴다.
- **미지원 capability 는 빈 결과가 아니라 exit 3.** 빈 결과를 반환하면 에이전트가 "해당 시험 없음"과 "이 레지스트리는 그렇게 못 찾음"을 구분하지 못한다.
- **값이 없으면 필드를 생략한다.** 추측 금지, `null`/빈 문자열 채우기 금지. 손실 매핑은 항상 `*Raw` 를 동반한다.
- **Exit code:** `0` 정상(결과 0건 포함) · `2` 사용법/검증 · `3` 미지원 capability · `4` 업스트림 실패 · `5` 부분 실패.
- **요청률 기본 `1 req/s`,** 레지스트리별 온디스크 토큰버킷을 프로세스 간에 공유한다.
- **라이선스:** Apache-2.0. 업스트림(`clinicaltrialsgov-mcp-server`, Casey Hand / cyanheads)에서 포팅한 파일은 원저작권 헤더를 보존하고 유래를 주석으로 남긴다. `LICENSE` 와 `NOTICE` 를 배포물에 포함한다.
- **상표:** 패키지명·바이너리명·플러그인 id 에 ClinicalTrials.gov / NLM 을 쓰지 않는다.
- 참조 구현은 `clinicaltrialsgov-mcp-server/` 에 클론되어 있다. **읽기 전용 참고이며 수정하지 않는다.**

---

## 파일 구조

| 경로 | 책임 |
| :-- | :-- |
| `src/core/vocab.ts` | 폐쇄 어휘(status/phase/studyType)와 필터 입력 허용 여부 |
| `src/core/registry.ts` | 레지스트리 키, `CTGOV:NCT…` ID 파싱·정규화 |
| `src/core/record.ts` | `TrialRecord` · `TrialLocation` · `TrialResults` Zod 스키마 |
| `src/core/capability.ts` | `Capability` 스키마, `RegistryAdapter` 인터페이스, `AdapterResult`/`Warning` |
| `src/core/query.ts` | `NormalizedQuery` · `FetchOpts` · `ResultsOpts` 타입과 캡 상수 |
| `src/cli/exit-codes.ts` | exit code 상수 |
| `src/runtime/errors.ts` | `CtregError` + 팩토리. `mcp-ts-core` 에러 팩토리 대체 |
| `src/runtime/throttle.ts` | 온디스크 토큰버킷 + 락 + 공유 백오프 |
| `src/runtime/cache.ts` | 온디스크 응답 캐시, TTL, `fetchedAt` 보존 |
| `src/runtime/http.ts` | fetch + 재시도/백오프, throttle·cache 통합 |
| `src/runtime/config.ts` | `CTREG_*` 환경변수 → 설정 |
| `src/adapters/ctgov/vocab.ts` | CT.gov enum ↔ 공통 어휘 양방향 |
| `src/adapters/ctgov/query.ts` | `NormalizedQuery` → CT.gov 파라미터 |
| `src/adapters/ctgov/map.ts` | CT.gov JSON → `TrialRecord` |
| `src/adapters/ctgov/results.ts` | `resultsSection` → `TrialResults` + 필터 |
| `src/adapters/ctgov/client.ts` | CT.gov 엔드포인트 래퍼 (업스트림 포팅) |
| `src/adapters/ctgov/adapter.ts` | `RegistryAdapter` 구현 |
| `src/cli/output.ts` | 봉투 조립, 절단 플래그, `json`/`ndjson`/`text` 렌더 |
| `src/cli/index.ts` | 진입점, `parseArgs`, 커맨드 디스패치, exit code |
| `src/cli/commands/*.ts` | `search` `get` `results` `count` `registries` |
| `tests/contract/adapter-contract.ts` | 모든 어댑터가 통과해야 하는 공통 스위트 |
| `tests/fixtures/ctgov/*.json` | 기록된 실제 CT.gov 응답 + 손으로 만든 희소 응답 |
| `scripts/field-test.ts` | 스펙 §7.4 미검증 문법을 실제 API로 확인 |

---

## Task 0: 계약 사전 검증 — 두 번째 레지스트리 대조 (게이트)

**이 태스크를 건너뛰면 C 방안의 값이 전부 사라진다.** 정규화 계약을 ClinicalTrials.gov 만 보고 설계하면 그것은 이름만 페더레이션인 A(충실한 어댑터)이고, 두 번째 어댑터를 붙이는 날 위층이 전부 바뀐다. 스펙 §11 위험 1번이 이 태스크다.

코드를 쓰지 않는다. 산출물은 문서 하나와 `TrialRecord` core 필드에 대한 판정이다.

**Files:**
- Create: `docs/registry-field-survey-2026-08-22.md`
- Modify (필요 시): `docs/superpowers/specs/2026-08-22-ctreg-design.md` §2.2

**Interfaces:**
- Consumes: 스펙 §2.2 의 `TrialRecord` core 필드 목록
- Produces: core / detail 경계에 대한 확정. Task 4 의 `record.ts` 는 이 판정을 따른다.

- [ ] **Step 1: 대조할 레지스트리 세 곳의 공개 스키마를 찾는다**

최소 세 곳을 본다. WHO ICTRP 는 다른 레지스트리를 집계하는 상위 계층이라 반드시 포함한다.

| 레지스트리 | 출발점 |
| :-- | :-- |
| WHO ICTRP | `https://trialsearch.who.int` — 검색 포털의 내보내기 필드 목록 / 데이터 사전 |
| EU CTIS | `https://euclinicaltrials.eu` — 공개 포털과 공개 API 문서 |
| CRIS (한국) | `https://cris.nih.go.kr` — 공개 검색 결과의 항목 구성 |
| jRCT (일본) | `https://jrct.niph.go.jp` — 공개 상세 페이지의 항목 구성 |
| ISRCTN | `https://www.isrctn.com` — 공개 API 문서 |

각 레지스트리에 대해 기록한다: **공개 API 유무**(REST / 내려받기 / 화면만), **인증 요구 여부**, **필드 목록의 출처 URL**. 확인하지 못한 것은 "확인 못 함"으로 적는다 — 추정으로 채우지 않는다.

- [ ] **Step 2: core 필드 매트릭스를 채운다**

`docs/registry-field-survey-2026-08-22.md` 에 다음 표를 만든다. 행은 스펙 §2.2 의 `TrialRecord` core 필드, 열은 CT.gov + 대조한 레지스트리들.

판정 기호: `O` 동등한 필드가 있음 · `~` 있으나 의미·단위·어휘가 다름(어떻게 다른지 적을 것) · `X` 없음 · `?` 확인 못 함

```markdown
| core 필드 | CT.gov | ICTRP | CTIS | CRIS | 비고 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| title | O | | | | |
| status | O | | | | 어휘가 다르면 매핑 가능한지 |
| phase | O | | | | |
| studyType | O | | | | |
| conditions | O | | | | |
| interventions | O | | | | |
| sponsor.lead | O | | | | |
| enrollment.count | O | | | | 목표치/실제치 구분이 있는가 |
| dates.start | O | | | | 부분 날짜(YYYY-MM)를 쓰는가 |
| dates.lastUpdated | O | | | | |
| locations | O | | | | 좌표가 있는가, 도시까지만인가 |
| hasResults | O | | | | |
| crossIds | O | | | | 상호 등록 ID 를 노출하는가 |
```

`detail` 필드(`eligibility.criteriaText`, `outcomes`, `contacts`)도 같은 표로 별도 정리한다. detail 은 capability 로 신고하면 되므로 `X` 여도 문제가 없다 — 판단 기준이 다르다.

- [ ] **Step 3: 판정한다**

규칙 하나로 자른다.

> **core 필드는 CT.gov 를 포함해 최소 두 레지스트리에서 채워질 수 있어야 한다.** 한 곳에서만 채워지는 필드는 core 가 아니라 detail 이거나, capability 로 신고하는 옵셔널 필드다.

`X` 나 `~` 가 많은 필드에 대해 문서에 결론을 적는다:

- **core 유지** — 다수 레지스트리에 있고 매핑이 가능하다
- **core → optional** — 있는 곳도 있고 없는 곳도 있다. 스키마에서 `.optional()` 이고, 없으면 생략한다 (대부분 여기에 해당할 것이다)
- **core → detail** — CT.gov 에만 있다. `--include` 옵트인으로 내리고 capability 에 신고 항목을 추가한다
- **어휘 확장 필요** — `status` / `phase` 폐쇄 어휘에 값을 더해야 한다. 어떤 값인지 적는다

- [ ] **Step 4: 판정을 스펙에 반영한다**

Step 3 에서 이동이 결정된 필드가 있으면 스펙 §2.2 의 `TrialRecord` 와 §2.3 폐쇄 어휘를 고친다. `Capability.detail` 에 항목이 늘면 §3.2 도 함께 고친다.

**Task 4 는 이 태스크가 확정한 스키마를 구현한다.** 순서를 바꾸지 않는다.

- [ ] **Step 5: 검증**

문서를 열어 확인한다:

- [ ] core 표의 모든 칸이 채워져 있다 (`?` 도 명시적 판정이다 — 빈칸은 안 된다)
- [ ] `?` 로 남은 항목마다 왜 확인하지 못했는지와 무엇을 보면 확인되는지가 적혀 있다
- [ ] Step 3 의 네 결론 중 하나가 모든 core 필드에 붙어 있다
- [ ] 대조한 레지스트리가 최소 세 곳이다
- [ ] 각 레지스트리마다 출처 URL 이 있다

**중단 조건:** core 필드의 절반 이상이 다른 어느 레지스트리에서도 채워지지 않는다면, 정규화 계약이 사실상 CT.gov 스키마라는 뜻이다. 그때는 구현을 멈추고 방안 선택(C vs A)을 다시 논의한다. 이 발견은 실패가 아니라 이 태스크가 존재하는 이유다.

- [ ] **Step 6: 커밋**

```bash
git add docs/registry-field-survey-2026-08-22.md docs/superpowers/specs/
git commit -m "docs: cross-registry field survey validating the normalized contract"
```

---

## Task 1: 프로젝트 스캐폴딩 + 폐쇄 어휘

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `NOTICE`, `README.md`
- Create: `src/core/vocab.ts`
- Test: `tests/core/vocab.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `TRIAL_STATUS`, `TRIAL_PHASE`, `STUDY_TYPE` (readonly 튜플), 타입 `TrialStatus`/`TrialPhase`/`StudyType`, `isFilterableStatus(v: string): v is TrialStatus`, `isFilterablePhase(v: string): v is TrialPhase`

- [ ] **Step 1: 저장소 스캐폴딩**

`package.json`:

```json
{
  "name": "ctreg",
  "version": "0.1.0",
  "description": "Query clinical trial registries through one normalized schema.",
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=22" },
  "bin": { "ctreg": "dist/cli/index.js" },
  "files": ["dist", "LICENSE", "NOTICE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "proper-lockfile": "^4.1.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/proper-lockfile": "^4.1.4",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

`.gitignore`: `node_modules/`, `dist/`, `.cache/`, `*.log`, `.DS_Store`

`LICENSE`: Apache-2.0 전문.

`NOTICE`:

```
ctreg
Copyright 2026 ctreg contributors

This product includes software developed as part of
clinicaltrialsgov-mcp-server (https://github.com/cyanheads/clinicaltrialsgov-mcp-server),
Copyright Casey Hand (cyanheads), licensed under the Apache License, Version 2.0.

Portions of src/adapters/ctgov/ and src/runtime/http.ts are derived from that work.

ClinicalTrials.gov is a registry operated by the U.S. National Library of Medicine.
This project is not affiliated with, endorsed by, or sponsored by the NLM or NIH.
```

`README.md` 는 한 문단 + 다음 문장을 포함한다: **"이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다."**

의존성 설치: `bun install`

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/core/vocab.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  STUDY_TYPE,
  TRIAL_PHASE,
  TRIAL_STATUS,
  isFilterablePhase,
  isFilterableStatus,
} from '../../src/core/vocab.js';

describe('폐쇄 어휘', () => {
  it('status 는 10개 값이고 unknown 과 other 를 모두 포함한다', () => {
    expect(TRIAL_STATUS).toHaveLength(10);
    expect(TRIAL_STATUS).toContain('recruiting');
    expect(TRIAL_STATUS).toContain('unknown');
    expect(TRIAL_STATUS).toContain('other');
  });

  it('phase 는 스펙 §2.3 의 7개 값으로 고정된다 — Task 8 의 PHASE_IN 이 정확히 이 집합을 덮어야 한다', () => {
    expect(TRIAL_PHASE).toEqual([
      'early_phase_1', 'phase_1', 'phase_2', 'phase_3', 'phase_4', 'na', 'other',
    ]);
    // 결합 값을 어휘에 두지 않는 것은 설계 결정이다 — 배열로 무손실 보존한다.
    expect(TRIAL_PHASE).not.toContain('phase_1_2');
  });

  it('studyType 은 4개 값이다', () => {
    expect(STUDY_TYPE).toEqual(['interventional', 'observational', 'expanded_access', 'other']);
  });

  it('unknown 과 other 는 필터 입력으로 받지 않는다', () => {
    expect(isFilterableStatus('recruiting')).toBe(true);
    expect(isFilterableStatus('unknown')).toBe(false);
    expect(isFilterableStatus('other')).toBe(false);
    expect(isFilterableStatus('nonsense')).toBe(false);
  });

  it('phase 도 other 를 필터 입력으로 받지 않는다', () => {
    expect(isFilterablePhase('phase_3')).toBe(true);
    expect(isFilterablePhase('other')).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/core/vocab.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/vocab.js'`

- [ ] **Step 4: 최소 구현**

`src/core/vocab.ts`:

```ts
/** 레지스트리 간 공통 폐쇄 어휘. `unknown`(레지스트리가 모른다) 과 `other`(매핑 없음) 는 다르다. */

export const TRIAL_STATUS = [
  'recruiting',
  'not_yet_recruiting',
  'enrolling_by_invitation',
  'active_not_recruiting',
  'suspended',
  'terminated',
  'completed',
  'withdrawn',
  'unknown',
  'other',
] as const;
export type TrialStatus = (typeof TRIAL_STATUS)[number];

export const TRIAL_PHASE = [
  'early_phase_1',
  'phase_1',
  'phase_2',
  'phase_3',
  'phase_4',
  'na',
  'other',
] as const;
export type TrialPhase = (typeof TRIAL_PHASE)[number];

export const STUDY_TYPE = ['interventional', 'observational', 'expanded_access', 'other'] as const;
export type StudyType = (typeof STUDY_TYPE)[number];

/** 사용자가 `--status` 로 넣을 수 있는 값. `unknown`/`other` 로 거르는 것은 의미가 없다. */
const NOT_FILTERABLE = new Set<string>(['unknown', 'other']);

export function isFilterableStatus(v: string): v is TrialStatus {
  return !NOT_FILTERABLE.has(v) && (TRIAL_STATUS as readonly string[]).includes(v);
}

export function isFilterablePhase(v: string): v is TrialPhase {
  return !NOT_FILTERABLE.has(v) && (TRIAL_PHASE as readonly string[]).includes(v);
}
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/core/vocab.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: 커밋**

```bash
git init
git add -A
git commit -m "chore: scaffold ctreg + closed vocabularies"
```

---

## Task 2: Exit code 와 에러 taxonomy

**Files:**
- Create: `src/cli/exit-codes.ts`, `src/runtime/errors.ts`
- Test: `tests/runtime/errors.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `EXIT` 상수 객체, 타입 `ExitCode`, `CtregError` 클래스(`.code`, `.exit`, `.hint`), 팩토리 `usageError(message, hint?)` · `unsupportedError(message, hint?)` · `upstreamError(message, hint?, cause?)` · `rateLimitedError(message, hint?)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/runtime/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import {
  CtregError,
  rateLimitedError,
  unsupportedError,
  upstreamError,
  usageError,
} from '../../src/runtime/errors.js';

describe('에러 taxonomy', () => {
  it('exit code 는 스펙에 고정된 숫자다', () => {
    expect(EXIT).toEqual({ OK: 0, USAGE: 2, UNSUPPORTED: 3, UPSTREAM: 4, PARTIAL: 5 });
  });

  it('usageError 는 exit 2 를 실어 나른다', () => {
    const e = usageError('bad flag', '--near 는 좌표를 요구한다');
    expect(e).toBeInstanceOf(Error);
    expect(e.exit).toBe(EXIT.USAGE);
    expect(e.code).toBe('usage');
    expect(e.hint).toBe('--near 는 좌표를 요구한다');
  });

  it('미지원 capability 는 exit 3 이다 — 빈 결과가 아니다', () => {
    expect(unsupportedError('geo unsupported').exit).toBe(EXIT.UNSUPPORTED);
  });

  it('업스트림 실패와 요청률 초과는 모두 exit 4 이지만 code 로 구분된다', () => {
    expect(upstreamError('502').exit).toBe(EXIT.UPSTREAM);
    expect(upstreamError('502').code).toBe('upstream');
    expect(rateLimitedError('429 exhausted').exit).toBe(EXIT.UPSTREAM);
    expect(rateLimitedError('429 exhausted').code).toBe('rate_limited');
  });

  it('cause 를 보존한다', () => {
    const root = new Error('socket hang up');
    expect(upstreamError('failed', undefined, root).cause).toBe(root);
  });

  it('CtregError 가 아닌 에러도 판별할 수 있다', () => {
    expect(CtregError.is(usageError('x'))).toBe(true);
    expect(CtregError.is(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/runtime/errors.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/cli/exit-codes.ts`:

```ts
/** 플러그인 스킬이 분기할 계약. 값을 바꾸면 downstream 이 깨진다. */
export const EXIT = {
  OK: 0,
  USAGE: 2,
  UNSUPPORTED: 3,
  UPSTREAM: 4,
  PARTIAL: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
```

`src/runtime/errors.ts`:

```ts
import { EXIT, type ExitCode } from '../cli/exit-codes.js';

/**
 * 참조 구현이 `@cyanheads/mcp-ts-core/errors` 의 팩토리로 하던 일을 로컬에서 한다.
 * `hint` 는 업스트림 400 응답을 회복 가능한 문장으로 번역한 것이다.
 */
export class CtregError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly exit: ExitCode,
    readonly hint?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CtregError';
  }

  static is(e: unknown): e is CtregError {
    return e instanceof CtregError;
  }
}

export const usageError = (message: string, hint?: string) =>
  new CtregError(message, 'usage', EXIT.USAGE, hint);

export const unsupportedError = (message: string, hint?: string) =>
  new CtregError(message, 'unsupported', EXIT.UNSUPPORTED, hint);

export const upstreamError = (message: string, hint?: string, cause?: unknown) =>
  new CtregError(message, 'upstream', EXIT.UPSTREAM, hint, { cause });

export const rateLimitedError = (message: string, hint?: string) =>
  new CtregError(message, 'rate_limited', EXIT.UPSTREAM, hint);
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/runtime/errors.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: 커밋**

```bash
git add src/cli/exit-codes.ts src/runtime/errors.ts tests/runtime/errors.test.ts
git commit -m "feat: exit codes and error taxonomy"
```

---

## Task 3: 레지스트리 키와 ID 정규화

**Files:**
- Create: `src/core/registry.ts`
- Test: `tests/core/registry.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `usageError`
- Produces: 타입 `RegistryKey`(`'ctgov'`), `REGISTRY_KEYS: readonly RegistryKey[]`, `isRegistryKey(v: string): v is RegistryKey`, `parseTrialId(input: string): { registry: RegistryKey; registryId: string; id: string }`, `formatTrialId(registry: RegistryKey, registryId: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REGISTRY_KEYS, formatTrialId, isRegistryKey, parseTrialId } from '../../src/core/registry.js';
import { CtregError } from '../../src/runtime/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';

describe('ID 정규화', () => {
  it('슬라이스 1 의 레지스트리는 ctgov 하나다', () => {
    expect(REGISTRY_KEYS).toEqual(['ctgov']);
    expect(isRegistryKey('ctgov')).toBe(true);
    expect(isRegistryKey('ictrp')).toBe(false);
  });

  it('접두사가 붙은 정규형을 파싱한다', () => {
    expect(parseTrialId('CTGOV:NCT01234567')).toEqual({
      registry: 'ctgov',
      registryId: 'NCT01234567',
      id: 'CTGOV:NCT01234567',
    });
  });

  it('접두사가 없으면 패턴으로 레지스트리를 추론한다', () => {
    expect(parseTrialId('NCT01234567').registry).toBe('ctgov');
    expect(parseTrialId('NCT01234567').id).toBe('CTGOV:NCT01234567');
  });

  it('접두사와 원문 ID 의 대소문자를 정규화한다', () => {
    expect(parseTrialId('ctgov:nct01234567').id).toBe('CTGOV:NCT01234567');
  });

  it('접두사 없는 소문자 ID 도 추론한다 — 추론 정규식의 /i 를 고정한다', () => {
    expect(parseTrialId('nct01234567').id).toBe('CTGOV:NCT01234567');
  });

  it('아직 없는 레지스트리 접두사는 exit 3 이다 — 문법은 맞고 지원이 없는 것', () => {
    try {
      parseTrialId('ISRCTN:12345678');
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect(CtregError.is(e)).toBe(true);
      expect((e as CtregError).exit).toBe(EXIT.UNSUPPORTED);
    }
  });

  it('추론 불가능한 문자열은 exit 2 다', () => {
    try {
      parseTrialId('garbage');
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).hint).toContain('CTGOV:');
    }
  });

  it('formatTrialId 는 parseTrialId 의 역이다', () => {
    expect(formatTrialId('ctgov', 'NCT01234567')).toBe('CTGOV:NCT01234567');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/core/registry.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/core/registry.ts`:

```ts
import { unsupportedError, usageError } from '../runtime/errors.js';

export const REGISTRY_KEYS = ['ctgov'] as const;
export type RegistryKey = (typeof REGISTRY_KEYS)[number];

export function isRegistryKey(v: string): v is RegistryKey {
  return (REGISTRY_KEYS as readonly string[]).includes(v);
}

export function formatTrialId(registry: RegistryKey, registryId: string): string {
  return `${registry.toUpperCase()}:${registryId}`;
}

type IdSpec = { pattern: RegExp; normalize: (s: string) => string };

/**
 * 레지스트리별 접두사 없는 원문 ID 패턴. `Record<RegistryKey, ...>` 이므로
 * `REGISTRY_KEYS` 에 키를 추가하고 여기 항목을 빠뜨리면 컴파일이 깨진다 —
 * 어댑터를 늘릴 때는 두 곳을 다 채워야 하고, 컴파일러가 그것을 강제한다.
 * (배열로 두면 두 표가 조용히 어긋나고, 접두사 경로와 추론 경로가 그 어긋남에
 *  서로 다르게 반응한다. 두 번째 레지스트리를 붙이는 날 정확히 그 자리가 깨진다.)
 */
const ID_PATTERNS: Record<RegistryKey, IdSpec> = {
  ctgov: { pattern: /^nct\d{8}$/i, normalize: (s) => s.toUpperCase() },
};

export function parseTrialId(input: string): {
  registry: RegistryKey;
  registryId: string;
  id: string;
} {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(':');

  if (colon > 0) {
    const prefix = trimmed.slice(0, colon).toLowerCase();
    const rest = trimmed.slice(colon + 1);
    if (!isRegistryKey(prefix)) {
      throw unsupportedError(
        `레지스트리 '${prefix}' 어댑터가 없습니다`,
        `ctreg registries 로 사용 가능한 레지스트리를 확인하세요. 현재: ${REGISTRY_KEYS.join(', ')}`,
      );
    }
    const registryId = ID_PATTERNS[prefix].normalize(rest);
    return { registry: prefix, registryId, id: formatTrialId(prefix, registryId) };
  }

  const inferred = REGISTRY_KEYS.find((key) => ID_PATTERNS[key].pattern.test(trimmed));
  if (!inferred) {
    throw usageError(
      `'${input}' 에서 레지스트리를 알아낼 수 없습니다`,
      'CTGOV:NCT01234567 처럼 접두사를 붙이거나, 접두사 없는 NCT 번호를 주세요.',
    );
  }
  const registryId = ID_PATTERNS[inferred].normalize(trimmed);
  return { registry: inferred, registryId, id: formatTrialId(inferred, registryId) };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/core/registry.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: 커밋**

```bash
git add src/core/registry.ts tests/core/registry.test.ts
git commit -m "feat: registry keys and trial id normalization"
```

---

## Task 4: 계약 스키마 — TrialRecord · Capability · Query

**Files:**
- Create: `src/core/record.ts`, `src/core/capability.ts`, `src/core/query.ts`
- Test: `tests/core/record.test.ts`, `tests/core/capability.test.ts`

**Interfaces:**
- Consumes: Task 1 의 어휘, Task 3 의 `RegistryKey`
- Produces:
  - `record.ts`: `TrialLocationSchema`, `TrialRecordSchema`, `TrialResultsSchema` 와 추론 타입 `TrialLocation` · `TrialRecord` · `TrialResults` · `OutcomeResult` · `AdverseEvent`
  - `capability.ts`: `CapabilitySchema`, 타입 `Capability` · `Warning` · `AdapterResult<T>` · `RegistryAdapter`
  - `query.ts`: 타입 `NormalizedQuery` · `FetchOpts` · `ResultsOpts` · `IncludeSection`, 상수 `CAPS`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/record.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TrialRecordSchema } from '../../src/core/record.js';

const minimal = {
  id: 'CTGOV:NCT01234567',
  registry: 'ctgov',
  registryId: 'NCT01234567',
  url: 'https://clinicaltrials.gov/study/NCT01234567',
  title: 'A Study of Something',
  status: 'recruiting',
  conditions: ['Non-Small Cell Lung Cancer'],
  fetchedAt: '2026-08-22T00:00:00.000Z',
};

describe('TrialRecord 계약', () => {
  it('core 필수 필드만으로 유효하다', () => {
    expect(TrialRecordSchema.parse(minimal).id).toBe('CTGOV:NCT01234567');
  });

  it('폐쇄 어휘 밖의 status 는 거부한다', () => {
    expect(() => TrialRecordSchema.parse({ ...minimal, status: 'RECRUITING' })).toThrow();
  });

  it('phase 는 배열이며 결합 값을 쓰지 않는다', () => {
    const r = TrialRecordSchema.parse({ ...minimal, phase: ['phase_1', 'phase_2'] });
    expect(r.phase).toEqual(['phase_1', 'phase_2']);
  });

  it('null 로 채운 필드는 거부한다 — 없으면 생략해야 한다', () => {
    expect(() => TrialRecordSchema.parse({ ...minimal, officialTitle: null })).toThrow();
  });

  it('locationsTotal 은 캡 적용 이전 총 개수를 담는다', () => {
    const r = TrialRecordSchema.parse({
      ...minimal,
      locations: [{ city: 'Seoul', country: 'Korea, Republic of' }],
      locationsTotal: 42,
    });
    expect(r.locationsTotal).toBe(42);
    expect(r.locations).toHaveLength(1);
  });

  it('eligibility 절단은 플래그로 드러난다', () => {
    const r = TrialRecordSchema.parse({
      ...minimal,
      eligibility: { criteriaText: 'Inclusion...', criteriaTruncated: true },
    });
    expect(r.eligibility?.criteriaTruncated).toBe(true);
  });
});
```

`tests/core/capability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CapabilitySchema } from '../../src/core/capability.js';

const cap = {
  key: 'ctgov',
  name: 'ClinicalTrials.gov',
  region: 'US / global',
  search: {
    condition: true, intervention: true, term: true, title: true,
    sponsor: true, lead: true, location: true, id: true, patient: true,
    geo: true, geoNeedsCoords: true,
    status: true, phase: true, studyType: true, dateRange: true,
  },
  detail: { eligibilityText: true, outcomes: true, contacts: true },
  results: true,
  count: true,
  limits: { maxPageSize: 200, ratePerSec: 1, maxBatchIds: 50 },
};

describe('Capability 계약', () => {
  it('완전한 선언을 받는다', () => {
    expect(CapabilitySchema.parse(cap).key).toBe('ctgov');
  });

  it('search 축을 하나라도 빠뜨리면 거부한다 — 미신고는 곧 미지원 판단 불가', () => {
    const { geo: _drop, ...rest } = cap.search;
    expect(() => CapabilitySchema.parse({ ...cap, search: rest })).toThrow();
  });

  it('등록되지 않은 레지스트리 키는 거부한다', () => {
    expect(() => CapabilitySchema.parse({ ...cap, key: 'ictrp' })).toThrow();
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/core/`
Expected: FAIL — `record.js` / `capability.js` 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/core/record.ts`:

```ts
import { z } from 'zod';
import { REGISTRY_KEYS } from './registry.js';
import { STUDY_TYPE, TRIAL_PHASE, TRIAL_STATUS } from './vocab.js';

const RegistryKeySchema = z.enum(REGISTRY_KEYS);
const StatusSchema = z.enum(TRIAL_STATUS);

export const TrialLocationSchema = z.object({
  facility: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  status: StatusSchema.optional(),
  statusRaw: z.string().optional(),
  geo: z.object({ lat: z.number(), lon: z.number() }).optional(),
  distanceKm: z.number().optional(),
});
export type TrialLocation = z.infer<typeof TrialLocationSchema>;

export const TrialRecordSchema = z.object({
  // 신원
  id: z.string(),
  registry: RegistryKeySchema,
  registryId: z.string(),
  crossIds: z.array(z.object({ registry: z.string(), id: z.string() })).optional(),
  url: z.string(),

  // core
  title: z.string(),
  officialTitle: z.string().optional(),
  status: StatusSchema,
  statusRaw: z.string().optional(),
  phase: z.array(z.enum(TRIAL_PHASE)).optional(),
  phaseRaw: z.array(z.string()).optional(),
  studyType: z.enum(STUDY_TYPE).optional(),
  studyTypeRaw: z.string().optional(),
  conditions: z.array(z.string()),
  interventions: z.array(z.object({ type: z.string().optional(), name: z.string() })).optional(),
  sponsor: z
    .object({ lead: z.string().optional(), collaborators: z.array(z.string()).optional() })
    .optional(),
  enrollment: z
    .object({
      count: z.number().optional(),
      basis: z.enum(['actual', 'estimated', 'unknown']).optional(),
    })
    .optional(),
  dates: z
    .object({
      start: z.string().optional(),
      primaryCompletion: z.string().optional(),
      completion: z.string().optional(),
      firstPosted: z.string().optional(),
      lastUpdated: z.string().optional(),
    })
    .optional(),
  locations: z.array(TrialLocationSchema).optional(),
  locationsTotal: z.number().optional(),
  hasResults: z.boolean().optional(),

  // detail (--include)
  eligibility: z
    .object({
      minAge: z.string().optional(),
      maxAge: z.string().optional(),
      sex: z.enum(['all', 'female', 'male', 'unknown']).optional(),
      healthyVolunteers: z.boolean().optional(),
      criteriaText: z.string().optional(),
      criteriaTruncated: z.boolean().optional(),
    })
    .optional(),
  outcomes: z
    .array(
      z.object({
        type: z.enum(['primary', 'secondary', 'other']),
        measure: z.string(),
        timeFrame: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      }),
    )
    .optional(),

  // 출처
  fetchedAt: z.string(),
  source: z.unknown().optional(),
});
export type TrialRecord = z.infer<typeof TrialRecordSchema>;

export const OutcomeResultSchema = z.object({
  type: z.enum(['primary', 'secondary', 'other']),
  measure: z.string(),
  timeFrame: z.string().optional(),
  description: z.string().optional(),
  groups: z.array(z.object({ title: z.string(), value: z.string().optional() })).optional(),
});
export type OutcomeResult = z.infer<typeof OutcomeResultSchema>;

export const AdverseEventSchema = z.object({
  organ: z.string().optional(),
  term: z.string(),
  serious: z.boolean().optional(),
  affected: z.number().optional(),
  atRisk: z.number().optional(),
});
export type AdverseEvent = z.infer<typeof AdverseEventSchema>;

export const TrialResultsSchema = z.object({
  id: z.string(),
  registry: RegistryKeySchema,
  hasResults: z.boolean(),
  sections: z.object({
    outcomes: z
      .object({ total: z.number(), expanded: z.number(), items: z.array(OutcomeResultSchema) })
      .optional(),
    adverse: z
      .object({
        total: z.number(),
        expanded: z.number(),
        byOrgan: z.array(
          z.object({ organ: z.string(), events: z.number(), expanded: z.boolean() }),
        ),
        items: z.array(AdverseEventSchema),
      })
      .optional(),
    // flow / baseline 은 레지스트리마다 구조가 달라 정규화하지 않고 원문을 통과시킨다.
    flow: z.object({ total: z.number(), items: z.array(z.unknown()) }).optional(),
    baseline: z.object({ total: z.number(), items: z.array(z.unknown()) }).optional(),
  }),
  fetchedAt: z.string(),
});
export type TrialResults = z.infer<typeof TrialResultsSchema>;
```

`src/core/capability.ts`:

```ts
import { z } from 'zod';
import type { NormalizedQuery, FetchOpts, ResultsOpts } from './query.js';
import type { TrialRecord, TrialResults } from './record.js';
import { REGISTRY_KEYS, type RegistryKey } from './registry.js';

export const CapabilitySchema = z.object({
  key: z.enum(REGISTRY_KEYS),
  name: z.string(),
  region: z.string(),
  /** 모든 축을 명시적으로 신고한다. 빠뜨리면 "미지원"인지 "선언 누락"인지 알 수 없다. */
  search: z.object({
    condition: z.boolean(),
    intervention: z.boolean(),
    term: z.boolean(),
    title: z.boolean(),
    sponsor: z.boolean(),
    lead: z.boolean(),
    location: z.boolean(),
    id: z.boolean(),
    patient: z.boolean(),
    geo: z.boolean(),
    geoNeedsCoords: z.boolean(),
    status: z.boolean(),
    phase: z.boolean(),
    studyType: z.boolean(),
    dateRange: z.boolean(),
  }),
  detail: z.object({
    eligibilityText: z.boolean(),
    outcomes: z.boolean(),
    contacts: z.boolean(),
  }),
  results: z.boolean(),
  count: z.boolean(),
  limits: z.object({
    maxPageSize: z.number(),
    ratePerSec: z.number(),
    maxBatchIds: z.number(),
  }),
});
export type Capability = z.infer<typeof CapabilitySchema>;

/** 비치명적 사실. 치명적 실패는 CtregError 로 던진다. */
export type Warning = { code: string; message: string; id?: string; at?: number };
export type AdapterResult<T> = { data: T; warnings: Warning[] };

export interface RegistryAdapter {
  readonly key: RegistryKey;
  capability(): Capability;
  search(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<TrialRecord[]> & { total?: number }>;
  get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>>;
  results(id: string, o: ResultsOpts): Promise<AdapterResult<TrialResults>>;
  count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>>;
}
```

`src/core/query.ts`:

```ts
import type { StudyType, TrialPhase, TrialStatus } from './vocab.js';

export type IncludeSection = 'core' | 'eligibility' | 'outcomes' | 'contacts' | 'locations' | 'all';

/** 레지스트리 중립 검색 요청. 어댑터가 자기 문법으로 번역한다. */
export type NormalizedQuery = {
  condition?: string;
  intervention?: string;
  term?: string;
  title?: string;
  location?: string;
  outcomeQuery?: string;
  sponsor?: string;
  lead?: string;
  id?: string;
  patient?: string;

  status?: TrialStatus[];
  phase?: TrialPhase[];
  studyType?: StudyType;

  near?: { lat: number; lon: number };
  radius?: { value: number; unit: 'km' | 'mi' };

  updatedSince?: string;
  updatedBefore?: string;
  startAfter?: string;
  startBefore?: string;
  completionAfter?: string;
  completionBefore?: string;

  page?: number;
  pageSize?: number;
  sort?: string;
};

export type FetchOpts = {
  include: IncludeSection[];
  caps: { locations: number; eligibilityChars: number; outcomes: number };
  cacheMode: 'use' | 'refresh' | 'off';
  raw: boolean;
  signal?: AbortSignal;
};

export type ResultsOpts = {
  sections: ('outcomes' | 'adverse' | 'flow' | 'baseline')[];
  outcomeFilter?: string[];
  aeOrganFilter?: string;
  aeTermFilter?: string;
  full: boolean;
  cacheMode: 'use' | 'refresh' | 'off';
};

/** 스펙 §5.2 의 캡. 기본값과 상한. */
export const CAPS = {
  pageSize: { default: 20, max: 200 },
  locations: { default: 10, max: 200 },
  eligibilityChars: { default: 8000, max: 40000 },
  outcomes: { default: 20, max: 200 },
} as const;
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/core/`
Expected: PASS — vocab 5 + registry 7 + record 6 + capability 3 = 21 tests

- [ ] **Step 5: 커밋**

```bash
git add src/core tests/core
git commit -m "feat: TrialRecord, Capability, and query contracts"
```

---

## Task 5: 온디스크 토큰버킷

참조 구현의 스로틀은 `throttleQueue: Promise<void>` 프로미스 체인이라 프로세스와 함께 죽는다. 에이전트가 `ctreg get` 을 병렬로 실행하면 요청률 제한이 전혀 작동하지 않는다. 단명 프로세스가 공유 상태를 갖는 유일한 방법은 디스크다.

**Files:**
- Create: `src/runtime/throttle.ts`
- Test: `tests/runtime/throttle.test.ts`

**Interfaces:**
- Consumes: 없음 (`proper-lockfile` 만)
- Produces: 타입 `ThrottleOpts` = `{ dir: string; registry: string; ratePerSec: number; lockTimeoutMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }`, `reserveSlot(o: ThrottleOpts): Promise<{ waitedMs: number; lockTimedOut: boolean }>`, `shareBackoff(o: ThrottleOpts, untilEpochMs: number): Promise<void>`, `bucketPath(dir: string, registry: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/runtime/throttle.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { beforeEach, describe, expect, it } from 'vitest';
import { bucketPath, reserveSlot, shareBackoff } from '../../src/runtime/throttle.js';

/** sleep 이 시계를 앞으로 감는 가짜 시계 — 실시간 대기 없이 결정적으로 검증한다. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, set: (v: number) => { t = v; } };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctreg-throttle-')); });

describe('온디스크 토큰버킷', () => {
  it('첫 호출은 대기하지 않는다', async () => {
    const c = fakeClock();
    const r = await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(r.waitedMs).toBe(0);
    expect(r.lockTimedOut).toBe(false);
  });

  it('연속 호출은 요청률 간격만큼 누적 대기한다', async () => {
    const c = fakeClock();
    const o = { dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep };
    expect((await reserveSlot(o)).waitedMs).toBe(0);
    expect((await reserveSlot(o)).waitedMs).toBe(1000);
    expect((await reserveSlot(o)).waitedMs).toBe(1000);
  });

  it('상태가 디스크에 남아 다음 프로세스가 이어받는다', async () => {
    const c = fakeClock();
    await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    const state = JSON.parse(readFileSync(bucketPath(dir, 'ctgov'), 'utf8'));
    expect(state.nextAvailableAt).toBe(1_000_000 + 1000);
  });

  it('공유된 백오프가 미래면 그때까지 기다린다 — 한 프로세스의 429 를 나머지가 안다', async () => {
    const c = fakeClock();
    writeFileSync(
      bucketPath(dir, 'ctgov'),
      JSON.stringify({ nextAvailableAt: 0, blockedUntil: 1_005_000 }),
    );
    const r = await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(r.waitedMs).toBe(5000);
  });

  it('shareBackoff 는 blockedUntil 을 앞당기지 않고 늦추기만 한다', async () => {
    const o = { dir, registry: 'ctgov', ratePerSec: 1 };
    await shareBackoff(o, 2_000_000);
    await shareBackoff(o, 1_500_000);
    const state = JSON.parse(readFileSync(bucketPath(dir, 'ctgov'), 'utf8'));
    expect(state.blockedUntil).toBe(2_000_000);
  });

  it('레지스트리마다 버킷 파일이 분리된다', async () => {
    const c = fakeClock();
    await reserveSlot({ dir, registry: 'ctgov', ratePerSec: 1, now: c.now, sleep: c.sleep });
    const other = await reserveSlot({ dir, registry: 'ictrp', ratePerSec: 1, now: c.now, sleep: c.sleep });
    expect(other.waitedMs).toBe(0);
    expect(bucketPath(dir, 'ctgov')).not.toBe(bucketPath(dir, 'ictrp'));
  });

  it('락을 잡지 못하면 fail-open 하지 않고 최소 간격만큼 대기한다', async () => {
    const c = fakeClock();
    const path = bucketPath(dir, 'ctgov');
    writeFileSync(path, JSON.stringify({ nextAvailableAt: 0 }));
    const release = await lockfile.lock(path, { realpath: false });
    try {
      const r = await reserveSlot({
        dir, registry: 'ctgov', ratePerSec: 1, lockTimeoutMs: 50, now: c.now, sleep: c.sleep,
      });
      expect(r.lockTimedOut).toBe(true);
      expect(r.waitedMs).toBe(1000);
    } finally {
      await release();
    }
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/runtime/throttle.test.ts`
Expected: FAIL — `src/runtime/throttle.js` 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/runtime/throttle.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

export type ThrottleOpts = {
  dir: string;
  registry: string;
  ratePerSec: number;
  lockTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type BucketState = { nextAvailableAt: number; blockedUntil?: number };

export function bucketPath(dir: string, registry: string): string {
  return join(dir, `bucket-${registry}.json`);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ensureBucket(path: string, dir: string): BucketState {
  mkdirSync(dir, { recursive: true });
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BucketState;
  } catch {
    // 없거나 손상됨 — 보수적으로 빈 상태에서 시작한다.
    const fresh: BucketState = { nextAvailableAt: 0 };
    writeFileSync(path, JSON.stringify(fresh));
    return fresh;
  }
}

/**
 * 다음 요청 슬롯을 예약한다. 락은 상태를 갱신하는 동안에만 잡고,
 * 실제 대기는 락을 놓은 뒤에 한다 — 그래야 다른 프로세스가 뒤 슬롯을 즉시 예약한다.
 */
export async function reserveSlot(
  o: ThrottleOpts,
): Promise<{ waitedMs: number; lockTimedOut: boolean }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const intervalMs = Math.ceil(1000 / o.ratePerSec);
  const path = bucketPath(o.dir, o.registry);
  ensureBucket(path, o.dir);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(path, {
      realpath: false,
      stale: 10_000,
      retries: { retries: 10, minTimeout: 20, maxTimeout: o.lockTimeoutMs ?? 500 },
    });
  } catch {
    // fail-open 금지. 단독 진행하되 최소 간격만큼은 반드시 기다린다.
    await sleep(intervalMs);
    return { waitedMs: intervalMs, lockTimedOut: true };
  }

  let target: number;
  const start = now();
  try {
    const state = ensureBucket(path, o.dir);
    target = Math.max(start, state.nextAvailableAt, state.blockedUntil ?? 0);
    writeFileSync(path, JSON.stringify({ ...state, nextAvailableAt: target + intervalMs }));
  } finally {
    await release();
  }

  const waitedMs = Math.max(0, target - start);
  if (waitedMs > 0) await sleep(waitedMs);
  return { waitedMs, lockTimedOut: false };
}

/** 429 를 받은 프로세스가 나머지 프로세스에게 대기를 알린다. 늦추기만 하고 앞당기지 않는다. */
export async function shareBackoff(o: ThrottleOpts, untilEpochMs: number): Promise<void> {
  const path = bucketPath(o.dir, o.registry);
  ensureBucket(path, o.dir);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(path, { realpath: false, stale: 10_000, retries: 5 });
  } catch {
    return; // 알리지 못해도 본인의 백오프는 유효하다.
  }
  try {
    const state = ensureBucket(path, o.dir);
    const blockedUntil = Math.max(state.blockedUntil ?? 0, untilEpochMs);
    writeFileSync(path, JSON.stringify({ ...state, blockedUntil }));
  } finally {
    await release();
  }
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/runtime/throttle.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: 커밋**

```bash
git add src/runtime/throttle.ts tests/runtime/throttle.test.ts
git commit -m "feat: cross-process on-disk token bucket with shared backoff"
```

---

## Task 6: 온디스크 응답 캐시

**Files:**
- Create: `src/runtime/cache.ts`
- Test: `tests/runtime/cache.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `cacheKey(registry: string, endpoint: string, params: Record<string, unknown>): string`, 타입 `CacheEntry<T>` = `{ value: T; fetchedAt: string }`, `readCache<T>(dir: string, key: string, ttlSec: number, now?: () => number): Promise<CacheEntry<T> | undefined>`, `writeCache(dir: string, key: string, value: unknown, fetchedAt: string, now?: () => number): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/runtime/cache.test.ts`:

```ts
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheKey, readCache, writeCache } from '../../src/runtime/cache.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctreg-cache-')); });

describe('응답 캐시', () => {
  it('키는 파라미터 순서에 안정적이다', () => {
    const a = cacheKey('ctgov', '/studies', { pageSize: 20, 'query.cond': 'NSCLC' });
    const b = cacheKey('ctgov', '/studies', { 'query.cond': 'NSCLC', pageSize: 20 });
    expect(a).toBe(b);
  });

  it('undefined 파라미터는 키에 영향을 주지 않는다', () => {
    const a = cacheKey('ctgov', '/studies', { 'query.cond': 'NSCLC' });
    const b = cacheKey('ctgov', '/studies', { 'query.cond': 'NSCLC', 'query.lead': undefined });
    expect(a).toBe(b);
  });

  it('레지스트리가 다르면 키가 다르다', () => {
    expect(cacheKey('ctgov', '/studies', {})).not.toBe(cacheKey('ictrp', '/studies', {}));
  });

  it('TTL 안에서는 읽히고 지나면 undefined 다', async () => {
    let t = 1_000_000;
    const now = () => t;
    await writeCache(dir, 'k1', { hello: 'world' }, '2026-08-22T00:00:00.000Z', now);
    expect((await readCache<{ hello: string }>(dir, 'k1', 60, now))?.value).toEqual({ hello: 'world' });
    t += 61_000;
    expect(await readCache(dir, 'k1', 60, now)).toBeUndefined();
  });

  it('fetchedAt 은 원 응답 시각을 그대로 돌려준다 — 캐시 저장 시각이 아니다', async () => {
    const now = () => 1_000_000;
    await writeCache(dir, 'k2', { a: 1 }, '2026-08-01T12:34:56.000Z', now);
    expect((await readCache(dir, 'k2', 3600, now))?.fetchedAt).toBe('2026-08-01T12:34:56.000Z');
  });

  it('손상된 캐시 파일은 예외 대신 캐시 미스로 처리한다', async () => {
    const now = () => 1_000_000;
    await writeCache(dir, 'k3', { a: 1 }, '2026-08-22T00:00:00.000Z', now);
    const file = readdirSync(dir).find((f) => f.includes('k3')) ?? readdirSync(dir)[0]!;
    writeFileSync(join(dir, file), '{ not json');
    expect(await readCache(dir, 'k3', 3600, now)).toBeUndefined();
  });

  it('없는 키는 undefined 다', async () => {
    expect(await readCache(dir, 'missing', 3600)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/runtime/cache.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/runtime/cache.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CacheEntry<T> = { value: T; fetchedAt: string };
type StoredEntry<T> = CacheEntry<T> & { storedAt: number };

/** 키는 파라미터 순서와 undefined 에 안정적이어야 한다 — 아니면 캐시가 사실상 동작하지 않는다. */
export function cacheKey(
  registry: string,
  endpoint: string,
  params: Record<string, unknown>,
): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return createHash('sha256').update(`${registry}|${endpoint}|${normalized}`).digest('hex');
}

const entryPath = (dir: string, key: string) => join(dir, `resp-${key}.json`);

export async function readCache<T>(
  dir: string,
  key: string,
  ttlSec: number,
  now: () => number = Date.now,
): Promise<CacheEntry<T> | undefined> {
  try {
    const raw = await readFile(entryPath(dir, key), 'utf8');
    const entry = JSON.parse(raw) as StoredEntry<T>;
    if (now() - entry.storedAt > ttlSec * 1000) return undefined;
    return { value: entry.value, fetchedAt: entry.fetchedAt };
  } catch {
    return undefined; // 없거나 손상됨 — 미스로 처리한다.
  }
}

export async function writeCache(
  dir: string,
  key: string,
  value: unknown,
  fetchedAt: string,
  now: () => number = Date.now,
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const target = entryPath(dir, key);
  const tmp = `${target}.${process.pid}.tmp`;
  const entry: StoredEntry<unknown> = { value, fetchedAt, storedAt: now() };
  // 원자적 교체 — 동시에 읽는 프로세스가 반쯤 쓰인 파일을 보지 않게 한다.
  await writeFile(tmp, JSON.stringify(entry));
  await rename(tmp, target);
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/runtime/cache.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: 커밋**

```bash
git add src/runtime/cache.ts tests/runtime/cache.test.ts
git commit -m "feat: on-disk response cache preserving original fetchedAt"
```

---

## Task 7: 설정 + HTTP 클라이언트

재시도·백오프 로직은 참조 구현 `clinicaltrialsgov-mcp-server/src/services/clinical-trials/clinical-trials-service.ts` 에서 가져온다 (`RETRYABLE_STATUS`, 지수 백오프 + 지터, 재시도 3회). 스로틀만 Task 5 의 온디스크 버킷으로 교체한다. **이 파일 상단에 유래 주석과 Apache-2.0 고지를 남긴다.**

**Files:**
- Create: `src/runtime/config.ts`, `src/runtime/http.ts`
- Test: `tests/runtime/config.test.ts`, `tests/runtime/http.test.ts`

**Interfaces:**
- Consumes: Task 2 `CtregError`/`rateLimitedError`/`upstreamError`/`usageError`, Task 4 `Warning`, Task 5 `reserveSlot`/`shareBackoff`, Task 6 `cacheKey`/`readCache`/`writeCache`
- Produces:
  - `config.ts`: 타입 `Config` = `{ cacheDir: string; cacheTtlSec: number; timeoutMs: number; maxRetries: number; ratePerSec: number; ctgovBaseUrl: string }`, `loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `http.ts`: 타입 `HttpDeps` = `{ fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }`, `getJson<T>(cfg: Config, o: { registry: string; baseUrl: string; path: string; params: Record<string, string | number | undefined>; cacheMode: 'use' | 'refresh' | 'off'; signal?: AbortSignal }, deps?: HttpDeps): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }>`

- [ ] **Step 1: 실패하는 설정 테스트 작성**

`tests/runtime/config.test.ts`:

```ts
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/runtime/config.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { CtregError } from '../../src/runtime/errors.js';

describe('설정', () => {
  it('환경변수가 없으면 스펙의 기본값을 쓴다', () => {
    const c = loadConfig({});
    expect(c.cacheTtlSec).toBe(3600);
    expect(c.timeoutMs).toBe(30000);
    expect(c.maxRetries).toBe(3);
    expect(c.ratePerSec).toBe(1);
    expect(c.ctgovBaseUrl).toBe('https://clinicaltrials.gov/api/v2');
    expect(c.cacheDir).toBe(`${homedir()}/.cache/ctreg`);
  });

  it('CTREG_CACHE_DIR 이 XDG_CACHE_HOME 보다 우선한다', () => {
    expect(loadConfig({ CTREG_CACHE_DIR: '/tmp/a', XDG_CACHE_HOME: '/tmp/b' }).cacheDir).toBe('/tmp/a');
    expect(loadConfig({ XDG_CACHE_HOME: '/tmp/b' }).cacheDir).toBe('/tmp/b/ctreg');
  });

  it('숫자 환경변수를 반영한다', () => {
    expect(loadConfig({ CTREG_CACHE_TTL_SEC: '60', CTREG_RATE_PER_SEC: '2' })).toMatchObject({
      cacheTtlSec: 60, ratePerSec: 2,
    });
  });

  it('숫자가 아닌 값은 조용히 넘기지 않고 exit 2 로 알린다', () => {
    try {
      loadConfig({ CTREG_MAX_RETRIES: 'many' });
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).message).toContain('CTREG_MAX_RETRIES');
    }
  });
});
```

- [ ] **Step 2: 실패하는 HTTP 테스트 작성**

`tests/runtime/http.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { Config } from '../../src/runtime/config.js';
import type { CtregError } from '../../src/runtime/errors.js';
import { getJson } from '../../src/runtime/http.js';

let cfg: Config;
beforeEach(() => {
  cfg = {
    cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-http-')),
    cacheTtlSec: 3600,
    timeoutMs: 5000,
    maxRetries: 3,
    ratePerSec: 1000, // 테스트에서 실제 대기를 없앤다
    ctgovBaseUrl: 'https://example.test/api/v2',
  };
});

const opts = (cacheMode: 'use' | 'refresh' | 'off' = 'use') => ({
  registry: 'ctgov',
  baseUrl: cfg.ctgovBaseUrl,
  path: '/studies',
  params: { 'query.cond': 'NSCLC', pageSize: 2 },
  cacheMode,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const deps = (fetchImpl: typeof fetch) => ({ fetchImpl, sleep: async () => {} });

describe('HTTP 클라이언트', () => {
  it('200 이면 값을 돌려주고 캐시에 저장한다', async () => {
    const f = vi.fn(async () => json({ ok: true }));
    const r = await getJson<{ ok: boolean }>(cfg, opts(), deps(f as unknown as typeof fetch));
    expect(r.value).toEqual({ ok: true });
    expect(r.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('재시도 가능한 5xx 뒤 200 이면 성공한다', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 3 ? json({}, 503) : json({ ok: true })));
    const r = await getJson<{ ok: boolean }>(cfg, opts('off'), deps(f as unknown as typeof fetch));
    expect(r.value).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('429 가 재시도 예산을 소진하면 exit 4 / code rate_limited 로 던진다', async () => {
    const f = vi.fn(async () => json({}, 429));
    try {
      await getJson(cfg, opts('off'), deps(f as unknown as typeof fetch));
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.UPSTREAM);
      expect((e as CtregError).code).toBe('rate_limited');
    }
    expect(f).toHaveBeenCalledTimes(cfg.maxRetries + 1);
  });

  it('400 은 재시도하지 않고 본문 메시지를 hint 로 옮긴다', async () => {
    const f = vi.fn(async () => json({ message: "Unknown field 'Phase3'" }, 400));
    try {
      await getJson(cfg, opts('off'), deps(f as unknown as typeof fetch));
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).code).toBe('upstream');
      expect((e as CtregError).hint).toContain("Unknown field 'Phase3'");
    }
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('404 는 code not_found 로 구분되어 어댑터가 경고로 낮출 수 있다', async () => {
    const f = vi.fn(async () => json({}, 404));
    await expect(getJson(cfg, opts('off'), deps(f as unknown as typeof fetch))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('캐시 히트면 네트워크를 치지 않고 원래 fetchedAt 을 보존한다', async () => {
    const f1 = vi.fn(async () => json({ ok: true }));
    const first = await getJson(cfg, opts(), deps(f1 as unknown as typeof fetch));
    const f2 = vi.fn(async () => json({ ok: 'different' }));
    const second = await getJson(cfg, opts(), deps(f2 as unknown as typeof fetch));
    expect(f2).not.toHaveBeenCalled();
    expect(second.cached).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it('cacheMode refresh 는 캐시가 있어도 네트워크를 친다', async () => {
    const f1 = vi.fn(async () => json({ v: 1 }));
    await getJson(cfg, opts(), deps(f1 as unknown as typeof fetch));
    const f2 = vi.fn(async () => json({ v: 2 }));
    const r = await getJson<{ v: number }>(cfg, opts('refresh'), deps(f2 as unknown as typeof fetch));
    expect(f2).toHaveBeenCalledTimes(1);
    expect(r.value).toEqual({ v: 2 });
  });

  it('undefined 파라미터는 쿼리스트링에 넣지 않는다', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown) => { seen.push(String(url)); return json({}); });
    await getJson(cfg, {
      registry: 'ctgov', baseUrl: cfg.ctgovBaseUrl, path: '/studies',
      params: { a: 'x', b: undefined }, cacheMode: 'off',
    }, deps(f as unknown as typeof fetch));
    expect(seen[0]).toContain('a=x');
    expect(seen[0]).not.toContain('b=');
  });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/runtime/config.test.ts tests/runtime/http.test.ts`
Expected: FAIL — `config.js` / `http.js` 모듈 없음

- [ ] **Step 4: 설정 구현**

`src/runtime/config.ts`:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { usageError } from './errors.js';

export type Config = {
  cacheDir: string;
  cacheTtlSec: number;
  timeoutMs: number;
  maxRetries: number;
  ratePerSec: number;
  ctgovBaseUrl: string;
};

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw usageError(`${name} 이 숫자가 아닙니다: '${raw}'`, `${name} 을 숫자로 두거나 지우세요.`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cacheDir =
    env.CTREG_CACHE_DIR ??
    (env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, 'ctreg') : join(homedir(), '.cache', 'ctreg'));

  return {
    cacheDir,
    cacheTtlSec: num(env, 'CTREG_CACHE_TTL_SEC', 3600),
    timeoutMs: num(env, 'CTREG_TIMEOUT_MS', 30000),
    maxRetries: num(env, 'CTREG_MAX_RETRIES', 3),
    ratePerSec: num(env, 'CTREG_RATE_PER_SEC', 1),
    ctgovBaseUrl: env.CTREG_CTGOV_BASE_URL ?? 'https://clinicaltrials.gov/api/v2',
  };
}
```

- [ ] **Step 5: HTTP 구현**

`src/runtime/http.ts`:

```ts
/**
 * 재시도/백오프 로직은 clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads,
 * Apache-2.0) 의 `clinical-trials-service.ts` 에서 파생했다. 스로틀은 프로세스 간
 * 공유가 필요해 온디스크 토큰버킷으로 교체했다.
 */
import type { Warning } from '../core/capability.js';
import type { Config } from './config.js';
import { cacheKey, readCache, writeCache } from './cache.js';
import { CtregError, rateLimitedError, upstreamError } from './errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { reserveSlot, shareBackoff } from './throttle.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export type HttpDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type GetJsonOpts = {
  registry: string;
  baseUrl: string;
  path: string;
  params: Record<string, string | number | undefined>;
  cacheMode: 'use' | 'refresh' | 'off';
  signal?: AbortSignal;
};

function buildUrl(baseUrl: string, path: string, params: GetJsonOpts['params']): string {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function bodyMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      return parsed.message ?? text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return undefined;
  }
}

export async function getJson<T>(
  cfg: Config,
  o: GetJsonOpts,
  deps: HttpDeps = {},
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const warnings: Warning[] = [];
  const key = cacheKey(o.registry, o.path, o.params);

  if (o.cacheMode === 'use') {
    const hit = await readCache<T>(cfg.cacheDir, key, cfg.cacheTtlSec, now);
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, cached: true, warnings };
  }

  const url = buildUrl(o.baseUrl, o.path, o.params);
  let lastStatus = 0;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const slot = await reserveSlot({
      dir: cfg.cacheDir,
      registry: o.registry,
      ratePerSec: cfg.ratePerSec,
      now,
      sleep,
    });
    if (slot.lockTimedOut) {
      warnings.push({
        code: 'throttle_lock_timeout',
        message: '요청률 버킷 락을 잡지 못해 단독으로 진행했습니다.',
      });
    }

    const timeout = AbortSignal.timeout(cfg.timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await doFetch(url, { signal, headers: { accept: 'application/json' } });
    } catch (cause) {
      if (attempt === cfg.maxRetries) {
        throw upstreamError(`${o.registry} 요청 실패: ${url}`, '네트워크 또는 타임아웃.', cause);
      }
      await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.75 + 0.5 * Math.random()));
      continue;
    }

    lastStatus = res.status;

    if (res.ok) {
      const value = (await res.json()) as T;
      const fetchedAt = new Date(now()).toISOString();
      if (o.cacheMode !== 'off') await writeCache(cfg.cacheDir, key, value, fetchedAt, now);
      return { value, fetchedAt, cached: false, warnings };
    }

    if (res.status === 404) {
      throw new CtregError(
        `${o.registry} 에서 찾을 수 없습니다`,
        'not_found',
        EXIT.UPSTREAM,
        await bodyMessage(res),
      );
    }

    if (!RETRYABLE_STATUS.has(res.status)) {
      throw upstreamError(`${o.registry} 가 ${res.status} 를 반환했습니다`, await bodyMessage(res));
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const untilMs = now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BASE_BACKOFF_MS * 2 ** attempt);
      await shareBackoff({ dir: cfg.cacheDir, registry: o.registry, ratePerSec: cfg.ratePerSec }, untilMs);
    }

    if (attempt === cfg.maxRetries) break;
    await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.75 + 0.5 * Math.random()));
  }

  if (lastStatus === 429) {
    throw rateLimitedError(
      `${o.registry} 가 ${cfg.maxRetries}회 재시도 후에도 요청률을 제한했습니다`,
      '동시에 도는 ctreg 프로세스를 줄이거나 잠시 뒤 다시 시도하세요.',
    );
  }
  throw upstreamError(`${o.registry} 가 ${cfg.maxRetries}회 재시도 후에도 ${lastStatus} 를 반환했습니다`);
}
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/runtime/`
Expected: PASS — errors 6 + throttle 7 + cache 7 + config 4 + http 8 = 32 tests

- [ ] **Step 7: 커밋**

```bash
git add src/runtime/config.ts src/runtime/http.ts tests/runtime/config.test.ts tests/runtime/http.test.ts
git commit -m "feat: config and HTTP client with shared throttle and cache"
```

---

## Task 8: CT.gov 어휘 매핑

**Files:**
- Create: `src/adapters/ctgov/vocab.ts`
- Test: `tests/adapters/ctgov/vocab.test.ts`

**Interfaces:**
- Consumes: Task 1 어휘 타입, Task 2 `usageError`
- Produces: `toStatus(raw?: string): { status: TrialStatus; statusRaw?: string }`, `fromStatus(s: TrialStatus): string`, `toPhases(raw?: string[]): { phase?: TrialPhase[]; phaseRaw?: string[] }`, `fromPhase(p: TrialPhase): string`, `toStudyType(raw?: string): { studyType?: StudyType; studyTypeRaw?: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/ctgov/vocab.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';
import { fromPhase, fromStatus, toPhases, toStatus, toStudyType } from '../../../src/adapters/ctgov/vocab.js';

describe('CT.gov 어휘 매핑', () => {
  it('알려진 상태를 공통 어휘로 옮기고 원문을 보존한다', () => {
    expect(toStatus('RECRUITING')).toEqual({ status: 'recruiting', statusRaw: 'RECRUITING' });
    expect(toStatus('ACTIVE_NOT_RECRUITING').status).toBe('active_not_recruiting');
    expect(toStatus('WITHDRAWN').status).toBe('withdrawn');
  });

  it('CT.gov 의 UNKNOWN 은 unknown 이고 원문이 남는다', () => {
    expect(toStatus('UNKNOWN')).toEqual({ status: 'unknown', statusRaw: 'UNKNOWN' });
  });

  it('필드가 없으면 unknown 이되 statusRaw 를 만들어내지 않는다', () => {
    expect(toStatus(undefined)).toEqual({ status: 'unknown' });
  });

  it('확대접근 계열은 other 로 떨어지고 원문으로만 판별된다', () => {
    expect(toStatus('AVAILABLE')).toEqual({ status: 'other', statusRaw: 'AVAILABLE' });
    expect(toStatus('APPROVED_FOR_MARKETING').status).toBe('other');
  });

  it('처음 보는 값도 예외 없이 other 로 흡수한다 — 업스트림 enum 추가에 깨지지 않아야 한다', () => {
    expect(toStatus('SOMETHING_NEW')).toEqual({ status: 'other', statusRaw: 'SOMETHING_NEW' });
  });

  it('필터 방향 역매핑은 대문자 CT.gov enum 을 낸다', () => {
    expect(fromStatus('recruiting')).toBe('RECRUITING');
    expect(fromStatus('enrolling_by_invitation')).toBe('ENROLLING_BY_INVITATION');
  });

  it('unknown/other 로는 필터를 걸 수 없다', () => {
    for (const bad of ['unknown', 'other'] as const) {
      try {
        fromStatus(bad);
        expect.unreachable('던져야 한다');
      } catch (e) {
        expect((e as CtregError).exit).toBe(EXIT.USAGE);
      }
    }
  });

  it('phase 는 배열로 무손실 보존한다 — 결합 값을 만들지 않는다', () => {
    expect(toPhases(['PHASE1', 'PHASE2'])).toEqual({
      phase: ['phase_1', 'phase_2'],
      phaseRaw: ['PHASE1', 'PHASE2'],
    });
    expect(toPhases(['NA']).phase).toEqual(['na']);
    expect(toPhases(['EARLY_PHASE1']).phase).toEqual(['early_phase_1']);
  });

  it('모르는 phase 는 other 로 흡수한다', () => {
    expect(toPhases(['PHASE9']).phase).toEqual(['other']);
  });

  it('phase 필드가 없으면 필드 자체를 만들지 않는다', () => {
    expect(toPhases(undefined)).toEqual({});
  });

  it('fromPhase 는 AREA[Phase] 값으로 쓸 CT.gov enum 을 낸다', () => {
    expect(fromPhase('phase_3')).toBe('PHASE3');
    expect(fromPhase('early_phase_1')).toBe('EARLY_PHASE1');
  });

  it('studyType 을 옮긴다', () => {
    expect(toStudyType('INTERVENTIONAL').studyType).toBe('interventional');
    expect(toStudyType('EXPANDED_ACCESS').studyType).toBe('expanded_access');
    expect(toStudyType('WEIRD')).toEqual({ studyType: 'other', studyTypeRaw: 'WEIRD' });
    expect(toStudyType(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/vocab.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/adapters/ctgov/vocab.ts`:

```ts
import type { StudyType, TrialPhase, TrialStatus } from '../../core/vocab.js';
import { usageError } from '../../runtime/errors.js';

const STATUS_IN: Record<string, TrialStatus> = {
  RECRUITING: 'recruiting',
  NOT_YET_RECRUITING: 'not_yet_recruiting',
  ENROLLING_BY_INVITATION: 'enrolling_by_invitation',
  ACTIVE_NOT_RECRUITING: 'active_not_recruiting',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
  COMPLETED: 'completed',
  WITHDRAWN: 'withdrawn',
  UNKNOWN: 'unknown',
};

/** 역매핑은 정방향에서 파생한다 — 두 테이블이 어긋나는 사고를 원천 차단한다. */
const STATUS_OUT = Object.fromEntries(
  Object.entries(STATUS_IN).map(([k, v]) => [v, k]),
) as Record<TrialStatus, string | undefined>;

export function toStatus(raw?: string): { status: TrialStatus; statusRaw?: string } {
  if (raw === undefined || raw === '') return { status: 'unknown' };
  const mapped = STATUS_IN[raw];
  return { status: mapped ?? 'other', statusRaw: raw };
}

export function fromStatus(s: TrialStatus): string {
  const out = STATUS_OUT[s];
  if (!out) {
    throw usageError(
      `'${s}' 로는 필터를 걸 수 없습니다`,
      "'unknown' 과 'other' 는 매핑 결과일 뿐 검색 조건이 아닙니다.",
    );
  }
  return out;
}

const PHASE_IN: Record<string, TrialPhase> = {
  EARLY_PHASE1: 'early_phase_1',
  PHASE1: 'phase_1',
  PHASE2: 'phase_2',
  PHASE3: 'phase_3',
  PHASE4: 'phase_4',
  NA: 'na',
};
const PHASE_OUT = Object.fromEntries(
  Object.entries(PHASE_IN).map(([k, v]) => [v, k]),
) as Record<TrialPhase, string | undefined>;

export function toPhases(raw?: string[]): { phase?: TrialPhase[]; phaseRaw?: string[] } {
  if (!raw || raw.length === 0) return {};
  return { phase: raw.map((p) => PHASE_IN[p] ?? 'other'), phaseRaw: raw };
}

export function fromPhase(p: TrialPhase): string {
  const out = PHASE_OUT[p];
  if (!out) {
    throw usageError(`'${p}' 로는 필터를 걸 수 없습니다`, "'other' 는 매핑 결과일 뿐입니다.");
  }
  return out;
}

const STUDY_TYPE_IN: Record<string, StudyType> = {
  INTERVENTIONAL: 'interventional',
  OBSERVATIONAL: 'observational',
  EXPANDED_ACCESS: 'expanded_access',
};

export function toStudyType(raw?: string): { studyType?: StudyType; studyTypeRaw?: string } {
  if (raw === undefined || raw === '') return {};
  const mapped = STUDY_TYPE_IN[raw];
  return { studyType: mapped ?? 'other', studyTypeRaw: raw };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/vocab.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: 커밋**

```bash
git add src/adapters/ctgov/vocab.ts tests/adapters/ctgov/vocab.test.ts
git commit -m "feat(ctgov): bidirectional vocabulary mapping"
```

---

## Task 9: CT.gov 쿼리 조립

리스트 파라미터는 `|` 로 잇고, `filter.advanced` 에 표현식이 둘 이상이면 각각 괄호로 싸 ` AND ` 로 잇는다. 참조 구현 `buildSearchQuery()` 에서 확인한 실제 동작이다. 날짜 `RANGE` 는 해당 필드를 **게시한 시험만** 매칭하므로 반드시 경고를 남긴다.

**Files:**
- Create: `src/adapters/ctgov/query.ts`
- Test: `tests/adapters/ctgov/query.test.ts`

**Interfaces:**
- Consumes: Task 4 `NormalizedQuery`/`FetchOpts`/`IncludeSection`/`CAPS`, Task 8 `fromStatus`/`fromPhase`, Task 2 `usageError`, Task 4 `Warning`
- Produces: `buildSearchParams(q: NormalizedQuery, o: FetchOpts): { params: Record<string, string | number | undefined>; warnings: Warning[] }`, `buildFields(include: IncludeSection[]): string[]`, `buildIdsParams(ids: string[], o: FetchOpts): Record<string, string | number | undefined>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/ctgov/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';
import { buildFields, buildIdsParams, buildSearchParams } from '../../../src/adapters/ctgov/query.js';

const opts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
};

describe('CT.gov 쿼리 조립', () => {
  it('검색 축을 전용 query.* 파라미터로 옮긴다', () => {
    const { params } = buildSearchParams(
      { condition: 'NSCLC', intervention: 'osimertinib', term: 'EGFR', title: 'phase 3', location: 'Seoul', outcomeQuery: 'PFS', sponsor: 'AstraZeneca' },
      opts,
    );
    expect(params['query.cond']).toBe('NSCLC');
    expect(params['query.intr']).toBe('osimertinib');
    expect(params['query.term']).toBe('EGFR');
    expect(params['query.titles']).toBe('phase 3');
    expect(params['query.locn']).toBe('Seoul');
    expect(params['query.outc']).toBe('PFS');
    expect(params['query.spons']).toBe('AstraZeneca');
  });

  it('참조 구현이 쓰지 않던 lead/id/patient 축을 채운다', () => {
    const { params } = buildSearchParams({ lead: 'Merck', id: 'NCT01234567', patient: '62 year old female' }, opts);
    expect(params['query.lead']).toBe('Merck');
    expect(params['query.id']).toBe('NCT01234567');
    expect(params['query.patient']).toBe('62 year old female');
  });

  it('상태 목록은 파이프로 잇는다', () => {
    const { params } = buildSearchParams({ status: ['recruiting', 'completed'] }, opts);
    expect(params['filter.overallStatus']).toBe('RECRUITING|COMPLETED');
  });

  it('phase 는 filter.advanced 의 AREA[Phase] 로 간다', () => {
    const { params } = buildSearchParams({ phase: ['phase_2', 'phase_3'] }, opts);
    expect(params['filter.advanced']).toBe('(AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)');
  });

  it('표현식이 둘 이상이면 괄호로 싸 AND 로 잇는다', () => {
    const { params } = buildSearchParams({ phase: ['phase_3'], studyType: 'interventional' }, opts);
    expect(params['filter.advanced']).toBe('(AREA[Phase]PHASE3) AND (AREA[StudyType]INTERVENTIONAL)');
  });

  it('지오는 좌표와 단위 있는 반경을 distance() 로 만든다', () => {
    const { params } = buildSearchParams(
      { near: { lat: 37.5665, lon: 126.978 }, radius: { value: 100, unit: 'km' } },
      opts,
    );
    expect(params['filter.geo']).toBe('distance(37.5665,126.978,100km)');
  });

  it('--radius 만 있고 --near 가 없으면 exit 2 다', () => {
    try {
      buildSearchParams({ radius: { value: 100, unit: 'km' } }, opts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.USAGE);
      expect((e as CtregError).hint).toContain('--near');
    }
  });

  it('날짜 범위는 AREA[...]RANGE[...] 이고, 누락 시험을 배제한다는 경고를 남긴다', () => {
    const { params, warnings } = buildSearchParams({ updatedSince: '2025-01-01' }, opts);
    expect(params['filter.advanced']).toBe('(AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX])');
    expect(warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('양쪽 경계가 있으면 RANGE 의 두 자리를 모두 채운다', () => {
    const { params } = buildSearchParams({ startAfter: '2024-01-01', startBefore: '2024-12-31' }, opts);
    expect(params['filter.advanced']).toBe('(AREA[StartDate]RANGE[2024-01-01, 2024-12-31])');
  });

  it('날짜 형식이 YYYY-MM-DD 가 아니면 exit 2 다', () => {
    expect(() => buildSearchParams({ updatedSince: '2025/01/01' }, opts)).toThrow();
  });

  it('pageSize 를 캡에 묶고 countTotal 을 켠다', () => {
    const { params } = buildSearchParams({ pageSize: 9999 }, opts);
    expect(params.pageSize).toBe(CAPS.pageSize.max);
    expect(params.countTotal).toBe('true');
  });

  it('pageToken 을 그대로 통과시킨다 — 페이지 번호가 아니다', () => {
    const { params } = buildSearchParams({}, opts);
    expect(params.pageToken).toBeUndefined();
    expect(buildSearchParams({ pageToken: 'abc' } as never, opts).params.pageToken).toBe('abc');
  });

  it('include 에 따라 fields 투영이 늘어난다', () => {
    const core = buildFields(['core']);
    const withElig = buildFields(['core', 'eligibility']);
    expect(core).toContain('protocolSection.identificationModule.nctId');
    expect(core.some((f) => f.includes('eligibilityModule.eligibilityCriteria'))).toBe(false);
    expect(withElig.some((f) => f.includes('eligibilityModule.eligibilityCriteria'))).toBe(true);
    expect(buildFields(['all']).length).toBeGreaterThan(withElig.length);
  });

  it('get 배치는 filter.ids 를 파이프로 잇는다', () => {
    const p = buildIdsParams(['NCT01234567', 'NCT07654321'], opts);
    expect(p['filter.ids']).toBe('NCT01234567|NCT07654321');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/query.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/adapters/ctgov/query.ts`:

```ts
/**
 * 파라미터 조립 규칙(리스트는 `|`, filter.advanced 는 괄호 + AND)은
 * clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads, Apache-2.0) 의
 * `buildSearchQuery()` 에서 확인한 실제 동작을 따른다.
 */
import type { Warning } from '../../core/capability.js';
import { CAPS, type FetchOpts, type IncludeSection, type NormalizedQuery } from '../../core/query.js';
import { usageError } from '../../runtime/errors.js';
import { fromPhase, fromStatus } from './vocab.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const CORE_FIELDS = [
  'protocolSection.identificationModule.nctId',
  'protocolSection.identificationModule.briefTitle',
  'protocolSection.identificationModule.officialTitle',
  'protocolSection.identificationModule.secondaryIdInfos',
  'protocolSection.statusModule.overallStatus',
  'protocolSection.statusModule.startDateStruct',
  'protocolSection.statusModule.primaryCompletionDateStruct',
  'protocolSection.statusModule.completionDateStruct',
  'protocolSection.statusModule.studyFirstPostDateStruct',
  'protocolSection.statusModule.lastUpdatePostDateStruct',
  'protocolSection.designModule.phases',
  'protocolSection.designModule.studyType',
  'protocolSection.designModule.enrollmentInfo',
  'protocolSection.conditionsModule.conditions',
  'protocolSection.armsInterventionsModule.interventions',
  'protocolSection.sponsorCollaboratorsModule.leadSponsor',
  'protocolSection.sponsorCollaboratorsModule.collaborators',
  'protocolSection.contactsLocationsModule.locations',
  'hasResults',
];

const SECTION_FIELDS: Record<Exclude<IncludeSection, 'core' | 'all'>, string[]> = {
  eligibility: ['protocolSection.eligibilityModule'],
  outcomes: ['protocolSection.outcomesModule'],
  contacts: ['protocolSection.contactsLocationsModule.centralContacts',
             'protocolSection.contactsLocationsModule.overallOfficials'],
  locations: ['protocolSection.contactsLocationsModule.locations'],
};

export function buildFields(include: IncludeSection[]): string[] {
  const out = new Set(CORE_FIELDS);
  const wantAll = include.includes('all');
  for (const section of ['eligibility', 'outcomes', 'contacts', 'locations'] as const) {
    if (wantAll || include.includes(section)) for (const f of SECTION_FIELDS[section]) out.add(f);
  }
  return [...out];
}

function dateRange(area: string, from?: string, to?: string): string | undefined {
  if (!from && !to) return undefined;
  for (const d of [from, to]) {
    if (d && !DATE.test(d)) {
      throw usageError(`날짜 '${d}' 는 YYYY-MM-DD 형식이 아닙니다`, '예: 2025-01-01');
    }
  }
  return `AREA[${area}]RANGE[${from ?? 'MIN'}, ${to ?? 'MAX'}]`;
}

export function buildSearchParams(
  q: NormalizedQuery,
  o: FetchOpts,
): { params: Record<string, string | number | undefined>; warnings: Warning[] } {
  const params: Record<string, string | number | undefined> = {};
  const warnings: Warning[] = [];

  params['query.cond'] = q.condition;
  params['query.intr'] = q.intervention;
  params['query.term'] = q.term;
  params['query.titles'] = q.title;
  params['query.locn'] = q.location;
  params['query.outc'] = q.outcomeQuery;
  params['query.spons'] = q.sponsor;
  params['query.lead'] = q.lead;
  params['query.id'] = q.id;
  params['query.patient'] = q.patient;

  if (q.status?.length) params['filter.overallStatus'] = q.status.map(fromStatus).join('|');

  if (q.radius && !q.near) {
    throw usageError('--radius 는 --near 없이 쓸 수 없습니다', '--near <lat,lon> 으로 중심 좌표를 주세요.');
  }
  if (q.near) {
    const r = q.radius ?? { value: 50, unit: 'km' as const };
    params['filter.geo'] = `distance(${q.near.lat},${q.near.lon},${r.value}${r.unit})`;
  }

  const advanced: string[] = [];
  if (q.phase?.length) advanced.push(q.phase.map((p) => `AREA[Phase]${fromPhase(p)}`).join(' OR '));
  if (q.studyType) advanced.push(`AREA[StudyType]${q.studyType.toUpperCase()}`);

  const ranges = [
    dateRange('LastUpdatePostDate', q.updatedSince, q.updatedBefore),
    dateRange('StartDate', q.startAfter, q.startBefore),
    dateRange('PrimaryCompletionDate', q.completionAfter, q.completionBefore),
  ].filter((v): v is string => v !== undefined);

  if (ranges.length > 0) {
    advanced.push(...ranges);
    warnings.push({
      code: 'date_filter_excludes_missing',
      message: '날짜 필터는 해당 날짜를 게시한 시험만 매칭합니다. 날짜를 기재하지 않은 시험은 결과에서 빠집니다.',
    });
  }

  if (advanced.length > 0) params['filter.advanced'] = advanced.map((p) => `(${p})`).join(' AND ');

  params.fields = buildFields(o.include).join('|');
  params.pageSize = Math.min(q.pageSize ?? CAPS.pageSize.default, CAPS.pageSize.max);
  params.countTotal = 'true';
  params.pageToken = (q as NormalizedQuery & { pageToken?: string }).pageToken;
  params.sort = q.sort;

  return { params, warnings };
}

export function buildIdsParams(
  ids: string[],
  o: FetchOpts,
): Record<string, string | number | undefined> {
  return {
    'filter.ids': ids.join('|'),
    fields: buildFields(o.include).join('|'),
    pageSize: Math.min(ids.length, CAPS.pageSize.max),
  };
}
```

**주의:** `NormalizedQuery` 에 `pageToken?: string` 를 추가해야 한다 (Task 4 의 `src/core/query.ts` 수정). `page?: number` 는 존재하지 않는다 — CT.gov 는 페이지 번호가 아니라 불투명 커서를 쓴다.

- [ ] **Step 4: `NormalizedQuery` 에 pageToken 추가**

`src/core/query.ts` 의 `NormalizedQuery` 안 `sort?: string;` 아래에 추가:

```ts
  pageToken?: string;
```

그리고 `buildSearchParams` 의 `(q as NormalizedQuery & { pageToken?: string }).pageToken` 를 `q.pageToken` 으로 되돌린다. 테스트의 `as never` 캐스트도 제거한다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/query.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 6: 커밋**

```bash
git add src/adapters/ctgov/query.ts src/core/query.ts tests/adapters/ctgov/query.test.ts
git commit -m "feat(ctgov): query assembly with verified Essie syntax"
```

---

## Task 10: CT.gov 레코드 매핑 + 픽스처

정규화 계층은 없는 값을 그럴듯하게 채우는 순간 임상적으로 위험해진다. **희소 응답 테스트는 이 태스크의 핵심이지 부록이 아니다.**

**Files:**
- Create: `src/adapters/ctgov/map.ts`
- Create: `tests/fixtures/ctgov/study-full.json`, `tests/fixtures/ctgov/study-sparse.json`, `tests/fixtures/ctgov/search-page.json`
- Test: `tests/adapters/ctgov/map.test.ts`

**Interfaces:**
- Consumes: Task 3 `formatTrialId`, Task 4 `TrialRecord`/`TrialLocation`/`Warning`, Task 4 `FetchOpts`, Task 8 `toStatus`/`toPhases`/`toStudyType`
- Produces: `mapStudy(study: unknown, o: FetchOpts, fetchedAt: string): { record: TrialRecord; warnings: Warning[] }`, `haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number`

- [ ] **Step 1: 실제 응답을 픽스처로 기록한다**

```bash
mkdir -p tests/fixtures/ctgov
curl -sS 'https://clinicaltrials.gov/api/v2/studies/NCT04280705' -o tests/fixtures/ctgov/study-full.json
curl -sS 'https://clinicaltrials.gov/api/v2/studies?query.cond=non-small+cell+lung+cancer&pageSize=3&countTotal=true' -o tests/fixtures/ctgov/search-page.json
```

두 파일이 비어 있지 않고 유효한 JSON인지 확인:

```bash
node -e "for (const f of ['study-full','search-page']) { const j = JSON.parse(require('fs').readFileSync('tests/fixtures/ctgov/'+f+'.json','utf8')); console.log(f, Object.keys(j).join(',')); }"
```

- [ ] **Step 2: 희소 픽스처를 손으로 만든다**

기록본에서 파생하지 않고 손으로 쓴다 — 결정적이어야 하고, "무엇이 빠졌는지"가 의도적으로 드러나야 한다.

`tests/fixtures/ctgov/study-sparse.json`:

```json
{
  "protocolSection": {
    "identificationModule": { "nctId": "NCT00000001", "briefTitle": "Sparse Study" },
    "statusModule": {},
    "conditionsModule": { "conditions": ["Some Condition"] }
  }
}
```

스폰서·날짜·장소·phase·studyType·enrollment 이 전부 없다. 매핑은 이 필드들을 **생략해야** 하며 `null`, `""`, `0`, `"unknown"` 문자열로 채우면 안 된다.

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/adapters/ctgov/map.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapStudy, haversineKm } from '../../../src/adapters/ctgov/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';

const fixture = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov', `${n}.json`), 'utf8'));

const opts = (over: Partial<FetchOpts> = {}): FetchOpts => ({
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
  ...over,
});

const AT = '2026-08-22T00:00:00.000Z';

describe('CT.gov → TrialRecord 매핑', () => {
  it('실제 응답이 계약 스키마를 통과한다', () => {
    const { record } = mapStudy(fixture('study-full'), opts(), AT);
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
    expect(record.registry).toBe('ctgov');
    expect(record.id).toMatch(/^CTGOV:NCT\d{8}$/);
    expect(record.url).toContain(record.registryId);
  });

  it('검색 페이지의 모든 항목이 계약을 통과한다', () => {
    const page = fixture('search-page') as { studies: unknown[] };
    for (const s of page.studies) {
      expect(() => TrialRecordSchema.parse(mapStudy(s, opts(), AT).record)).not.toThrow();
    }
  });

  it('희소 응답에서 없는 필드는 생략한다 — null 이나 빈 값으로 채우지 않는다', () => {
    const { record } = mapStudy(fixture('study-sparse'), opts(), AT);
    expect(record.title).toBe('Sparse Study');
    expect(record.status).toBe('unknown');
    expect(record).not.toHaveProperty('statusRaw');
    expect(record.sponsor).toBeUndefined();
    expect(record.dates).toBeUndefined();
    expect(record.phase).toBeUndefined();
    expect(record.enrollment).toBeUndefined();
    expect(record.locations).toBeUndefined();
    expect(record.locationsTotal).toBeUndefined();
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  it('장소는 캡을 넘으면 잘리되 총 개수와 경고를 남긴다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000002', briefTitle: 'Many Sites' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const { record, warnings } = mapStudy(many, opts(), AT);
    expect(record.locations).toHaveLength(CAPS.locations.default);
    expect(record.locationsTotal).toBe(37);
    expect(warnings.map((w) => w.code)).toContain('locations_truncated');
  });

  it('--include eligibility 없이는 적격 기준문을 담지 않는다', () => {
    const withElig = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000003', briefTitle: 'E' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'Inclusion Criteria: ...', minimumAge: '18 Years', sex: 'ALL' },
      },
    };
    expect(mapStudy(withElig, opts(), AT).record.eligibility).toBeUndefined();
    const on = mapStudy(withElig, opts({ include: ['core', 'eligibility'] }), AT).record;
    expect(on.eligibility?.criteriaText).toContain('Inclusion Criteria');
    expect(on.eligibility?.minAge).toBe('18 Years');
    expect(on.eligibility?.sex).toBe('all');
  });

  it('적격 기준문이 캡을 넘으면 자르고 플래그와 경고를 남긴다', () => {
    const long = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000004', briefTitle: 'L' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'x'.repeat(20000) },
      },
    };
    const o = opts({ include: ['core', 'eligibility'], caps: { locations: 10, eligibilityChars: 100, outcomes: 20 } });
    const { record, warnings } = mapStudy(long, o, AT);
    expect(record.eligibility?.criteriaText).toHaveLength(100);
    expect(record.eligibility?.criteriaTruncated).toBe(true);
    expect(warnings.map((w) => w.code)).toContain('eligibility_truncated');
  });

  it('--near 가 있으면 각 장소에 거리를 붙이고 가까운 순으로 정렬한다', () => {
    const geo = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000005', briefTitle: 'G' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: [
            { city: 'Busan', geoPoint: { lat: 35.1796, lon: 129.0756 } },
            { city: 'Seoul', geoPoint: { lat: 37.5665, lon: 126.978 } },
          ],
        },
      },
    };
    const { record } = mapStudy(geo, { ...opts(), near: { lat: 37.5665, lon: 126.978 } } as FetchOpts & { near: { lat: number; lon: number } }, AT);
    expect(record.locations?.[0]?.city).toBe('Seoul');
    expect(record.locations?.[0]?.distanceKm).toBeCloseTo(0, 1);
    expect(record.locations?.[1]?.distanceKm).toBeGreaterThan(300);
  });

  it('--raw 일 때만 원문을 동봉한다', () => {
    const s = fixture('study-sparse');
    expect(mapStudy(s, opts(), AT).record.source).toBeUndefined();
    expect(mapStudy(s, opts({ raw: true }), AT).record.source).toEqual(s);
  });

  it('haversineKm 은 서울–부산을 약 325km 로 계산한다', () => {
    const d = haversineKm({ lat: 37.5665, lon: 126.978 }, { lat: 35.1796, lon: 129.0756 });
    expect(d).toBeGreaterThan(310);
    expect(d).toBeLessThan(340);
  });
});
```

- [ ] **Step 4: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/map.test.ts`
Expected: FAIL — `map.js` 모듈 없음

- [ ] **Step 5: 최소 구현**

`FetchOpts` 에 `near?: { lat: number; lon: number }` 를 추가한다 (`src/core/query.ts`) — 거리 주석은 조회 옵션이지 쿼리가 아니다.

`src/adapters/ctgov/map.ts`:

```ts
/**
 * 하버사인은 clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads, Apache-2.0)
 * 의 `geo-helpers.ts` 에서 파생했다. 원본은 마일을 반환하며 여기서는 km 로 낸다.
 */
import type { Warning } from '../../core/capability.js';
import type { FetchOpts } from '../../core/query.js';
import type { TrialLocation, TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import { toPhases, toStatus, toStudyType } from './vocab.js';

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 값이 없으면 키 자체를 만들지 않는다. `null` / `""` / `0` 으로 채우지 않는다. */
function defined<T extends object>(o: T): Partial<T> | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

const dateOf = (s: { date?: string } | undefined) => s?.date;

export function mapStudy(
  study: unknown,
  o: FetchOpts,
  fetchedAt: string,
): { record: TrialRecord; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const s = study as Record<string, any>;
  const p = s.protocolSection ?? {};
  const ident = p.identificationModule ?? {};
  const registryId: string = ident.nctId;
  const id = formatTrialId('ctgov', registryId);

  const wantAll = o.include.includes('all');
  const want = (sec: 'eligibility' | 'outcomes' | 'contacts' | 'locations') =>
    wantAll || o.include.includes(sec);

  // 장소: 거리 주석 → 정렬 → 캡
  const rawLocations: any[] = p.contactsLocationsModule?.locations ?? [];
  let locations: TrialLocation[] | undefined;
  let locationsTotal: number | undefined;
  if (rawLocations.length > 0) {
    locationsTotal = rawLocations.length;
    let mapped: TrialLocation[] = rawLocations.map((l) => {
      const st = toStatus(l.status);
      return {
        ...defined({ facility: l.facility, city: l.city, state: l.state, country: l.country }),
        ...(l.status ? { status: st.status, statusRaw: st.statusRaw } : {}),
        ...(l.geoPoint ? { geo: { lat: l.geoPoint.lat, lon: l.geoPoint.lon } } : {}),
      } as TrialLocation;
    });
    if (o.near) {
      const center = o.near;
      mapped = mapped
        .map((l) => (l.geo ? { ...l, distanceKm: haversineKm(center, l.geo) } : l))
        .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
    }
    const cap = want('locations') ? 200 : o.caps.locations;
    if (mapped.length > cap) {
      warnings.push({ code: 'locations_truncated', message: `장소 ${mapped.length}곳 중 ${cap}곳만 담았습니다.`, id, at: cap });
      mapped = mapped.slice(0, cap);
    }
    locations = mapped;
  }

  // 적격 (옵트인)
  let eligibility: TrialRecord['eligibility'];
  const em = p.eligibilityModule;
  if (em && want('eligibility')) {
    const raw: string | undefined = em.eligibilityCriteria;
    const truncated = raw !== undefined && raw.length > o.caps.eligibilityChars;
    if (truncated) {
      warnings.push({ code: 'eligibility_truncated', message: '적격 기준문을 잘랐습니다.', id, at: o.caps.eligibilityChars });
    }
    const sexRaw: string | undefined = em.sex;
    eligibility = defined({
      minAge: em.minimumAge,
      maxAge: em.maximumAge,
      sex: sexRaw ? (sexRaw.toLowerCase() as 'all' | 'female' | 'male') : undefined,
      healthyVolunteers: em.healthyVolunteers,
      criteriaText: truncated ? raw!.slice(0, o.caps.eligibilityChars) : raw,
      criteriaTruncated: truncated ? true : undefined,
    }) as TrialRecord['eligibility'];
  }

  // 결과 지표 (옵트인)
  let outcomes: TrialRecord['outcomes'];
  const om = p.outcomesModule;
  if (om && want('outcomes')) {
    const all = [
      ...(om.primaryOutcomes ?? []).map((x: any) => ({ type: 'primary' as const, ...x })),
      ...(om.secondaryOutcomes ?? []).map((x: any) => ({ type: 'secondary' as const, ...x })),
      ...(om.otherOutcomes ?? []).map((x: any) => ({ type: 'other' as const, ...x })),
    ];
    const cap = o.caps.outcomes;
    if (all.length > cap) {
      warnings.push({ code: 'outcomes_truncated', message: `결과 지표 ${all.length}개 중 ${cap}개만 담았습니다.`, id, at: cap });
    }
    outcomes = all.slice(0, cap).map((x) => ({
      type: x.type,
      measure: x.measure,
      ...defined({ timeFrame: x.timeFrame, description: x.description }),
    }));
  }

  const status = toStatus(p.statusModule?.overallStatus);
  const phases = toPhases(p.designModule?.phases);
  const studyType = toStudyType(p.designModule?.studyType);
  const enrollmentInfo = p.designModule?.enrollmentInfo;
  const lead = p.sponsorCollaboratorsModule?.leadSponsor?.name;
  const collaborators: string[] | undefined = p.sponsorCollaboratorsModule?.collaborators?.map((c: any) => c.name);

  const crossIds = (ident.secondaryIdInfos ?? [])
    .filter((x: any) => x.id && x.type)
    .map((x: any) => ({ registry: String(x.type), id: String(x.id) }));

  const record: TrialRecord = {
    id,
    registry: 'ctgov',
    registryId,
    url: `https://clinicaltrials.gov/study/${registryId}`,
    title: ident.briefTitle,
    conditions: p.conditionsModule?.conditions ?? [],
    status: status.status,
    fetchedAt,
    ...(status.statusRaw ? { statusRaw: status.statusRaw } : {}),
    ...defined({ officialTitle: ident.officialTitle }),
    ...phases,
    ...studyType,
    ...(crossIds.length > 0 ? { crossIds } : {}),
    ...(p.armsInterventionsModule?.interventions
      ? { interventions: p.armsInterventionsModule.interventions.map((i: any) => ({ name: i.name, ...defined({ type: i.type }) })) }
      : {}),
    ...(lead || collaborators?.length ? { sponsor: defined({ lead, collaborators }) as TrialRecord['sponsor'] } : {}),
    ...(enrollmentInfo
      ? { enrollment: defined({ count: enrollmentInfo.count, basis: enrollmentInfo.type?.toLowerCase() }) as TrialRecord['enrollment'] }
      : {}),
    ...(() => {
      const dates = defined({
        start: dateOf(p.statusModule?.startDateStruct),
        primaryCompletion: dateOf(p.statusModule?.primaryCompletionDateStruct),
        completion: dateOf(p.statusModule?.completionDateStruct),
        firstPosted: dateOf(p.statusModule?.studyFirstPostDateStruct),
        lastUpdated: dateOf(p.statusModule?.lastUpdatePostDateStruct),
      });
      return dates ? { dates } : {};
    })(),
    ...(locations ? { locations, locationsTotal } : {}),
    ...(typeof s.hasResults === 'boolean' ? { hasResults: s.hasResults } : {}),
    ...(eligibility ? { eligibility } : {}),
    ...(outcomes ? { outcomes } : {}),
    ...(want('contacts') && p.contactsLocationsModule?.centralContacts
      ? {
          contacts: p.contactsLocationsModule.centralContacts.map((c: any) =>
            defined({ name: c.name, role: c.role, email: c.email, phone: c.phone }),
          ) as TrialRecord['contacts'],
        }
      : {}),
    ...(o.raw ? { source: study } : {}),
  };

  return { record, warnings };
}
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/map.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 7: 커밋**

```bash
git add src/adapters/ctgov/map.ts src/core/query.ts tests/adapters/ctgov/map.test.ts tests/fixtures
git commit -m "feat(ctgov): map studies to TrialRecord with sparse-payload safety"
```

---

## Task 11: CT.gov 클라이언트 + 결과 추출

`ctreg results` 의 기본은 **요약**이다. 지표 제목과 AE 기관계 롤업, 각 섹션의 개수만 내고, 필터에 걸린 항목만 전체 상세로 전개한다. 참조 구현의 `summary` 는 앞쪽 항목을 자를 뿐 이름으로 고를 수 없었다 — 그 병목을 여기서 없앤다.

**Files:**
- Create: `src/adapters/ctgov/client.ts`, `src/adapters/ctgov/results.ts`
- Create: `tests/fixtures/ctgov/study-results.json`
- Test: `tests/adapters/ctgov/results.test.ts`

**Interfaces:**
- Consumes: Task 7 `Config`/`HttpDeps`/`getJson`, Task 4 `ResultsOpts`/`TrialResults`/`Warning`
- Produces:
  - `client.ts`: `makeClient(cfg: Config, deps?: HttpDeps)` → `{ studies(params, cacheMode), study(nctId, params, cacheMode) }`, 각각 `Promise<{ value: unknown; fetchedAt: string; cached: boolean; warnings: Warning[] }>`
  - `results.ts`: `extractResults(study: unknown, id: string, o: ResultsOpts, fetchedAt: string): { results: TrialResults; warnings: Warning[] }`

- [ ] **Step 1: 결과가 있는 시험을 골라 픽스처로 기록한다**

```bash
curl -sS 'https://clinicaltrials.gov/api/v2/studies?query.cond=breast+cancer&pageSize=50&fields=protocolSection.identificationModule.nctId%7ChasResults' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const hit=j.studies.find(x=>x.hasResults);if(!hit){console.error('결과 있는 시험을 못 찾음 — pageSize 를 늘리거나 다른 질환으로 재시도');process.exit(1)}console.log(hit.protocolSection.identificationModule.nctId)})" > /tmp/ctreg-nct.txt
curl -sS "https://clinicaltrials.gov/api/v2/studies/$(cat /tmp/ctreg-nct.txt)" -o tests/fixtures/ctgov/study-results.json
node -e "const j=require('./tests/fixtures/ctgov/study-results.json'); console.log(Object.keys(j.resultsSection ?? {}).join('\n'))"
```

마지막 명령이 출력하는 모듈 이름들이 **정본**이다. 아래 구현의 경로가 픽스처와 다르면 **픽스처를 기준으로 구현을 고친다.** 기억이나 문서가 아니라 실제 응답이 기준이다.

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/adapters/ctgov/results.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractResults } from '../../../src/adapters/ctgov/results.js';
import { TrialResultsSchema } from '../../../src/core/record.js';
import type { ResultsOpts } from '../../../src/core/query.js';

const study = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/ctgov/study-results.json'), 'utf8'),
);

const opts = (over: Partial<ResultsOpts> = {}): ResultsOpts => ({
  sections: ['outcomes', 'adverse', 'flow', 'baseline'],
  full: false,
  cacheMode: 'use',
  ...over,
});

const AT = '2026-08-22T00:00:00.000Z';
const ID = 'CTGOV:NCT00000000';

describe('CT.gov 결과 추출', () => {
  it('기본은 요약이다 — 개수는 세되 전개하지 않는다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    expect(() => TrialResultsSchema.parse(results)).not.toThrow();
    expect(results.hasResults).toBe(true);
    expect(results.sections.outcomes!.total).toBeGreaterThan(0);
    expect(results.sections.outcomes!.expanded).toBe(0);
    expect(results.sections.outcomes!.items).toHaveLength(0);
  });

  it('요약에서도 AE 는 기관계 롤업을 낸다 — 전개 없이 형태를 파악할 수 있어야 한다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    expect(results.sections.adverse!.byOrgan.length).toBeGreaterThan(0);
    expect(results.sections.adverse!.byOrgan.every((o) => o.expanded === false)).toBe(true);
  });

  it('outcome 필터에 걸린 지표만 전개한다', () => {
    const all = extractResults(study, ID, opts(), AT);
    const firstTitle = (study as any).resultsSection.outcomeMeasuresModule.outcomeMeasures[0].title as string;
    const word = firstTitle.split(/\s+/)[0]!;
    const { results } = extractResults(study, ID, opts({ outcomeFilter: [word] }), AT);
    expect(results.sections.outcomes!.expanded).toBeGreaterThan(0);
    expect(results.sections.outcomes!.expanded).toBeLessThanOrEqual(all.sections.outcomes!.total);
    expect(results.sections.outcomes!.items[0]!.measure.toLowerCase()).toContain(word.toLowerCase());
  });

  it('필터는 대소문자를 가리지 않고 부분일치한다', () => {
    const t = (study as any).resultsSection.outcomeMeasuresModule.outcomeMeasures[0].title as string;
    const { results } = extractResults(study, ID, opts({ outcomeFilter: [t.slice(0, 6).toUpperCase()] }), AT);
    expect(results.sections.outcomes!.expanded).toBeGreaterThan(0);
  });

  it('전개되지 않은 항목이 남으면 경고를 낸다 — 조용히 감추지 않는다', () => {
    const { warnings } = extractResults(study, ID, opts(), AT);
    expect(warnings.map((w) => w.code)).toContain('results_summarized');
  });

  it('--full 은 전부 전개하고 경고를 남긴다', () => {
    const { results, warnings } = extractResults(study, ID, opts({ full: true }), AT);
    expect(results.sections.outcomes!.expanded).toBe(results.sections.outcomes!.total);
    expect(warnings.map((w) => w.code)).toContain('results_full');
  });

  it('--section 으로 고른 섹션만 담는다', () => {
    const { results } = extractResults(study, ID, opts({ sections: ['outcomes'] }), AT);
    expect(results.sections.outcomes).toBeDefined();
    expect(results.sections.adverse).toBeUndefined();
    expect(results.sections.flow).toBeUndefined();
  });

  it('결과 섹션이 없는 시험은 hasResults false 를 내고 빈 sections 를 준다', () => {
    const { results } = extractResults({ protocolSection: {} }, ID, opts(), AT);
    expect(results.hasResults).toBe(false);
    expect(results.sections.outcomes).toBeUndefined();
  });

  it('flow 와 baseline 은 정규화하지 않고 원문 구조를 통과시킨다', () => {
    const { results } = extractResults(study, ID, opts(), AT);
    if (results.sections.flow) expect(typeof results.sections.flow.total).toBe('number');
  });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/results.test.ts`
Expected: FAIL — `results.js` 모듈 없음

- [ ] **Step 4: 클라이언트 구현**

`src/adapters/ctgov/client.ts`:

```ts
import type { Config } from '../../runtime/config.js';
import { getJson, type HttpDeps } from '../../runtime/http.js';

export type CacheMode = 'use' | 'refresh' | 'off';

export function makeClient(cfg: Config, deps: HttpDeps = {}) {
  const base = { registry: 'ctgov' as const, baseUrl: cfg.ctgovBaseUrl };
  return {
    studies: (params: Record<string, string | number | undefined>, cacheMode: CacheMode) =>
      getJson<{ studies?: unknown[]; totalCount?: number; nextPageToken?: string }>(
        cfg, { ...base, path: '/studies', params, cacheMode }, deps,
      ),
    study: (nctId: string, params: Record<string, string | number | undefined>, cacheMode: CacheMode) =>
      getJson<unknown>(cfg, { ...base, path: `/studies/${nctId}`, params, cacheMode }, deps),
  };
}
export type CtgovClient = ReturnType<typeof makeClient>;
```

- [ ] **Step 5: 결과 추출 구현**

`src/adapters/ctgov/results.ts`:

```ts
import type { Warning } from '../../core/capability.js';
import type { ResultsOpts } from '../../core/query.js';
import type { AdverseEvent, OutcomeResult, TrialResults } from '../../core/record.js';

const OUTCOME_TYPE: Record<string, OutcomeResult['type']> = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
};

const has = (hay: string | undefined, needles: string[]) =>
  hay !== undefined && needles.some((n) => hay.toLowerCase().includes(n.toLowerCase()));

export function extractResults(
  study: unknown,
  id: string,
  o: ResultsOpts,
  fetchedAt: string,
): { results: TrialResults; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const rs = (study as any)?.resultsSection;
  const sections: TrialResults['sections'] = {};

  if (!rs) {
    return {
      results: { id, registry: 'ctgov', hasResults: false, sections, fetchedAt },
      warnings,
    };
  }

  let summarized = false;

  if (o.sections.includes('outcomes')) {
    const raw: any[] = rs.outcomeMeasuresModule?.outcomeMeasures ?? [];
    const keep = (m: any) => o.full || (o.outcomeFilter?.length ? has(m.title, o.outcomeFilter) : false);
    const items: OutcomeResult[] = raw.filter(keep).map((m) => ({
      type: OUTCOME_TYPE[m.type] ?? 'other',
      measure: m.title,
      ...(m.timeFrame ? { timeFrame: m.timeFrame } : {}),
      ...(m.description ? { description: m.description } : {}),
    }));
    sections.outcomes = { total: raw.length, expanded: items.length, items };
    if (items.length < raw.length) summarized = true;
  }

  if (o.sections.includes('adverse')) {
    const raw: any[] = [
      ...(rs.adverseEventsModule?.seriousEvents ?? []).map((e: any) => ({ ...e, serious: true })),
      ...(rs.adverseEventsModule?.otherEvents ?? []).map((e: any) => ({ ...e, serious: false })),
    ];
    const keep = (e: any) =>
      o.full ||
      (o.aeOrganFilter ? has(e.organSystem, [o.aeOrganFilter]) : false) ||
      (o.aeTermFilter ? has(e.term, [o.aeTermFilter]) : false);

    const items: AdverseEvent[] = raw.filter(keep).map((e) => ({
      term: e.term,
      ...(e.organSystem ? { organ: e.organSystem } : {}),
      serious: e.serious,
      ...(() => {
        const stats: any[] = e.stats ?? [];
        const affected = stats.reduce((n, s) => n + (s.numAffected ?? 0), 0);
        const atRisk = stats.reduce((n, s) => n + (s.numAtRisk ?? 0), 0);
        return { ...(affected ? { affected } : {}), ...(atRisk ? { atRisk } : {}) };
      })(),
    }));

    // 롤업은 전개 여부와 무관하게 항상 낸다 — 전개 없이도 형태를 파악할 수 있어야 한다.
    const expandedTerms = new Set(items.map((i) => i.term));
    const byOrganMap = new Map<string, { events: number; expanded: boolean }>();
    for (const e of raw) {
      const organ = e.organSystem ?? '(미분류)';
      const cur = byOrganMap.get(organ) ?? { events: 0, expanded: false };
      byOrganMap.set(organ, {
        events: cur.events + 1,
        expanded: cur.expanded || expandedTerms.has(e.term),
      });
    }
    const byOrgan = [...byOrganMap.entries()].map(([organ, v]) => ({ organ, ...v }));

    sections.adverse = { total: raw.length, expanded: items.length, byOrgan, items };
    if (items.length < raw.length) summarized = true;
  }

  // flow / baseline 은 레지스트리마다 구조가 달라 정규화하지 않는다. 개수만 세고 원문을 통과시킨다.
  if (o.sections.includes('flow') && rs.participantFlowModule) {
    const items: unknown[] = rs.participantFlowModule.periods ?? [];
    sections.flow = { total: items.length, items: o.full ? items : [] };
    if (!o.full && items.length > 0) summarized = true;
  }
  if (o.sections.includes('baseline') && rs.baselineCharacteristicsModule) {
    const items: unknown[] = rs.baselineCharacteristicsModule.measures ?? [];
    sections.baseline = { total: items.length, items: o.full ? items : [] };
    if (!o.full && items.length > 0) summarized = true;
  }

  if (o.full) {
    warnings.push({
      code: 'results_full',
      message: '결과 전체를 전개했습니다. 페이로드가 매우 클 수 있습니다.',
      id,
    });
  } else if (summarized) {
    warnings.push({
      code: 'results_summarized',
      message: '요약만 냈습니다. --outcome / --ae-organ / --ae-term 으로 필요한 항목만 전개하세요.',
      id,
    });
  }

  return { results: { id, registry: 'ctgov', hasResults: true, sections, fetchedAt }, warnings };
}
```

- [ ] **Step 6: 픽스처와 구현을 대조하고 필요하면 경로를 고친다**

Run: `bunx vitest run tests/adapters/ctgov/results.test.ts`

실패하면 픽스처의 실제 키 이름을 확인하고 **구현을 고친다**:

```bash
node -e "const j=require('./tests/fixtures/ctgov/study-results.json').resultsSection; console.log(JSON.stringify(Object.fromEntries(Object.entries(j).map(([k,v])=>[k,Object.keys(v)])),null,2))"
```

Expected (수정 후): PASS — 9 tests

- [ ] **Step 7: 커밋**

```bash
git add src/adapters/ctgov/client.ts src/adapters/ctgov/results.ts tests/adapters/ctgov/results.test.ts tests/fixtures/ctgov/study-results.json
git commit -m "feat(ctgov): client and filterable results extraction"
```

---

## Task 12: CT.gov 어댑터

**Files:**
- Create: `src/adapters/ctgov/adapter.ts`, `src/adapters/index.ts`
- Test: `tests/adapters/ctgov/adapter.test.ts`

**Interfaces:**
- Consumes: Task 4 `RegistryAdapter`/`Capability`/`AdapterResult`, Task 9 `buildSearchParams`/`buildIdsParams`, Task 10 `mapStudy`, Task 11 `makeClient`/`extractResults`, Task 3 `parseTrialId`
- Produces: `createCtgovAdapter(cfg: Config, deps?: HttpDeps): RegistryAdapter`, `CTGOV_CAPABILITY: Capability`, `src/adapters/index.ts` 의 `createAdapters(cfg: Config, deps?: HttpDeps): Record<RegistryKey, RegistryAdapter>`

- [ ] **Step 1: `RegistryAdapter.search` 반환에 `nextPageToken` 추가**

`src/core/capability.ts` 의 인터페이스를 고친다:

```ts
  search(
    q: NormalizedQuery,
    o: FetchOpts,
  ): Promise<AdapterResult<TrialRecord[]> & { total?: number; nextPageToken?: string }>;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/adapters/ctgov/adapter.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY, createCtgovAdapter } from '../../../src/adapters/ctgov/adapter.js';
import { CapabilitySchema } from '../../../src/core/capability.js';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';
import type { Config } from '../../../src/runtime/config.js';

const page = JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov/search-page.json'), 'utf8'));

let cfg: Config;
beforeEach(() => {
  cfg = {
    cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-adapter-')),
    cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 3, ratePerSec: 1000,
    ctgovBaseUrl: 'https://example.test/api/v2',
  };
});

const opts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off', raw: false,
};

const respond = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

const deps = (f: ReturnType<typeof respond>) => ({ fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

describe('CT.gov 어댑터', () => {
  it('capability 선언이 계약 스키마를 통과한다', () => {
    expect(() => CapabilitySchema.parse(CTGOV_CAPABILITY)).not.toThrow();
    expect(CTGOV_CAPABILITY.search.geoNeedsCoords).toBe(true);
  });

  it('search 는 레코드·총계·다음 커서를 낸다', async () => {
    const f = respond({ ...page, totalCount: 412, nextPageToken: 'tok-1' });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.search({ condition: 'NSCLC' }, opts);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.total).toBe(412);
    expect(r.nextPageToken).toBe('tok-1');
    expect(r.data[0]!.registry).toBe('ctgov');
  });

  it('search 는 쿼리 조립 경고를 그대로 올려보낸다', async () => {
    const f = respond({ studies: [], totalCount: 0 });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.search({ updatedSince: '2025-01-01' }, opts);
    expect(r.warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('count 는 페이로드를 받지 않는다 — pageSize 0', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ totalCount: 99 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const a = createCtgovAdapter(cfg, deps(f as unknown as ReturnType<typeof respond>));
    const r = await a.count({ condition: 'NSCLC' }, opts);
    expect(r.data).toBe(99);
    expect(seen[0]).toContain('pageSize=0');
    expect(seen[0]).toContain('countTotal=true');
  });

  it('get 은 배치 상한을 넘으면 여러 호출로 쪼갠다', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `NCT${String(i).padStart(8, '0')}`);
    const f = vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const a = createCtgovAdapter(cfg, deps(f as unknown as ReturnType<typeof respond>));
    await a.get(ids, opts);
    expect(f).toHaveBeenCalledTimes(2); // maxBatchIds 50
  });

  it('찾지 못한 ID 는 전체를 실패시키지 않고 경고가 된다', async () => {
    const f = respond({ studies: [] });
    const a = createCtgovAdapter(cfg, deps(f));
    const r = await a.get(['NCT00000001'], opts);
    expect(r.data).toHaveLength(0);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
    expect(r.warnings[0]!.id).toBe('CTGOV:NCT00000001');
  });

  it('다른 레지스트리의 ID 를 주면 거부한다', async () => {
    const a = createCtgovAdapter(cfg, deps(respond({ studies: [] })));
    await expect(a.get(['ISRCTN:12345678'], opts)).rejects.toMatchObject({ code: 'unsupported' });
  });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/adapter.test.ts`
Expected: FAIL — `adapter.js` 모듈 없음

- [ ] **Step 4: 최소 구현**

`src/adapters/ctgov/adapter.ts`:

```ts
import type { AdapterResult, Capability, RegistryAdapter, Warning } from '../../core/capability.js';
import type { FetchOpts, NormalizedQuery, ResultsOpts } from '../../core/query.js';
import type { TrialRecord, TrialResults } from '../../core/record.js';
import { formatTrialId, parseTrialId } from '../../core/registry.js';
import type { Config } from '../../runtime/config.js';
import { CtregError, unsupportedError } from '../../runtime/errors.js';
import type { HttpDeps } from '../../runtime/http.js';
import { makeClient } from './client.js';
import { mapStudy } from './map.js';
import { buildIdsParams, buildSearchParams } from './query.js';
import { extractResults } from './results.js';

export const CTGOV_CAPABILITY: Capability = {
  key: 'ctgov',
  name: 'ClinicalTrials.gov',
  region: 'US / global',
  search: {
    condition: true, intervention: true, term: true, title: true,
    sponsor: true, lead: true, location: true, id: true, patient: true,
    geo: true, geoNeedsCoords: true,
    status: true, phase: true, studyType: true, dateRange: true,
  },
  detail: { eligibilityText: true, outcomes: true, contacts: true },
  results: true,
  count: true,
  limits: { maxPageSize: 200, ratePerSec: 1, maxBatchIds: 50 },
};

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export function createCtgovAdapter(cfg: Config, deps: HttpDeps = {}): RegistryAdapter {
  const client = makeClient(cfg, deps);

  const toRegistryIds = (ids: string[]) =>
    ids.map((raw) => {
      const parsed = parseTrialId(raw);
      if (parsed.registry !== 'ctgov') {
        throw unsupportedError(
          `'${raw}' 는 ctgov 어댑터가 처리할 수 없습니다`,
          'ctreg registries 로 사용 가능한 레지스트리를 확인하세요.',
        );
      }
      return parsed.registryId;
    });

  return {
    key: 'ctgov',
    capability: () => CTGOV_CAPABILITY,

    async search(q: NormalizedQuery, o: FetchOpts) {
      const { params, warnings } = buildSearchParams(q, o);
      const res = await client.studies(params, o.cacheMode);
      warnings.push(...res.warnings);
      const studies = res.value.studies ?? [];
      const data: TrialRecord[] = [];
      for (const s of studies) {
        const m = mapStudy(s, o, res.fetchedAt);
        data.push(m.record);
        warnings.push(...m.warnings);
      }
      return {
        data,
        warnings,
        ...(res.value.totalCount !== undefined ? { total: res.value.totalCount } : {}),
        ...(res.value.nextPageToken ? { nextPageToken: res.value.nextPageToken } : {}),
      };
    },

    async get(ids: string[], o: FetchOpts): Promise<AdapterResult<TrialRecord[]>> {
      const registryIds = toRegistryIds(ids);
      const warnings: Warning[] = [];
      const data: TrialRecord[] = [];
      const found = new Set<string>();

      for (const batch of chunk(registryIds, CTGOV_CAPABILITY.limits.maxBatchIds)) {
        const res = await client.studies(buildIdsParams(batch, o), o.cacheMode);
        warnings.push(...res.warnings);
        for (const s of res.value.studies ?? []) {
          const m = mapStudy(s, o, res.fetchedAt);
          data.push(m.record);
          warnings.push(...m.warnings);
          found.add(m.record.registryId);
        }
      }

      for (const rid of registryIds) {
        if (!found.has(rid)) {
          warnings.push({
            code: 'not_found',
            message: 'ClinicalTrials.gov 에서 찾지 못했습니다.',
            id: formatTrialId('ctgov', rid),
          });
        }
      }
      return { data, warnings };
    },

    async results(id: string, o: ResultsOpts): Promise<AdapterResult<TrialResults>> {
      const [registryId] = toRegistryIds([id]);
      const res = await client.study(registryId!, {}, o.cacheMode);
      const out = extractResults(res.value, formatTrialId('ctgov', registryId!), o, res.fetchedAt);
      return { data: out.results, warnings: [...res.warnings, ...out.warnings] };
    },

    async count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>> {
      const { params, warnings } = buildSearchParams(q, o);
      // 페이로드를 받지 않는다. 개수만.
      const res = await client.studies({ ...params, pageSize: 0, fields: undefined, countTotal: 'true' }, o.cacheMode);
      return { data: res.value.totalCount ?? 0, warnings: [...warnings, ...res.warnings] };
    },
  };
}
```

`src/adapters/index.ts`:

```ts
import type { RegistryAdapter } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import type { Config } from '../runtime/config.js';
import type { HttpDeps } from '../runtime/http.js';
import { createCtgovAdapter } from './ctgov/adapter.js';

/** 두 번째 레지스트리를 붙이는 작업은 여기에 한 줄을 더하는 것으로 끝나야 한다. */
export function createAdapters(cfg: Config, deps: HttpDeps = {}): Record<RegistryKey, RegistryAdapter> {
  return { ctgov: createCtgovAdapter(cfg, deps) };
}
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/adapters/`
Expected: PASS — vocab 12 + query 14 + map 10 + results 9 + adapter 7 = 52 tests

- [ ] **Step 6: 커밋**

```bash
git add src/adapters src/core/capability.ts tests/adapters/ctgov/adapter.test.ts
git commit -m "feat(ctgov): RegistryAdapter implementation behind the seam"
```

---

## Task 13: 출력 봉투

봉투는 어댑터가 하나뿐이어도 **처음부터 다중 레지스트리 모양**이다. 나중에 형태가 바뀌면 플러그인 스킬이 깨진다.

**Files:**
- Create: `src/cli/output.ts`
- Test: `tests/cli/output.test.ts`

**Interfaces:**
- Consumes: Task 2 `EXIT`/`ExitCode`, Task 4 `Warning`, Task 3 `RegistryKey`
- Produces: 타입 `RegistryStatus` = `{ registry: RegistryKey; status: 'ok' | 'error' | 'unsupported'; total?: number; returned?: number; nextPageToken?: string; error?: { code: string; message: string } }`, 타입 `Envelope` = `{ query: unknown; registries: RegistryStatus[]; warnings: Warning[]; data: unknown; error?: { code: string; message: string; hint?: string } }`, `render(env: Envelope, format: 'json' | 'ndjson' | 'text'): string`, `exitFor(env: Envelope): ExitCode`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cli/output.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import { type Envelope, exitFor, render } from '../../src/cli/output.js';

const base: Envelope = {
  query: { condition: 'NSCLC' },
  registries: [{ registry: 'ctgov', status: 'ok', total: 412, returned: 2 }],
  warnings: [],
  data: [
    { id: 'CTGOV:NCT00000001', title: 'Study One', status: 'recruiting' },
    { id: 'CTGOV:NCT00000002', title: 'Study Two', status: 'completed' },
  ],
};

describe('출력 봉투', () => {
  it('json 은 봉투 전체를 한 덩어리로 낸다', () => {
    const parsed = JSON.parse(render(base, 'json'));
    expect(Object.keys(parsed)).toEqual(['query', 'registries', 'warnings', 'data']);
    expect(parsed.registries[0].total).toBe(412);
  });

  it('ndjson 은 배열 데이터를 한 줄에 하나씩 낸다', () => {
    const lines = render(base, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe('CTGOV:NCT00000001');
  });

  it('ndjson 은 배열이 아닌 데이터를 한 줄로 낸다', () => {
    const lines = render({ ...base, data: { total: 412 } }, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('text 는 사람이 읽는 형식이며 JSON 이 아니다', () => {
    const out = render(base, 'text');
    expect(out).toContain('CTGOV:NCT00000001');
    expect(out).toContain('Study One');
    expect(() => JSON.parse(out)).toThrow();
  });

  it('경고는 어떤 포맷에서도 사라지지 않는다', () => {
    const withWarn: Envelope = {
      ...base,
      warnings: [{ code: 'locations_truncated', message: '장소를 잘랐습니다.', id: 'CTGOV:NCT00000001', at: 10 }],
    };
    expect(JSON.parse(render(withWarn, 'json')).warnings).toHaveLength(1);
    expect(render(withWarn, 'text')).toContain('locations_truncated');
  });

  it('undefined 필드는 봉투에 넣지 않는다', () => {
    const parsed = JSON.parse(render(base, 'json'));
    expect(parsed.registries[0]).not.toHaveProperty('nextPageToken');
  });

  it('모든 레지스트리가 정상이면 exit 0 — 결과 0건도 정상이다', () => {
    expect(exitFor({ ...base, data: [] })).toBe(EXIT.OK);
  });

  it('일부만 실패하면 exit 5 다', () => {
    expect(
      exitFor({
        ...base,
        registries: [
          { registry: 'ctgov', status: 'ok', returned: 1 },
          { registry: 'ctgov', status: 'error', error: { code: 'upstream', message: 'boom' } },
        ],
      }),
    ).toBe(EXIT.PARTIAL);
  });

  it('전부 실패하면 exit 4 다', () => {
    expect(
      exitFor({
        ...base,
        registries: [{ registry: 'ctgov', status: 'error', error: { code: 'upstream', message: 'boom' } }],
      }),
    ).toBe(EXIT.UPSTREAM);
  });

  it('전부 미지원이면 exit 3 이다', () => {
    expect(
      exitFor({
        ...base,
        registries: [{ registry: 'ctgov', status: 'unsupported', error: { code: 'unsupported', message: 'no geo' } }],
      }),
    ).toBe(EXIT.UNSUPPORTED);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/cli/output.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/cli/output.ts`:

```ts
import type { Warning } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import { EXIT, type ExitCode } from './exit-codes.js';

export type RegistryStatus = {
  registry: RegistryKey;
  status: 'ok' | 'error' | 'unsupported';
  total?: number;
  returned?: number;
  nextPageToken?: string;
  error?: { code: string; message: string };
};

export type Envelope = {
  query: unknown;
  registries: RegistryStatus[];
  warnings: Warning[];
  data: unknown;
  error?: { code: string; message: string; hint?: string };
};

/** JSON.stringify 는 undefined 값을 자동으로 뺀다 — 봉투에 빈 필드가 남지 않는다. */
export function render(env: Envelope, format: 'json' | 'ndjson' | 'text'): string {
  if (format === 'json') return `${JSON.stringify(env, null, 2)}\n`;

  if (format === 'ndjson') {
    const rows = Array.isArray(env.data) ? env.data : [env.data];
    return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  const lines: string[] = [];
  for (const r of env.registries) {
    const counts = [
      r.total !== undefined ? `총 ${r.total}건` : undefined,
      r.returned !== undefined ? `표시 ${r.returned}건` : undefined,
    ].filter(Boolean).join(', ');
    lines.push(`[${r.registry}] ${r.status}${counts ? ` — ${counts}` : ''}`);
    if (r.error) lines.push(`  오류 ${r.error.code}: ${r.error.message}`);
  }
  if (env.error) lines.push(`오류 ${env.error.code}: ${env.error.message}${env.error.hint ? `\n  ${env.error.hint}` : ''}`);

  if (Array.isArray(env.data)) {
    for (const row of env.data as Record<string, unknown>[]) {
      lines.push('');
      lines.push(`${String(row.id ?? '')}  ${String(row.status ?? '')}`);
      lines.push(`  ${String(row.title ?? '')}`);
    }
  } else if (env.data !== undefined && env.data !== null) {
    lines.push('');
    lines.push(JSON.stringify(env.data, null, 2));
  }

  for (const w of env.warnings) {
    lines.push('');
    lines.push(`! ${w.code}${w.id ? ` (${w.id})` : ''}: ${w.message}`);
  }
  return `${lines.join('\n')}\n`;
}

export function exitFor(env: Envelope): ExitCode {
  const states = env.registries.map((r) => r.status);
  if (states.length === 0) return EXIT.OK;
  if (states.every((s) => s === 'ok')) return EXIT.OK;
  if (states.some((s) => s === 'ok')) return EXIT.PARTIAL;
  if (states.every((s) => s === 'unsupported')) return EXIT.UNSUPPORTED;
  return EXIT.UPSTREAM;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/cli/output.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: 커밋**

```bash
git add src/cli/output.ts tests/cli/output.test.ts
git commit -m "feat(cli): multi-registry envelope and exit resolution"
```

---

## Task 14: 인자 파싱 + capability 가드 + `registries` / `count`

capability 가드가 이 슬라이스의 안전 장치다. **미지원 축으로 요청하면 빈 결과가 아니라 exit 3 을 낸다.** 빈 결과를 내면 에이전트가 "해당 시험 없음"과 "이 레지스트리는 그렇게 못 찾음"을 구분하지 못하고, 그 혼동은 임상적으로 틀린 결론으로 사용자에게 전달된다.

**Files:**
- Create: `src/cli/args.ts`, `src/cli/guard.ts`, `src/cli/index.ts`, `src/cli/commands/registries.ts`, `src/cli/commands/count.ts`
- Test: `tests/cli/args.test.ts`, `tests/cli/guard.test.ts`, `tests/cli/run.test.ts`

**Interfaces:**
- Consumes: 전 태스크 전부
- Produces:
  - `args.ts`: 타입 `ParsedArgs` = `{ command: string; positionals: string[]; registries: RegistryKey[]; query: NormalizedQuery; fetch: FetchOpts; results: ResultsOpts; format: 'json' | 'ndjson' | 'text'; help: boolean }`, `parseCliArgs(argv: string[]): ParsedArgs`, `USAGE: string`
  - `guard.ts`: `assertSupported(cap: Capability, q: NormalizedQuery, fetch: FetchOpts): void`
  - `index.ts`: 타입 `Io` = `{ stdout(s: string): void; stderr(s: string): void }`, 타입 `RunDeps` = `{ adapters?: Record<RegistryKey, RegistryAdapter>; http?: HttpDeps }`, `run(argv: string[], io: Io, env?: NodeJS.ProcessEnv, deps?: RunDeps): Promise<ExitCode>`
  - `commands/registries.ts`: `runRegistries(args: ParsedArgs, adapters: Record<RegistryKey, RegistryAdapter>): Envelope`
  - `commands/count.ts`: `runCount(args: ParsedArgs, adapters: Record<RegistryKey, RegistryAdapter>): Promise<Envelope>`

- [ ] **Step 1: 실패하는 인자 파싱 테스트 작성**

`tests/cli/args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../src/cli/args.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { CtregError } from '../../src/runtime/errors.js';

const expectUsage = (fn: () => unknown, hintFragment?: string) => {
  try {
    fn();
    expect.unreachable('던져야 한다');
  } catch (e) {
    expect((e as CtregError).exit).toBe(EXIT.USAGE);
    if (hintFragment) expect(`${(e as CtregError).hint} ${(e as CtregError).message}`).toContain(hintFragment);
  }
};

describe('인자 파싱', () => {
  it('커맨드와 검색 축을 읽는다', () => {
    const a = parseCliArgs(['search', '--condition', 'NSCLC', '--lead', 'Merck']);
    expect(a.command).toBe('search');
    expect(a.query.condition).toBe('NSCLC');
    expect(a.query.lead).toBe('Merck');
  });

  it('폐쇄 어휘 값을 검증한다', () => {
    expect(parseCliArgs(['search', '--status', 'recruiting']).query.status).toEqual(['recruiting']);
    expectUsage(() => parseCliArgs(['search', '--status', 'RECRUITING']), 'recruiting');
    expectUsage(() => parseCliArgs(['search', '--status', 'unknown']));
  });

  it('상태와 phase 는 반복 지정할 수 있다', () => {
    const a = parseCliArgs(['search', '--status', 'recruiting', '--status', 'completed']);
    expect(a.query.status).toEqual(['recruiting', 'completed']);
  });

  it('--near 는 좌표만 받는다 — 지명은 exit 2', () => {
    expect(parseCliArgs(['search', '--near', '37.5665,126.978']).query.near).toEqual({ lat: 37.5665, lon: 126.978 });
    expectUsage(() => parseCliArgs(['search', '--near', 'Seoul']), '좌표');
  });

  it('--radius 는 단위를 요구한다 — 접미사가 없으면 업스트림이 미터로 읽는다', () => {
    expect(parseCliArgs(['search', '--near', '37.5,127.0', '--radius', '100km']).query.radius)
      .toEqual({ value: 100, unit: 'km' });
    expectUsage(() => parseCliArgs(['search', '--near', '37.5,127.0', '--radius', '100']), 'km');
  });

  it('--radius 만 있으면 exit 2 다', () => {
    expectUsage(() => parseCliArgs(['search', '--radius', '100km']), '--near');
  });

  it('--include 는 알려진 섹션만 받는다', () => {
    expect(parseCliArgs(['search', '--include', 'eligibility']).fetch.include).toContain('eligibility');
    expectUsage(() => parseCliArgs(['search', '--include', 'everything']));
  });

  it('--eligibility-chars 는 --include eligibility 를 요구하고 상한이 있다', () => {
    expectUsage(() => parseCliArgs(['search', '--eligibility-chars', '100']), '--include eligibility');
    expect(parseCliArgs(['search', '--include', 'eligibility', '--eligibility-chars', '100']).fetch.caps.eligibilityChars).toBe(100);
    expectUsage(() => parseCliArgs(['search', '--include', 'eligibility', '--eligibility-chars', '999999']));
  });

  it('--no-cache 와 --refresh 는 캐시 모드를 바꾼다', () => {
    expect(parseCliArgs(['search']).fetch.cacheMode).toBe('use');
    expect(parseCliArgs(['search', '--no-cache']).fetch.cacheMode).toBe('off');
    expect(parseCliArgs(['search', '--refresh']).fetch.cacheMode).toBe('refresh');
    expectUsage(() => parseCliArgs(['search', '--no-cache', '--refresh']));
  });

  it('--format 은 세 값만 받는다', () => {
    expect(parseCliArgs(['search']).format).toBe('json');
    expectUsage(() => parseCliArgs(['search', '--format', 'yaml']));
  });

  it('--registry 는 등록된 키만 받는다', () => {
    expect(parseCliArgs(['search']).registries).toEqual(['ctgov']);
    expectUsage(() => parseCliArgs(['search', '--registry', 'ictrp']), 'ctreg registries');
  });

  it('results 커맨드의 필터를 읽는다', () => {
    const a = parseCliArgs(['results', 'CTGOV:NCT01234567', '--outcome', 'PFS', '--ae-organ', 'cardiac', '--section', 'outcomes']);
    expect(a.positionals).toEqual(['CTGOV:NCT01234567']);
    expect(a.results.outcomeFilter).toEqual(['PFS']);
    expect(a.results.aeOrganFilter).toBe('cardiac');
    expect(a.results.sections).toEqual(['outcomes']);
  });

  it('모르는 플래그는 조용히 무시하지 않고 exit 2 다', () => {
    expectUsage(() => parseCliArgs(['search', '--bogus', 'x']));
  });

  it('커맨드가 없거나 모르는 커맨드면 exit 2 다', () => {
    expectUsage(() => parseCliArgs([]));
    expectUsage(() => parseCliArgs(['landscape']), 'search');
  });
});
```

- [ ] **Step 2: 실패하는 가드 테스트 작성**

`tests/cli/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { assertSupported } from '../../src/cli/guard.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { CAPS, type FetchOpts } from '../../src/core/query.js';
import type { Capability } from '../../src/core/capability.js';
import type { CtregError } from '../../src/runtime/errors.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use', raw: false,
};

const limited: Capability = {
  ...CTGOV_CAPABILITY,
  search: { ...CTGOV_CAPABILITY.search, geo: false, patient: false, dateRange: false },
  detail: { ...CTGOV_CAPABILITY.detail, eligibilityText: false },
};

const expectUnsupported = (fn: () => unknown, fragment: string) => {
  try {
    fn();
    expect.unreachable('던져야 한다');
  } catch (e) {
    expect((e as CtregError).exit).toBe(EXIT.UNSUPPORTED);
    expect((e as CtregError).message).toContain(fragment);
  }
};

describe('capability 가드', () => {
  it('지원되는 축은 통과시킨다', () => {
    expect(() => assertSupported(CTGOV_CAPABILITY, { condition: 'NSCLC', patient: 'x' }, fetchOpts)).not.toThrow();
  });

  it('미지원 검색 축은 빈 결과가 아니라 exit 3 이다', () => {
    expectUnsupported(() => assertSupported(limited, { patient: '62 year old' }, fetchOpts), 'patient');
    expectUnsupported(() => assertSupported(limited, { near: { lat: 37, lon: 127 } }, fetchOpts), 'geo');
    expectUnsupported(() => assertSupported(limited, { updatedSince: '2025-01-01' }, fetchOpts), 'dateRange');
  });

  it('미지원 detail 섹션도 exit 3 이다', () => {
    expectUnsupported(
      () => assertSupported(limited, {}, { ...fetchOpts, include: ['core', 'eligibility'] }),
      'eligibilityText',
    );
  });

  it('좌표를 요구하는 어댑터에 지명을 넘길 수 없다는 사실은 인자 파싱이 이미 막는다', () => {
    expect(CTGOV_CAPABILITY.search.geoNeedsCoords).toBe(true);
  });
});
```

- [ ] **Step 3: 실패하는 실행 테스트 작성**

`tests/cli/run.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import { run } from '../../src/cli/index.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-run-')), CTREG_RATE_PER_SEC: '1000' });

const stubFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('run()', () => {
  it('registries 는 네트워크 없이 capability 를 낸다', async () => {
    const c = capture();
    const f = stubFetch({});
    const code = await run(['registries'], c.io, env(), { http: { fetchImpl: f as unknown as typeof fetch } });
    expect(code).toBe(EXIT.OK);
    expect(f).not.toHaveBeenCalled();
    const parsed = JSON.parse(c.out());
    expect(parsed.data[0].key).toBe('ctgov');
    expect(parsed.data[0].search.geoNeedsCoords).toBe(true);
  });

  it('count 는 개수만 낸다', async () => {
    const c = capture();
    const f = stubFetch({ totalCount: 412 });
    const code = await run(['count', '--condition', 'NSCLC'], c.io, env(), {
      http: { fetchImpl: f as unknown as typeof fetch, sleep: async () => {} },
    });
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(c.out()).data).toEqual({ total: 412 });
  });

  it('모르는 커맨드는 exit 2 이고 사용법은 stderr 로 간다', async () => {
    const c = capture();
    const code = await run(['landscape'], c.io, env());
    expect(code).toBe(EXIT.USAGE);
    expect(c.err()).toContain('search');
    expect(c.out()).toBe('');
  });

  it('오류도 봉투 모양으로 stdout 에 나가고 힌트를 담는다', async () => {
    const c = capture();
    const code = await run(['search', '--radius', '100km'], c.io, env());
    expect(code).toBe(EXIT.USAGE);
    const parsed = JSON.parse(c.out());
    expect(parsed.error.code).toBe('usage');
    expect(parsed.error.hint).toContain('--near');
  });

  it('--help 는 exit 0 이고 사용법을 stdout 에 낸다', async () => {
    const c = capture();
    expect(await run(['--help'], c.io, env())).toBe(EXIT.OK);
    expect(c.out()).toContain('ctreg search');
  });

  it('로그는 stdout 을 오염시키지 않는다 — stdout 은 항상 파싱 가능해야 한다', async () => {
    const c = capture();
    await run(['registries'], c.io, env());
    expect(() => JSON.parse(c.out())).not.toThrow();
  });
});
```

- [ ] **Step 4: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/cli/`
Expected: FAIL — `args.js` / `guard.js` / `index.js` 모듈 없음

- [ ] **Step 5: 인자 파싱 구현**

`src/cli/args.ts`:

```ts
import { parseArgs } from 'node:util';
import { CAPS, type FetchOpts, type IncludeSection, type NormalizedQuery, type ResultsOpts } from '../core/query.js';
import { REGISTRY_KEYS, type RegistryKey, isRegistryKey } from '../core/registry.js';
import {
  STUDY_TYPE, isFilterablePhase, isFilterableStatus,
  type StudyType, type TrialPhase, type TrialStatus,
} from '../core/vocab.js';
import { usageError } from '../runtime/errors.js';

export const COMMANDS = ['search', 'get', 'results', 'count', 'registries'] as const;

export const USAGE = `ctreg — 임상시험 레지스트리를 하나의 스키마로 조회한다

  ctreg search  [검색 축] [필터] [출력]
  ctreg get     <ID...> [출력]
  ctreg results <ID> [--section s] [--outcome q] [--ae-organ q] [--ae-term q] [--full]
  ctreg count   [search 와 동일한 필터]
  ctreg registries

검색 축   --condition --intervention --term --title --location --outcome-query
          --sponsor --lead --id --patient
필터      --status --phase --study-type (반복 가능)
          --near <lat,lon> --radius <N>km|mi
          --updated-since --updated-before --start-after --start-before
          --completion-after --completion-before   (YYYY-MM-DD)
출력      --registry <key> --include <section> --page-size <N> --page-token <t>
          --sort <field> --eligibility-chars <N> --raw
          --format json|ndjson|text --no-cache --refresh

exit: 0 정상 · 2 사용법 · 3 미지원 · 4 업스트림 · 5 부분 실패
`;

const INCLUDE_SECTIONS: IncludeSection[] = ['core', 'eligibility', 'outcomes', 'contacts', 'locations', 'all'];
const RESULT_SECTIONS = ['outcomes', 'adverse', 'flow', 'baseline'] as const;

export type ParsedArgs = {
  command: (typeof COMMANDS)[number];
  positionals: string[];
  registries: RegistryKey[];
  query: NormalizedQuery;
  fetch: FetchOpts;
  results: ResultsOpts;
  format: 'json' | 'ndjson' | 'text';
  help: boolean;
};

const str = { type: 'string' } as const;
const multi = { type: 'string', multiple: true } as const;
const flag = { type: 'boolean' } as const;

const OPTIONS = {
  condition: str, intervention: str, term: str, title: str, location: str,
  'outcome-query': str, sponsor: str, lead: str, id: str, patient: str,
  status: multi, phase: multi, 'study-type': str,
  near: str, radius: str,
  'updated-since': str, 'updated-before': str,
  'start-after': str, 'start-before': str,
  'completion-after': str, 'completion-before': str,
  registry: multi, include: multi,
  'page-size': str, 'page-token': str, sort: str,
  'eligibility-chars': str, raw: flag,
  format: str, 'no-cache': flag, refresh: flag,
  section: multi, outcome: multi, 'ae-organ': str, 'ae-term': str, full: flag,
  help: flag,
} as const;

function intOpt(raw: string | undefined, name: string, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw usageError(`${name} 은 0 이상의 정수여야 합니다: '${raw}'`);
  if (n > max) throw usageError(`${name} 의 상한은 ${max} 입니다`, `${name} ${max} 이하로 주세요.`);
  return n;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (cause) {
    throw usageError((cause as Error).message, USAGE);
  }
  const v = parsed.values;
  const [command, ...positionals] = parsed.positionals;

  if (v.help) {
    return {
      command: 'registries', positionals: [], registries: [...REGISTRY_KEYS],
      query: {}, fetch: baseFetch(), results: baseResults(), format: 'json', help: true,
    };
  }
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw usageError(command ? `모르는 커맨드: '${command}'` : '커맨드가 없습니다', USAGE);
  }

  // --- 출력 ---
  const format = (v.format ?? 'json') as ParsedArgs['format'];
  if (!['json', 'ndjson', 'text'].includes(format)) {
    throw usageError(`--format 은 json|ndjson|text 중 하나입니다: '${format}'`);
  }
  if (v['no-cache'] && v.refresh) throw usageError('--no-cache 와 --refresh 는 함께 쓸 수 없습니다');
  const cacheMode: FetchOpts['cacheMode'] = v['no-cache'] ? 'off' : v.refresh ? 'refresh' : 'use';

  const registries = (v.registry ?? [...REGISTRY_KEYS]) as string[];
  for (const r of registries) {
    if (!isRegistryKey(r)) {
      throw usageError(`모르는 레지스트리: '${r}'`, 'ctreg registries 로 사용 가능한 키를 확인하세요.');
    }
  }

  const include = (v.include ?? ['core']) as string[];
  for (const s of include) {
    if (!(INCLUDE_SECTIONS as string[]).includes(s)) {
      throw usageError(`모르는 --include 섹션: '${s}'`, `가능: ${INCLUDE_SECTIONS.join(', ')}`);
    }
  }
  if (!include.includes('core')) include.unshift('core');

  const eligibilityChars = intOpt(v['eligibility-chars'], '--eligibility-chars', CAPS.eligibilityChars.max);
  if (eligibilityChars !== undefined && !include.includes('eligibility') && !include.includes('all')) {
    throw usageError('--eligibility-chars 는 --include eligibility 와 함께 써야 합니다');
  }

  // --- 어휘 ---
  const status = (v.status ?? []).map((s) => {
    if (!isFilterableStatus(s)) {
      throw usageError(`--status 값이 잘못되었습니다: '${s}'`, "소문자 공통 어휘를 쓰세요 (예: recruiting). 'unknown'/'other' 는 검색 조건이 아닙니다.");
    }
    return s as TrialStatus;
  });
  const phase = (v.phase ?? []).map((p) => {
    if (!isFilterablePhase(p)) throw usageError(`--phase 값이 잘못되었습니다: '${p}'`, '예: phase_3');
    return p as TrialPhase;
  });
  let studyType: StudyType | undefined;
  if (v['study-type']) {
    if (!(STUDY_TYPE as readonly string[]).includes(v['study-type'])) {
      throw usageError(`--study-type 값이 잘못되었습니다: '${v['study-type']}'`, `가능: ${STUDY_TYPE.join(', ')}`);
    }
    studyType = v['study-type'] as StudyType;
  }

  // --- 지오 ---
  let near: { lat: number; lon: number } | undefined;
  if (v.near) {
    const m = v.near.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) {
      throw usageError(
        `--near 는 좌표만 받습니다: '${v.near}'`,
        '지명을 좌표로 바꾸는 기능은 없습니다. --near 37.5665,126.978 처럼 위도,경도를 주세요.',
      );
    }
    near = { lat: Number(m[1]), lon: Number(m[2]) };
  }
  let radius: { value: number; unit: 'km' | 'mi' } | undefined;
  if (v.radius) {
    const m = v.radius.match(/^(\d+(?:\.\d+)?)(km|mi)$/i);
    if (!m) {
      throw usageError(
        `--radius 는 단위가 필요합니다: '${v.radius}'`,
        '접미사가 없으면 업스트림이 미터로 읽습니다. 예: 100km, 50mi',
      );
    }
    radius = { value: Number(m[1]), unit: m[2]!.toLowerCase() as 'km' | 'mi' };
  }
  if (radius && !near) throw usageError('--radius 는 --near 없이 쓸 수 없습니다', '--near <lat,lon> 으로 중심 좌표를 주세요.');

  const query: NormalizedQuery = {
    condition: v.condition, intervention: v.intervention, term: v.term, title: v.title,
    location: v.location, outcomeQuery: v['outcome-query'], sponsor: v.sponsor,
    lead: v.lead, id: v.id, patient: v.patient,
    ...(status.length ? { status } : {}),
    ...(phase.length ? { phase } : {}),
    ...(studyType ? { studyType } : {}),
    ...(near ? { near } : {}),
    ...(radius ? { radius } : {}),
    updatedSince: v['updated-since'], updatedBefore: v['updated-before'],
    startAfter: v['start-after'], startBefore: v['start-before'],
    completionAfter: v['completion-after'], completionBefore: v['completion-before'],
    pageSize: intOpt(v['page-size'], '--page-size', CAPS.pageSize.max),
    pageToken: v['page-token'],
    sort: v.sort,
  };

  const sections = (v.section ?? [...RESULT_SECTIONS]) as string[];
  for (const s of sections) {
    if (!(RESULT_SECTIONS as readonly string[]).includes(s)) {
      throw usageError(`모르는 --section: '${s}'`, `가능: ${RESULT_SECTIONS.join(', ')}`);
    }
  }

  return {
    command: command as ParsedArgs['command'],
    positionals,
    registries: registries as RegistryKey[],
    query,
    fetch: {
      include: include as IncludeSection[],
      caps: {
        locations: CAPS.locations.default,
        eligibilityChars: eligibilityChars ?? CAPS.eligibilityChars.default,
        outcomes: CAPS.outcomes.default,
      },
      cacheMode,
      raw: v.raw ?? false,
      ...(near ? { near } : {}),
    },
    results: {
      sections: sections as ResultsOpts['sections'],
      ...(v.outcome ? { outcomeFilter: v.outcome } : {}),
      ...(v['ae-organ'] ? { aeOrganFilter: v['ae-organ'] } : {}),
      ...(v['ae-term'] ? { aeTermFilter: v['ae-term'] } : {}),
      full: v.full ?? false,
      cacheMode,
    },
    format,
    help: false,
  };
}

const baseFetch = (): FetchOpts => ({
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
});
const baseResults = (): ResultsOpts => ({ sections: [...RESULT_SECTIONS], full: false, cacheMode: 'use' });
```

- [ ] **Step 6: 가드 구현**

`src/cli/guard.ts`:

```ts
import type { Capability } from '../core/capability.js';
import type { FetchOpts, NormalizedQuery } from '../core/query.js';
import { unsupportedError } from '../runtime/errors.js';

/**
 * 미지원 축을 조용히 무시하고 빈 결과를 내면, 에이전트가 "해당 시험 없음"과
 * "이 레지스트리는 그렇게 검색할 수 없음"을 구분하지 못한다. 반드시 exit 3 으로 알린다.
 */
export function assertSupported(cap: Capability, q: NormalizedQuery, fetch: FetchOpts): void {
  const axes: [keyof Capability['search'], boolean][] = [
    ['condition', q.condition !== undefined],
    ['intervention', q.intervention !== undefined],
    ['term', q.term !== undefined],
    ['title', q.title !== undefined],
    ['location', q.location !== undefined],
    ['sponsor', q.sponsor !== undefined],
    ['lead', q.lead !== undefined],
    ['id', q.id !== undefined],
    ['patient', q.patient !== undefined],
    ['status', (q.status?.length ?? 0) > 0],
    ['phase', (q.phase?.length ?? 0) > 0],
    ['studyType', q.studyType !== undefined],
    ['geo', q.near !== undefined],
    ['dateRange',
      [q.updatedSince, q.updatedBefore, q.startAfter, q.startBefore, q.completionAfter, q.completionBefore]
        .some((d) => d !== undefined)],
  ];

  for (const [axis, used] of axes) {
    if (used && !cap.search[axis]) {
      throw unsupportedError(
        `${cap.name} 은 '${axis}' 검색을 지원하지 않습니다`,
        `ctreg registries 로 이 레지스트리가 지원하는 축을 확인하세요. 결과가 없는 것이 아니라 조회 자체가 불가능합니다.`,
      );
    }
  }

  const wantAll = fetch.include.includes('all');
  const detailAxes: [keyof Capability['detail'], boolean][] = [
    ['eligibilityText', wantAll || fetch.include.includes('eligibility')],
    ['outcomes', wantAll || fetch.include.includes('outcomes')],
    ['contacts', wantAll || fetch.include.includes('contacts')],
  ];
  for (const [axis, used] of detailAxes) {
    if (used && !cap.detail[axis]) {
      throw unsupportedError(
        `${cap.name} 은 '${axis}' 를 제공하지 않습니다`,
        'ctreg registries 로 제공 섹션을 확인하세요.',
      );
    }
  }
}
```

- [ ] **Step 7: `registries` / `count` 커맨드와 진입점 구현**

`src/cli/commands/registries.ts`:

```ts
import type { RegistryAdapter } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import type { ParsedArgs } from '../args.js';
import type { Envelope } from '../output.js';

export function runRegistries(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Envelope {
  const caps = args.registries.map((k) => adapters[k].capability());
  return {
    query: { registries: args.registries },
    registries: args.registries.map((k) => ({ registry: k, status: 'ok' as const })),
    warnings: [],
    data: caps,
  };
}
```

`src/cli/commands/count.ts`:

```ts
import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { assertSupported } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

export async function runCount(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  let total = 0;

  for (const key of args.registries) {
    const adapter = adapters[key];
    try {
      assertSupported(adapter.capability(), args.query, args.fetch);
      const r = await adapter.count(args.query, args.fetch);
      warnings.push(...r.warnings);
      total += r.data;
      registries.push({ registry: key, status: 'ok', total: r.data });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message },
      });
    }
  }
  return { query: args.query, registries, warnings, data: { total } };
}
```

`src/cli/index.ts`:

```ts
import { createAdapters } from '../adapters/index.js';
import type { RegistryAdapter } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import { loadConfig } from '../runtime/config.js';
import { CtregError, usageError } from '../runtime/errors.js';
import type { HttpDeps } from '../runtime/http.js';
import { USAGE, parseCliArgs } from './args.js';
import { runCount } from './commands/count.js';
import { runRegistries } from './commands/registries.js';
import { EXIT, type ExitCode } from './exit-codes.js';
import { type Envelope, exitFor, render } from './output.js';

export type Io = { stdout(s: string): void; stderr(s: string): void };
export type RunDeps = { adapters?: Record<RegistryKey, RegistryAdapter>; http?: HttpDeps };

export async function run(
  argv: string[],
  io: Io,
  env: NodeJS.ProcessEnv = process.env,
  deps: RunDeps = {},
): Promise<ExitCode> {
  let format: 'json' | 'ndjson' | 'text' = 'json';
  try {
    const args = parseCliArgs(argv);
    format = args.format;
    if (args.help) {
      io.stdout(USAGE);
      return EXIT.OK;
    }

    const cfg = loadConfig(env);
    const adapters = deps.adapters ?? createAdapters(cfg, deps.http);

    // Task 15 에서 search / get / results 케이스를 여기에 더한다.
    let env2: Envelope;
    switch (args.command) {
      case 'registries': env2 = runRegistries(args, adapters); break;
      case 'count': env2 = await runCount(args, adapters); break;
      default:
        throw usageError(`'${args.command}' 는 아직 연결되지 않았습니다`, USAGE);
    }

    io.stdout(render(env2, format));
    return exitFor(env2);
  } catch (e) {
    const err = CtregError.is(e)
      ? { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }
      : { code: 'internal', message: (e as Error).message };
    const envelope: Envelope = { query: {}, registries: [], warnings: [], data: null, error: err };
    io.stdout(render(envelope, format));
    // 사용법은 사람이 읽는 것이므로 stderr 로. stdout 은 항상 파싱 가능해야 한다.
    if (err.code === 'usage') io.stderr(`${err.message}\n\n${USAGE}`);
    return CtregError.is(e) ? e.exit : EXIT.UPSTREAM;
  }
}
```

`src/cli/bin.ts` (`package.json` 의 `bin` 이 가리킬 실제 진입점 — `dist/cli/bin.js` 로 `bin` 경로를 고친다):

```ts
#!/usr/bin/env node
import { run } from './index.js';

const code = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exitCode = code;
```

- [ ] **Step 8: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/cli/`
Expected: PASS — args 15 + guard 4 + output 10 + run 6 = 35 tests

`search` / `get` / `results` 는 Task 15 에서 연결한다. 이 태스크는 그 없이도 독립적으로 통과한다.

- [ ] **Step 9: 커밋**

```bash
git add src/cli tests/cli
git commit -m "feat(cli): argument parsing, capability guard, entry point"
```

---

## Task 15: `search` · `get` · `results` 커맨드

**Files:**
- Create: `src/cli/commands/search.ts`, `src/cli/commands/get.ts`, `src/cli/commands/results.ts`
- Modify: `src/cli/index.ts` — switch 에 세 케이스 추가, `usageError` import 제거
- Test: `tests/cli/commands.test.ts`

**Interfaces:**
- Consumes: Task 4 `RegistryAdapter`/`AdapterResult`, Task 13 `Envelope`/`RegistryStatus`, Task 14 `ParsedArgs`/`assertSupported`, Task 3 `parseTrialId`
- Produces: `runSearch(args, adapters): Promise<Envelope>`, `runGet(args, adapters): Promise<Envelope>`, `runResults(args, adapters): Promise<Envelope>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cli/commands.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { CTGOV_CAPABILITY } from '../../src/adapters/ctgov/adapter.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { runGet } from '../../src/cli/commands/get.js';
import { runResults } from '../../src/cli/commands/results.js';
import { runSearch } from '../../src/cli/commands/search.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { exitFor } from '../../src/cli/output.js';
import type { Capability, RegistryAdapter } from '../../src/core/capability.js';
import type { TrialRecord } from '../../src/core/record.js';

const record = (n: string): TrialRecord => ({
  id: `CTGOV:${n}`, registry: 'ctgov', registryId: n,
  url: `https://clinicaltrials.gov/study/${n}`,
  title: `Study ${n}`, status: 'recruiting', conditions: ['X'],
  fetchedAt: '2026-08-22T00:00:00.000Z',
});

function stubAdapter(over: Partial<RegistryAdapter> = {}, cap: Capability = CTGOV_CAPABILITY): Record<'ctgov', RegistryAdapter> {
  return {
    ctgov: {
      key: 'ctgov',
      capability: () => cap,
      search: vi.fn(async () => ({ data: [record('NCT00000001')], warnings: [], total: 1, nextPageToken: 'tok' })),
      get: vi.fn(async () => ({ data: [record('NCT00000001')], warnings: [] })),
      results: vi.fn(async () => ({
        data: { id: 'CTGOV:NCT00000001', registry: 'ctgov' as const, hasResults: true, sections: {}, fetchedAt: '2026-08-22T00:00:00.000Z' },
        warnings: [],
      })),
      count: vi.fn(async () => ({ data: 1, warnings: [] })),
      ...over,
    } as RegistryAdapter,
  };
}

describe('search 커맨드', () => {
  it('레코드와 레지스트리 상태·커서를 봉투에 담는다', async () => {
    const env = await runSearch(parseCliArgs(['search', '--condition', 'NSCLC']), stubAdapter());
    expect(env.data).toHaveLength(1);
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'ok', total: 1, returned: 1, nextPageToken: 'tok' });
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('결과 0건은 오류가 아니다', async () => {
    const adapters = stubAdapter({ search: vi.fn(async () => ({ data: [], warnings: [], total: 0 })) });
    const env = await runSearch(parseCliArgs(['search', '--condition', 'zzz']), adapters);
    expect(env.data).toHaveLength(0);
    expect(exitFor(env)).toBe(EXIT.OK);
  });

  it('미지원 축은 조회하지 않고 unsupported 로 표시한다', async () => {
    const cap: Capability = { ...CTGOV_CAPABILITY, search: { ...CTGOV_CAPABILITY.search, patient: false } };
    const adapters = stubAdapter({}, cap);
    const env = await runSearch(parseCliArgs(['search', '--patient', '62 year old']), adapters);
    expect(env.registries[0]!.status).toBe('unsupported');
    expect(adapters.ctgov.search).not.toHaveBeenCalled();
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  it('어댑터 경고를 봉투로 끌어올린다', async () => {
    const adapters = stubAdapter({
      search: vi.fn(async () => ({ data: [], warnings: [{ code: 'date_filter_excludes_missing', message: 'm' }], total: 0 })),
    });
    const env = await runSearch(parseCliArgs(['search', '--updated-since', '2025-01-01']), adapters);
    expect(env.warnings.map((w) => w.code)).toContain('date_filter_excludes_missing');
  });

  it('업스트림 실패는 해당 레지스트리만 error 로 만든다', async () => {
    const { upstreamError } = await import('../../src/runtime/errors.js');
    const adapters = stubAdapter({ search: vi.fn(async () => { throw upstreamError('boom'); }) });
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X']), adapters);
    expect(env.registries[0]!.status).toBe('error');
    expect(exitFor(env)).toBe(EXIT.UPSTREAM);
  });
});

describe('get 커맨드', () => {
  it('위치 인자를 ID 로 받는다', async () => {
    const adapters = stubAdapter();
    const env = await runGet(parseCliArgs(['get', 'NCT00000001', 'CTGOV:NCT00000002']), adapters);
    expect(adapters.ctgov.get).toHaveBeenCalledWith(['CTGOV:NCT00000001', 'CTGOV:NCT00000002'], expect.anything());
    expect(env.data).toHaveLength(1);
  });

  it('ID 가 없으면 exit 2 다', async () => {
    await expect(runGet(parseCliArgs(['get']), stubAdapter())).rejects.toMatchObject({ exit: EXIT.USAGE });
  });

  it('ID 를 레지스트리별로 나눠 해당 어댑터에만 보낸다', async () => {
    const adapters = stubAdapter();
    await runGet(parseCliArgs(['get', 'NCT00000001']), adapters);
    expect(adapters.ctgov.get).toHaveBeenCalledTimes(1);
  });
});

describe('results 커맨드', () => {
  it('ID 하나를 받아 TrialResults 를 낸다', async () => {
    const env = await runResults(parseCliArgs(['results', 'NCT00000001', '--outcome', 'PFS']), stubAdapter());
    expect((env.data as { id: string }).id).toBe('CTGOV:NCT00000001');
  });

  it('ID 가 정확히 하나가 아니면 exit 2 다', async () => {
    await expect(runResults(parseCliArgs(['results']), stubAdapter())).rejects.toMatchObject({ exit: EXIT.USAGE });
    await expect(runResults(parseCliArgs(['results', 'NCT00000001', 'NCT00000002']), stubAdapter()))
      .rejects.toMatchObject({ exit: EXIT.USAGE });
  });

  it('results 를 제공하지 않는 레지스트리면 exit 3 이다', async () => {
    const cap: Capability = { ...CTGOV_CAPABILITY, results: false };
    await expect(runResults(parseCliArgs(['results', 'NCT00000001']), stubAdapter({}, cap)))
      .rejects.toMatchObject({ exit: EXIT.UNSUPPORTED });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/cli/commands.test.ts`
Expected: FAIL — `search.js` / `get.js` / `results.js` 모듈 없음

- [ ] **Step 3: `search` 구현**

`src/cli/commands/search.ts`:

```ts
import type { RegistryAdapter, Warning } from '../../core/capability.js';
import type { RegistryKey } from '../../core/registry.js';
import type { TrialRecord } from '../../core/record.js';
import { CtregError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import { assertSupported } from '../guard.js';
import type { Envelope, RegistryStatus } from '../output.js';

export async function runSearch(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  const data: TrialRecord[] = [];

  for (const key of args.registries) {
    const adapter = adapters[key];
    try {
      // 가드가 먼저다. 미지원 축이면 네트워크를 치지 않는다.
      assertSupported(adapter.capability(), args.query, args.fetch);
      const r = await adapter.search(args.query, args.fetch);
      warnings.push(...r.warnings);
      data.push(...r.data);
      registries.push({
        registry: key,
        status: 'ok',
        returned: r.data.length,
        ...(r.total !== undefined ? { total: r.total } : {}),
        ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
      });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message },
      });
    }
  }
  return { query: args.query, registries, warnings, data };
}
```

- [ ] **Step 4: `get` 구현**

`src/cli/commands/get.ts`:

```ts
import type { RegistryAdapter, Warning } from '../../core/capability.js';
import { parseTrialId, type RegistryKey } from '../../core/registry.js';
import type { TrialRecord } from '../../core/record.js';
import { CtregError, usageError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import type { Envelope, RegistryStatus } from '../output.js';

export async function runGet(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  if (args.positionals.length === 0) {
    throw usageError('get 은 ID 를 하나 이상 요구합니다', 'ctreg get CTGOV:NCT01234567 [ID...]');
  }

  // ID 를 레지스트리별로 나눈다 — 각 어댑터는 자기 것만 받는다.
  const byRegistry = new Map<RegistryKey, string[]>();
  for (const raw of args.positionals) {
    const { registry, id } = parseTrialId(raw);
    byRegistry.set(registry, [...(byRegistry.get(registry) ?? []), id]);
  }

  const registries: RegistryStatus[] = [];
  const warnings: Warning[] = [];
  const data: TrialRecord[] = [];

  for (const [key, ids] of byRegistry) {
    const adapter = adapters[key];
    try {
      const r = await adapter.get(ids, args.fetch);
      warnings.push(...r.warnings);
      data.push(...r.data);
      registries.push({ registry: key, status: 'ok', returned: r.data.length });
    } catch (e) {
      if (!CtregError.is(e)) throw e;
      registries.push({
        registry: key,
        status: e.code === 'unsupported' ? 'unsupported' : 'error',
        error: { code: e.code, message: e.message },
      });
    }
  }
  return { query: { ids: args.positionals }, registries, warnings, data };
}
```

- [ ] **Step 5: `results` 구현**

`src/cli/commands/results.ts`:

```ts
import type { RegistryAdapter } from '../../core/capability.js';
import { parseTrialId, type RegistryKey } from '../../core/registry.js';
import { CtregError, unsupportedError, usageError } from '../../runtime/errors.js';
import type { ParsedArgs } from '../args.js';
import type { Envelope, RegistryStatus } from '../output.js';

export async function runResults(
  args: ParsedArgs,
  adapters: Record<RegistryKey, RegistryAdapter>,
): Promise<Envelope> {
  if (args.positionals.length !== 1) {
    throw usageError(
      `results 는 ID 를 정확히 하나 요구합니다 (${args.positionals.length}개 받음)`,
      'ctreg results CTGOV:NCT01234567',
    );
  }
  const { registry, id } = parseTrialId(args.positionals[0]!);
  const adapter = adapters[registry];
  const cap = adapter.capability();
  if (!cap.results) {
    throw unsupportedError(
      `${cap.name} 은 결과 데이터를 제공하지 않습니다`,
      'ctreg registries 로 결과를 제공하는 레지스트리를 확인하세요. 결과가 없는 것이 아니라 레지스트리가 결과를 담지 않습니다.',
    );
  }

  const registries: RegistryStatus[] = [];
  try {
    const r = await adapter.results(id, args.results);
    registries.push({ registry, status: 'ok', returned: 1 });
    return { query: { id, sections: args.results.sections }, registries, warnings: r.warnings, data: r.data };
  } catch (e) {
    if (!CtregError.is(e)) throw e;
    registries.push({
      registry,
      status: e.code === 'unsupported' ? 'unsupported' : 'error',
      error: { code: e.code, message: e.message },
    });
    return { query: { id }, registries, warnings: [], data: null };
  }
}
```

- [ ] **Step 6: `index.ts` 에 세 커맨드를 연결한다**

`src/cli/index.ts` 를 고친다:

```ts
// import 추가
import { runGet } from './commands/get.js';
import { runResults } from './commands/results.js';
import { runSearch } from './commands/search.js';
// import 에서 usageError 제거 (default 케이스가 사라진다)
import { CtregError } from '../runtime/errors.js';
```

switch 를 완성한다:

```ts
    let env2: Envelope;
    switch (args.command) {
      case 'registries': env2 = runRegistries(args, adapters); break;
      case 'count': env2 = await runCount(args, adapters); break;
      case 'search': env2 = await runSearch(args, adapters); break;
      case 'get': env2 = await runGet(args, adapters); break;
      case 'results': env2 = await runResults(args, adapters); break;
    }
```

- [ ] **Step 7: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run && bunx tsc --noEmit`
Expected: PASS — 전체 스위트 (core 21 + runtime 32 + adapters 52 + cli 46 = 151 tests), 타입 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add src/cli tests/cli
git commit -m "feat(cli): search, get, and results commands"
```

---

## Task 16: 계약 스위트 · 교차 프로세스 검증 · 필드 테스트

두 번째 레지스트리가 붙는 날을 위한 안전망과, 스펙 §7.4 의 미검증 문법을 실제 API 로 확정하는 게이트다.

**Files:**
- Create: `tests/contract/adapter-contract.ts`, `tests/contract/ctgov.contract.test.ts`
- Create: `scripts/throttle-probe.mjs`, `tests/runtime/throttle.process.test.ts`
- Create: `scripts/field-test.ts`
- Create: `docs/field-test-2026-08-22.md` (스크립트가 생성)

**Interfaces:**
- Consumes: 전 태스크 전부
- Produces: `runAdapterContract(name: string, makeAdapter: () => RegistryAdapter): void` — 어떤 어댑터든 통과해야 하는 공통 describe 블록

- [ ] **Step 1: 계약 스위트 작성**

`tests/contract/adapter-contract.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CapabilitySchema, type Capability, type RegistryAdapter } from '../../src/core/capability.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../src/core/query.js';
import { TrialRecordSchema } from '../../src/core/record.js';
import { assertSupported } from '../../src/cli/guard.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off', raw: false,
};

/**
 * 새 어댑터를 만들 때 이 스위트를 통과시키는 것이 계약 준수의 정의다.
 * 두 번째 레지스트리는 여기에 한 줄(`runAdapterContract('ictrp', …)`)을 더하면 된다.
 */
export function runAdapterContract(name: string, makeAdapter: () => RegistryAdapter): void {
  describe(`어댑터 계약: ${name}`, () => {
    it('capability 선언이 스키마를 통과한다', () => {
      expect(() => CapabilitySchema.parse(makeAdapter().capability())).not.toThrow();
    });

    it('key 와 capability.key 가 일치한다', () => {
      const a = makeAdapter();
      expect(a.capability().key).toBe(a.key);
    });

    it('limits 는 양수다', () => {
      const l = makeAdapter().capability().limits;
      expect(l.maxPageSize).toBeGreaterThan(0);
      expect(l.ratePerSec).toBeGreaterThan(0);
      expect(l.maxBatchIds).toBeGreaterThan(0);
    });

    it('신고하지 않은 축으로 요청하면 빈 결과가 아니라 exit 3 이 나온다', () => {
      const cap = makeAdapter().capability();

      const expectExit3 = (probe: NormalizedQuery, using: Capability, label: string) => {
        try {
          assertSupported(using, probe, fetchOpts);
          expect.unreachable(`'${label}' 은 exit 3 을 던져야 한다`);
        } catch (e) {
          expect((e as { exit?: number }).exit).toBe(EXIT.UNSUPPORTED);
        }
      };

      const unsupported = (Object.keys(cap.search) as (keyof Capability['search'])[])
        .filter((k) => k !== 'geoNeedsCoords' && cap.search[k] === false);

      if (unsupported.length === 0) {
        // 전부 지원하는 어댑터라면 반대 방향으로 검증한다: 가짜로 하나를 끄면 반드시 걸려야 한다.
        expectExit3({ condition: 'x' }, { ...cap, search: { ...cap.search, condition: false } }, 'condition');
        return;
      }
      for (const axis of unsupported) {
        const probe: NormalizedQuery =
          axis === 'geo' ? { near: { lat: 0, lon: 0 } } : ({ [axis]: 'x' } as NormalizedQuery);
        expectExit3(probe, cap, axis);
      }
    });

    it('신고한 detail 섹션은 가드를 통과한다', () => {
      const cap = makeAdapter().capability();
      const include: FetchOpts['include'] = ['core'];
      if (cap.detail.eligibilityText) include.push('eligibility');
      if (cap.detail.outcomes) include.push('outcomes');
      expect(() => assertSupported(cap, {}, { ...fetchOpts, include })).not.toThrow();
    });

    it('TrialRecordSchema 가 이 어댑터의 registry 키를 안다', () => {
      const a = makeAdapter();
      const probe = {
        id: `${a.key.toUpperCase()}:X1`, registry: a.key, registryId: 'X1',
        url: 'https://example.test/X1', title: 'T', status: 'unknown',
        conditions: [], fetchedAt: '2026-08-22T00:00:00.000Z',
      };
      expect(() => TrialRecordSchema.parse(probe)).not.toThrow();
    });
  });
}
```

`tests/contract/ctgov.contract.test.ts`:

```ts
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
```

- [ ] **Step 2: 계약 스위트를 돌린다**

Run: `bunx vitest run tests/contract/`
Expected: PASS — 6 tests

- [ ] **Step 3: 교차 프로세스 스로틀 프로브 작성**

`scripts/throttle-probe.mjs`:

```js
// 여러 프로세스가 동시에 슬롯을 예약해도 요청률이 지켜지는지 확인하는 프로브.
// 빌드된 dist 를 쓴다 — 실제 배포 산출물을 검증하기 위함이다.
import { appendFileSync } from 'node:fs';
import { reserveSlot } from '../dist/runtime/throttle.js';

const [dir, logPath, ratePerSec] = process.argv.slice(2);
await reserveSlot({ dir, registry: 'probe', ratePerSec: Number(ratePerSec) });
appendFileSync(logPath, `${Date.now()}\n`);
```

`tests/runtime/throttle.process.test.ts`:

```ts
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

beforeAll(() => {
  execSync('bun run build', { cwd: ROOT, stdio: 'inherit' });
  expect(existsSync(join(ROOT, 'dist/runtime/throttle.js'))).toBe(true);
}, 120_000);

describe('교차 프로세스 요청률', () => {
  it('동시에 뜬 4개 프로세스가 1 req/s 를 함께 지킨다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctreg-proc-'));
    const log = join(dir, 'stamps.txt');
    writeFileSync(log, '');

    // 동시에 띄운다 — 이것이 참조 구현의 인메모리 큐가 무너지는 시나리오다.
    const procs = Array.from({ length: 4 }, () =>
      execFileSync(process.execPath, [join(ROOT, 'scripts/throttle-probe.mjs'), dir, log, '1'], {
        cwd: ROOT, timeout: 30_000,
      }),
    );
    expect(procs).toHaveLength(4);

    const stamps = readFileSync(log, 'utf8').trim().split('\n').map(Number).sort((a, b) => a - b);
    expect(stamps).toHaveLength(4);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(950);
    }
  }, 60_000);
});
```

**참고:** `execFileSync` 는 순차 실행이므로 진짜 동시성은 아니다. 진짜 동시 실행을 검증하려면 `spawn` 으로 4개를 동시에 띄우고 전부 종료될 때까지 기다린다:

```ts
import { spawn } from 'node:child_process';

const runAll = () =>
  Promise.all(
    Array.from({ length: 4 }, () =>
      new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, [join(ROOT, 'scripts/throttle-probe.mjs'), dir, log, '1'], { cwd: ROOT });
        p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}`))));
      }),
    ),
  );
await runAll();
```

`spawn` 판을 쓴다. `execFileSync` 판은 이 검증의 목적을 달성하지 못한다.

- [ ] **Step 4: 교차 프로세스 테스트를 돌린다**

Run: `bunx vitest run tests/runtime/throttle.process.test.ts`
Expected: PASS — 4개 타임스탬프 간격이 모두 ≥950ms

실패하면 온디스크 버킷이 실제로는 공유되지 않고 있는 것이다. `bucketPath` 가 프로세스마다 같은 경로를 가리키는지, 락이 실제로 직렬화하는지 확인한다.

- [ ] **Step 5: 필드 테스트 스크립트 작성**

`scripts/field-test.ts`:

```ts
/**
 * 스펙 §7.4 의 미검증 문법을 실제 ClinicalTrials.gov 로 확정한다.
 * 우리 HTTP 층을 그대로 쓰므로 요청률 제한이 적용된다. 결과는 docs/field-test-<날짜>.md 로 남는다.
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/runtime/config.js';
import { getJson } from '../src/runtime/http.js';
import { CtregError } from '../src/runtime/errors.js';

type Check = { name: string; params: Record<string, string | number | undefined>; expect: string };

const CHECKS: Check[] = [
  { name: 'query.lead', params: { 'query.lead': 'Merck Sharp & Dohme', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'query.id', params: { 'query.id': 'NCT04280705', pageSize: 1, countTotal: 'true' }, expect: '200 + 해당 NCT 매칭' },
  { name: 'query.patient', params: { 'query.patient': '62 year old woman with EGFR positive lung cancer', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'AREA[…]RANGE 날짜', params: { 'filter.advanced': 'AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX]', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'AREA[Phase] 값', params: { 'filter.advanced': 'AREA[Phase]PHASE3', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'AREA[StudyType] 값', params: { 'filter.advanced': 'AREA[StudyType]INTERVENTIONAL', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'filter.ids 50개', params: { 'filter.ids': Array.from({ length: 50 }, (_, i) => `NCT0428${String(i).padStart(4, '0')}`).join('|'), pageSize: 50 }, expect: '200 (URL 길이 포함)' },
  { name: 'filter.ids 200개', params: { 'filter.ids': Array.from({ length: 200 }, (_, i) => `NCT0428${String(i).padStart(4, '0')}`).join('|'), pageSize: 200 }, expect: '상한 확인 — 실패해도 정보' },
  { name: 'HasResults 필터 후보 A', params: { 'filter.advanced': 'AREA[HasResults]true', pageSize: 1, countTotal: 'true' }, expect: '문법 확인 — 실패해도 정보' },
  { name: 'pageToken 왕복', params: { 'query.cond': 'lung cancer', pageSize: 1, countTotal: 'true' }, expect: 'nextPageToken 존재 확인' },
];

const cfg = loadConfig();
const rows: string[] = [];

for (const check of CHECKS) {
  let verdict: string;
  let detail: string;
  try {
    const r = await getJson<{ totalCount?: number; studies?: unknown[]; nextPageToken?: string }>(
      cfg,
      { registry: 'ctgov', baseUrl: cfg.ctgovBaseUrl, path: '/studies', params: check.params, cacheMode: 'off' },
    );
    verdict = '✅ 통과';
    detail = `totalCount=${r.value.totalCount ?? '-'}, studies=${r.value.studies?.length ?? 0}, nextPageToken=${r.value.nextPageToken ? '있음' : '없음'}`;
  } catch (e) {
    verdict = '❌ 실패';
    detail = CtregError.is(e) ? `${e.code}: ${e.message} — ${e.hint ?? ''}` : String(e);
  }
  rows.push(`| ${check.name} | ${check.expect} | ${verdict} | ${detail.replace(/\|/g, '\\|')} |`);
  console.error(`${verdict}  ${check.name}`);
}

const doc = `# ctreg 필드 테스트 — ClinicalTrials.gov

실행: ${new Date().toISOString()}
대상: ${cfg.ctgovBaseUrl}

스펙 \`docs/superpowers/specs/2026-08-22-ctreg-design.md\` §7.4 의 미검증 문법을 실제 API 로 확인한 결과.

| 검사 | 기대 | 판정 | 실제 |
| :-- | :-- | :-- | :-- |
${rows.join('\n')}

## 조치

- ❌ 항목은 어댑터에서 해당 플래그를 노출하지 않거나, 확인된 문법으로 고친다.
- \`filter.ids\` 상한이 50 미만으로 확인되면 \`CTGOV_CAPABILITY.limits.maxBatchIds\` 를 실제 값으로 낮춘다.
- HasResults 문법이 확인되지 않으면 슬라이스 2 로 미룬다. 레코드 필드로만 계속 낸다.
`;

writeFileSync(`docs/field-test-${new Date().toISOString().slice(0, 10)}.md`, doc);
console.error('\ndocs/field-test-*.md 에 기록했습니다.');
```

`package.json` 의 `scripts` 에 추가:

```json
"field-test": "bun run scripts/field-test.ts"
```

- [ ] **Step 6: 필드 테스트를 실행하고 결과를 반영한다**

Run: `bun run field-test`

생성된 `docs/field-test-<날짜>.md` 를 읽고:

1. ❌ 로 나온 항목은 **해당 플래그를 CLI 표면에서 제거하거나** 확인된 문법으로 고친다. 추측으로 남겨두지 않는다.
2. `filter.ids` 상한이 실제로 확인되면 `CTGOV_CAPABILITY.limits.maxBatchIds` 를 그 값으로 고치고 `tests/adapters/ctgov/adapter.test.ts` 의 배치 분할 테스트 기대값을 함께 고친다.
3. `HasResults` 문법이 확인되지 않으면 스펙 §7.4 항목 5의 결론("필터로 노출하지 않는다")을 유지한다.
4. 스펙 §7.4 를 "검증 완료" 로 갱신하고, 확인된 문법을 표에 적는다.

- [ ] **Step 7: 전체 검증**

```bash
bunx vitest run
bunx tsc --noEmit
bun run build
node dist/cli/bin.js registries | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.data[0].key!=='ctgov')process.exit(1);console.log('OK')})"
node dist/cli/bin.js search --condition "non-small cell lung cancer" --status recruiting --page-size 3
echo "exit=$?"
```

Expected: 전체 테스트 통과, 타입 오류 없음, 빌드 성공, 실제 조회 결과가 봉투 형태로 출력되고 `exit=0`

- [ ] **Step 8: README 를 실제 표면으로 갱신하고 커밋**

`README.md` 에 다음을 넣는다: 커맨드 다섯 개의 실제 예시, exit code 표, 환경변수 표, 업스트림 귀속(Apache-2.0), 그리고 **"이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다."**

```bash
git add -A
git commit -m "test: adapter contract suite, cross-process throttle proof, field test"
```

---

## 슬라이스 1 완료 조건

- [ ] `docs/registry-field-survey-*.md` 가 존재하고 모든 core 필드에 판정이 붙어 있다 (Task 0)
- [ ] `bunx vitest run` 전체 통과 (약 161 tests)
- [ ] `bunx tsc --noEmit` 오류 없음
- [ ] `node dist/cli/bin.js search …` 가 실제 ClinicalTrials.gov 를 조회해 봉투를 낸다
- [ ] 4개 프로세스 동시 실행 시 요청 간격 ≥950ms 가 실측으로 증명된다
- [ ] `docs/field-test-*.md` 가 존재하고 ❌ 항목이 모두 처리되었다
- [ ] `LICENSE` · `NOTICE` 가 있고 포팅한 파일에 유래 주석이 있다
- [ ] `ctreg registries` 가 capability 를 정확히 신고한다

## 슬라이스 2 이후 (이 계획에 없음)

- 두 번째 레지스트리 어댑터 — `runAdapterContract` 에 한 줄을 더하는 것으로 시작한다
- `GET /studies/enums` 캐시 기반 값 정규화
- `hasResults` 필터, 정규화된 정렬 키, `ctreg cache` 관리 커맨드
- 플러그인 패키징 (스킬 + 슬래시 커맨드) — `match` / `compare` / `landscape` 는 여기로 간다
- 지오코딩
