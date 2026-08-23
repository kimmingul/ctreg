# capability 가 내용을 말하게 한다 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ctreg registries` 의 capability 선언이 "축이 있다"가 아니라 "무엇을 받고, 무엇을 보고, 데이터를 덮는가"를 말하게 만들어 F2·F5·F8·F9·F14 를 한 번에 닫는다.

**Architecture:** 검색 축과 `results`/`count`/`detail` 의 불리언을 객체로 바꾼다. 값 목록은 각 어댑터가 이미 가진 필터 테이블에서 파생하고(손으로 두 번 적지 않는다), `exhaustive` 는 필드테스트 스크립트가 실물에서 재며, `exhaustive: false` 축으로 필터하면 CLI 가드가 경고를 낸다.

**Tech Stack:** TypeScript, zod, vitest, bun

**Spec:** `docs/superpowers/specs/2026-08-23-capability-says-content-design.md`

## Global Constraints

- **언어:** 코드 주석·문서·테스트 이름은 **한국어**. 커밋 제목만 영어 conventional commit.
- **TDD:** 프로덕션 코드 앞에 반드시 실패하는 테스트가 온다. 실패를 눈으로 본 뒤에 구현한다.
- **사보타주 검증:** 새로 만든 검사는 "고친 함수"가 아니라 **그 함수를 부르는 자리**를 겨눠 사보타주해 실제로 잡히는지 확인한다. 이 저장소에서 같은 구멍이 세 번 났다.
- **부재는 부재다:** 없는 값을 지어내지 않는다. 모르는 것은 `null`, 못 하는 것은 exit 3.
- **네트워크 금지:** `ctreg registries` 는 네트워크를 타지 않는다. 이 성질을 깨지 않는다.
- **검증 명령:** `npx vitest run` (전체) · `npm run typecheck` · `npm run build`
- **스펙 정정:** 스펙 §5 는 `assertSupported` 호출 지점을 "다섯 커맨드"라고 적었으나 **실제로는 셋**이다 — `src/cli/commands/search.ts:31`, `get.ts:81`, `count.ts:30`. `results.ts` 와 `registries.ts` 는 부르지 않는다.

## File Structure

| 파일 | 책임 |
| :-- | :-- |
| `src/core/vocab.ts` | 공통 폐쇄 어휘 + **필터로 쓸 수 있는 값 목록**(새로 내보냄). `--help` 와 테스트가 읽는다 |
| `src/adapters/ctgov/vocab.ts` | ctgov 원문 ↔ 공통 어휘 매핑 + **ctgov 가 필터로 받는 값 목록**(새로 내보냄) |
| `src/adapters/isrctn/query.ts` | ISRCTN 질의 조립 + **ISRCTN 이 필터로 받는 값 목록**(새로 내보냄) |
| `src/core/capability.ts` | `SearchAxis`·`Feature` 스키마 |
| `src/adapters/*/adapter.ts` | 각 레지스트리의 capability 선언 |
| `src/cli/guard.ts` | `.supported` 로 가드 + `vocab_excludes_missing` 경고 생성 |
| `src/cli/args.ts` | USAGE 에 값 어휘 |
| `scripts/field-test.ts` · `scripts/isrctn-field-test.ts` | `exhaustive` 를 실물에서 잰다 |

---

### Task 1: 공통 어휘의 "필터로 쓸 수 있는 값" 목록을 내보낸다

`--help` 와 어댑터 선언이 같은 목록을 읽어야 한다. 지금은 `isFilterable*` 술어만 있고 목록이 없어, 값을 열거하려는 쪽이 각자 배열을 만들게 된다.

**Files:**
- Modify: `src/core/vocab.ts`
- Test: `tests/core/vocab.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `FILTERABLE_STATUS: TrialStatus[]`, `FILTERABLE_PHASE: TrialPhase[]`, `FILTERABLE_STUDY_TYPE: StudyType[]` — `src/core/vocab.ts` 에서 내보낸다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/core/vocab.test.ts` 끝에 덧붙인다:

```ts
import {
  FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE,
  STUDY_TYPE, TRIAL_PHASE, TRIAL_STATUS,
} from '../../src/core/vocab.js';

describe('필터로 쓸 수 있는 값 목록', () => {
  /**
   * `unknown` 과 `other` 는 **매핑 결과**이지 검색 조건이 아니다 — 어휘에 자리가
   * 없는 값을 받았을 때 붙이는 이름이라, 그것으로 필터를 걸어 달라고 할 수 없다.
   * 목록을 손으로 적으면 이 규칙이 목록마다 다시 지켜져야 하므로 술어로 거른다.
   */
  it('unknown 과 other 를 뺀 나머지 전부다', () => {
    expect(FILTERABLE_STATUS).toEqual(TRIAL_STATUS.filter((v) => v !== 'unknown' && v !== 'other'));
    expect(FILTERABLE_PHASE).toEqual(TRIAL_PHASE.filter((v) => v !== 'unknown' && v !== 'other'));
    expect(FILTERABLE_STUDY_TYPE).toEqual(STUDY_TYPE.filter((v) => v !== 'unknown' && v !== 'other'));
  });

  it('비어 있지 않다 — 빈 목록은 "필터를 걸 수 없다" 로 읽힌다', () => {
    expect(FILTERABLE_STATUS.length).toBeGreaterThan(0);
    expect(FILTERABLE_PHASE.length).toBeGreaterThan(0);
    expect(FILTERABLE_STUDY_TYPE.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/core/vocab.test.ts`
Expected: FAIL — `Failed to load` 또는 `FILTERABLE_STATUS is not exported`

- [ ] **Step 3: 최소 구현**

`src/core/vocab.ts` 의 `isFilterableStudyType` 아래에 덧붙인다:

```ts
/**
 * 필터로 쓸 수 있는 값의 목록. 술어(`isFilterable*`)만 있고 목록이 없으면, 값을
 * 열거하려는 쪽(`--help`, capability 선언)이 각자 배열을 만들게 되고 그 배열들이
 * 어휘와 따로 논다. 목록을 술어에서 파생시켜 그 갈래를 없앤다.
 */
export const FILTERABLE_STATUS: TrialStatus[] = TRIAL_STATUS.filter(isFilterableStatus);
export const FILTERABLE_PHASE: TrialPhase[] = TRIAL_PHASE.filter(isFilterablePhase);
export const FILTERABLE_STUDY_TYPE: StudyType[] = STUDY_TYPE.filter(isFilterableStudyType);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/core/vocab.test.ts && npm run typecheck`
Expected: PASS, typecheck 무출력

- [ ] **Step 5: 커밋**

```bash
git add src/core/vocab.ts tests/core/vocab.test.ts
git commit -m "feat(core): export the list of filterable vocabulary values

A predicate without a list makes every caller that wants to enumerate
values build its own array, and those arrays drift from the vocabulary.
Derive the lists from the predicates instead."
```

---

### Task 2: 각 어댑터가 "자기가 필터로 받는 값" 목록을 내보낸다

이것이 F5 의 실제 답이다. 두 레지스트리는 같은 공통 어휘의 **서로 다른 부분집합**을 받는다 — ISRCTN 에는 `early_phase_1` 자리가 없고 `status` 축 자체가 없다.

**Files:**
- Modify: `src/adapters/ctgov/vocab.ts`
- Modify: `src/adapters/isrctn/query.ts`
- Test: `tests/adapters/ctgov/vocab.test.ts`, `tests/adapters/isrctn/query.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `FILTERABLE_*` (테스트에서 대조용으로만)
- Produces:
  - `CTGOV_FILTERABLE: { status: TrialStatus[]; phase: TrialPhase[]; studyType: StudyType[] }` — `src/adapters/ctgov/vocab.ts`
  - `ISRCTN_FILTERABLE: { status: TrialStatus[]; phase: TrialPhase[]; studyType: StudyType[] }` — `src/adapters/isrctn/query.ts`

- [ ] **Step 1: ctgov 쪽 실패하는 테스트를 쓴다**

`tests/adapters/ctgov/vocab.test.ts` 끝에 덧붙인다:

```ts
import { CTGOV_FILTERABLE } from '../../../src/adapters/ctgov/vocab.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../../../src/core/vocab.js';

describe('ctgov 가 필터로 받는 값', () => {
  /**
   * ctgov 는 공통 어휘 전부를 받는다. 이 사실 자체보다 중요한 것은 **목록이 매핑
   * 테이블에서 파생된다**는 것이다 — 어휘에 값을 하나 더하고 매핑을 빠뜨리면 이
   * 테스트가 그 자리에서 깨진다.
   */
  it('공통 어휘의 필터 가능한 값 전부를 받는다', () => {
    expect([...CTGOV_FILTERABLE.status].sort()).toEqual([...FILTERABLE_STATUS].sort());
    expect([...CTGOV_FILTERABLE.phase].sort()).toEqual([...FILTERABLE_PHASE].sort());
    expect([...CTGOV_FILTERABLE.studyType].sort()).toEqual([...FILTERABLE_STUDY_TYPE].sort());
  });

  it('신고한 값은 전부 실제로 필터 문자열로 변환된다', () => {
    for (const v of CTGOV_FILTERABLE.status) expect(() => fromStatus(v)).not.toThrow();
    for (const v of CTGOV_FILTERABLE.phase) expect(() => fromPhase(v)).not.toThrow();
    for (const v of CTGOV_FILTERABLE.studyType) expect(() => fromStudyType(v)).not.toThrow();
  });
});
```

> `fromStatus`/`fromPhase`/`fromStudyType` 은 이 테스트 파일이 이미 import 하고 있다. 없으면 `../../../src/adapters/ctgov/vocab.js` 에서 함께 가져온다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/adapters/ctgov/vocab.test.ts`
Expected: FAIL — `CTGOV_FILTERABLE` 를 못 찾는다

- [ ] **Step 3: ctgov 최소 구현**

`src/adapters/ctgov/vocab.ts` 파일 끝에 덧붙인다:

```ts
/**
 * capability 의 `values` 는 이 목록에서 파생한다 — **손으로 두 번 적지 않는다.**
 * `*_OUT` 은 이미 "필터 문자열로 변환할 수 있는 값"의 정본이고 `*_IN` 에서
 * `isFilterable*` 로 걸러 만들어진다. 선언이 이 목록을 읽으면 선언과 매핑이
 * 어긋날 수 없다.
 */
export const CTGOV_FILTERABLE = {
  status: Object.keys(STATUS_OUT) as TrialStatus[],
  phase: Object.keys(PHASE_OUT) as TrialPhase[],
  studyType: Object.keys(STUDY_TYPE_OUT) as StudyType[],
};
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/adapters/ctgov/vocab.test.ts`
Expected: PASS

- [ ] **Step 5: isrctn 쪽 실패하는 테스트를 쓴다**

`tests/adapters/isrctn/query.test.ts` 끝에 덧붙인다:

```ts
import { ISRCTN_FILTERABLE } from '../../../src/adapters/isrctn/query.js';

describe('ISRCTN 이 필터로 받는 값', () => {
  /**
   * ISRCTN 은 공통 어휘의 **부분집합**만 받는다. 지금 이 사실은 부딪혀야만 드러난다 —
   * `--phase early_phase_1 --registry isrctn` 은 exit 2 다. 목록으로 내보내면 그
   * 사실이 선언 가능해지고, F5·F9 가 지적한 "틀린 뒤에만 알려준다"가 사라진다.
   */
  it('early_phase_1 을 받지 않는다 — ISRCTN phase 어휘에 자리가 없다', () => {
    expect(ISRCTN_FILTERABLE.phase).not.toContain('early_phase_1');
    expect(ISRCTN_FILTERABLE.phase).toEqual(
      expect.arrayContaining(['phase_1', 'phase_2', 'phase_3', 'phase_4', 'na']),
    );
  });

  it('expanded_access 를 받지 않는다 — primaryStudyDesign 은 두 값뿐이다', () => {
    expect(ISRCTN_FILTERABLE.studyType).toEqual(['interventional', 'observational']);
  });

  /** 실측에서 trialStatus·recruitmentStatus 가 전부 0건이라 축 자체가 없다. */
  it('status 는 빈 목록이다 — 축이 죽어 있다', () => {
    expect(ISRCTN_FILTERABLE.status).toEqual([]);
  });

  it('신고한 값은 전부 실제로 질의로 조립된다 — 신고와 거부가 어긋나면 안 된다', () => {
    for (const v of ISRCTN_FILTERABLE.phase) {
      expect(() => buildQuery({ phase: [v] }), `phase '${v}' 를 신고해 놓고 거부합니다`).not.toThrow();
    }
    for (const v of ISRCTN_FILTERABLE.studyType) {
      expect(() => buildQuery({ studyType: v }), `studyType '${v}' 를 신고해 놓고 거부합니다`).not.toThrow();
    }
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run tests/adapters/isrctn/query.test.ts`
Expected: FAIL — `ISRCTN_FILTERABLE` 를 못 찾는다

- [ ] **Step 7: isrctn 최소 구현**

`src/adapters/isrctn/query.ts` 의 `STUDY_TYPE_OUT` 선언 바로 아래에 덧붙인다:

```ts
/**
 * capability 의 `values` 가 읽는 목록. **나가는 쪽** 테이블에서 파생한다 —
 * `vocab.ts` 의 매핑은 응답으로 **들어오는** 값이고, 지금 문자열이 같은 것은 우연이다.
 *
 * `status` 가 빈 목록인 것이 이 파일에서 가장 중요한 선언이다: ISRCTN 은
 * `trialStatus`·`recruitmentStatus` 가 문서에 값 목록까지 있는데도 실측에서 전부
 * 0건이라 축 자체가 없다. `[]` 는 "그런 시험이 없다"가 아니라 "그렇게 물어볼 수 없다"다.
 */
export const ISRCTN_FILTERABLE = {
  status: [] as TrialStatus[],
  phase: Object.keys(PHASE_OUT) as TrialPhase[],
  studyType: Object.keys(STUDY_TYPE_OUT) as StudyType[],
};
```

`import type { TrialPhase }` 를 `import type { StudyType, TrialPhase, TrialStatus }` 로 넓힌다.

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 PASS, typecheck 무출력

- [ ] **Step 9: 커밋**

```bash
git add src/adapters/ctgov/vocab.ts src/adapters/isrctn/query.ts tests/adapters/ctgov/vocab.test.ts tests/adapters/isrctn/query.test.ts
git commit -m "feat(adapters): export which vocabulary values each registry accepts

The two registries take different subsets of the same closed
vocabulary — ISRCTN has no slot for early_phase_1 and no status axis
at all — and right now that only surfaces by hitting exit 2. The lists
derive from each adapter's existing filter table, so a declaration
cannot drift from the mapping that implements it."
```

---

### Task 3: `exhaustive` 를 실물에서 잰다

`exhaustive` 는 선언이 아니라 **측정**이다. 판정 방법은 필드 테스트에서 에이전트가 손으로 했던 뺄셈 그대로다 — 값별 건수의 합 vs 전체 총계.

**Files:**
- Modify: `scripts/isrctn-field-test.ts`
- Modify: `scripts/field-test.ts`
- Create: `docs/exhaustive-measurement-2026-08-23.md` (스크립트가 만든다)

**Interfaces:**
- Consumes: Task 2 의 `CTGOV_FILTERABLE`, `ISRCTN_FILTERABLE`
- Produces: 측정 결과 — Task 4 의 `exhaustive` 선언값이 여기서 나온다

- [ ] **Step 1: ISRCTN 스크립트에 측정 절을 더한다**

`scripts/isrctn-field-test.ts` 의 `main()` 안, "2. false 로 신고한 축" 루프 **뒤에** 덧붙인다:

```ts
  console.error('\n--- 3. 닫힌 어휘가 데이터를 덮는가 (exhaustive) ---');
  const exhaustiveRows: string[] = [];
  const AXES: { axis: 'phase' | 'studyType'; values: string[]; probe: (v: string) => NormalizedQuery }[] = [
    { axis: 'phase', values: ISRCTN_FILTERABLE.phase, probe: (v) => ({ phase: [v as never] }) },
    { axis: 'studyType', values: ISRCTN_FILTERABLE.studyType, probe: (v) => ({ studyType: v as never }) },
  ];
  for (const a of AXES) {
    if (a.values.length === 0) continue; // 축이 없으면 물음이 성립하지 않는다
    let sum = 0;
    for (const v of a.values) sum += (await adapter.count(a.probe(v), fetchOpts)).data;
    // 총계는 레지스트리 전체다 — 값별 합과 같은 모집단을 봐야 뺄셈이 의미를 갖는다.
    const exhaustive = sum >= REGISTRY_TOTAL;
    exhaustiveRows.push(
      `| ${a.axis} | ${a.values.length} | ${sum} | ${REGISTRY_TOTAL} | ${exhaustive ? '`true`' : '`false`'} | ${REGISTRY_TOTAL - sum} |`,
    );
    console.error(`  ${a.axis}: 값별 합 ${sum} vs 전체 ${REGISTRY_TOTAL} → exhaustive=${exhaustive}`);
  }
```

그리고 보고서 markdown 배열에 절을 더한다:

```ts
    '## 3. 닫힌 어휘가 데이터를 덮는가',
    '',
    '값별 건수의 합이 전체 총계에 못 미치면 그 축의 어휘로는 데이터를 다 덮지 못한다는 뜻이다.',
    '모자란 부분이 F8 이 이름 붙이지 못했던 그것이고, capability 의 `exhaustive: false` 가 그 이름이다.',
    '',
    '| 축 | 값 개수 | 값별 합 | 전체 총계 | exhaustive | 어느 값에도 안 걸리는 수 |',
    '| :-- | --: | --: | --: | :-- | --: |',
    ...exhaustiveRows,
    '',
```

`import { ISRCTN_FILTERABLE } from '../src/adapters/isrctn/query.js';` 를 더한다.

- [ ] **Step 2: 실행해 값을 확보한다**

Run: `bun run isrctn-field-test`
Expected: 3번 절이 `phase` 와 `studyType` 각각에 대해 합·총계·판정을 출력한다. **출력된 `exhaustive` 값을 적어 둔다 — Task 4 가 그대로 선언한다.**

> 참고: 사전 실측에서 `primaryStudyDesign` 은 Interventional 24741 + Observational 3792 = 28533 이고 전체는 28592 였다. 59건이 어느 값에도 안 걸리므로 `studyType` 은 `exhaustive: false` 가 나올 것으로 예상되지만, **예상이 아니라 실행 결과를 쓴다.**

- [ ] **Step 3: ctgov 스크립트에 같은 절을 더한다**

`scripts/field-test.ts` 의 `main()` 끝, 보고서를 쓰기 직전에 덧붙인다:

```ts
  console.error('\n--- 닫힌 어휘가 데이터를 덮는가 (exhaustive) ---');
  const exhaustiveRows: string[] = [];
  const countFor = async (params: Record<string, string | number | undefined>) => {
    const r = await getJson<StudiesResponse>(cfg, {
      registry: 'ctgov', baseUrl: cfg.ctgovBaseUrl, path: '/studies',
      params: { ...params, pageSize: 0, countTotal: 'true' },
      cacheMode: 'off', ratePerSec: CTGOV_CAPABILITY.limits.ratePerSec,
    });
    return r.value.totalCount ?? 0;
  };
  const ALL = await countFor({});
  const CTGOV_AXES = [
    { axis: 'status', values: CTGOV_FILTERABLE.status, params: (v: string) => ({ 'filter.overallStatus': fromStatus(v as never) }) },
    { axis: 'phase', values: CTGOV_FILTERABLE.phase, params: (v: string) => ({ 'filter.advanced': `AREA[Phase]${fromPhase(v as never)}` }) },
    { axis: 'studyType', values: CTGOV_FILTERABLE.studyType, params: (v: string) => ({ 'filter.advanced': `AREA[StudyType]${fromStudyType(v as never)}` }) },
  ];
  for (const a of CTGOV_AXES) {
    let sum = 0;
    for (const v of a.values) sum += await countFor(a.params(v));
    const exhaustive = sum >= ALL;
    exhaustiveRows.push(`| ${a.axis} | ${a.values.length} | ${sum} | ${ALL} | ${exhaustive ? '\`true\`' : '\`false\`'} | ${ALL - sum} |`);
    console.error(`  ${a.axis}: 값별 합 ${sum} vs 전체 ${ALL} → exhaustive=${exhaustive}`);
  }
```

보고서 markdown 에 같은 모양의 표를 더한다. import 를 넓힌다:

```ts
import { CTGOV_FILTERABLE, fromPhase, fromStatus, fromStudyType } from '../src/adapters/ctgov/vocab.js';
```

- [ ] **Step 4: 실행해 값을 확보한다**

Run: `bun run field-test`
Expected: 세 축의 합·총계·판정이 출력된다. **출력된 값을 적어 둔다.**

> 참고: 필드 테스트에서 표본 1000건 중 52건이 phase 필드를 갖지 않았으므로 `phase` 는 `false` 가 예상된다. **예상이 아니라 실행 결과를 쓴다.**

- [ ] **Step 5: 커밋**

```bash
git add scripts/field-test.ts scripts/isrctn-field-test.ts docs/
git commit -m "test(field): measure whether each closed vocabulary covers the data

exhaustive is a measurement, not a declaration, and the measurement is
the subtraction the field-test agent did by hand: sum the per-value
counts and compare against the total for the same population. The gap
is what F8 could not name. Both scripts now report it so the next task
declares a measured fact rather than a guess."
```

---

### Task 4: capability 를 객체로 바꾼다

호환을 깨는 원자적 변경이다. 스키마·두 어댑터 선언·가드·계약 스위트·테스트가 **함께** 가야 컴파일된다.

**Files:**
- Modify: `src/core/capability.ts`
- Modify: `src/adapters/ctgov/adapter.ts:13-38`
- Modify: `src/adapters/isrctn/adapter.ts` (`ISRCTN_CAPABILITY`)
- Modify: `src/cli/guard.ts:23-70`
- Modify: `tests/contract/adapter-contract.ts`
- Modify: `tests/core/capability.test.ts`, `tests/cli/guard.test.ts`
- Test: 위 세 테스트 파일

**Interfaces:**
- Consumes: Task 2 의 `CTGOV_FILTERABLE`·`ISRCTN_FILTERABLE`, Task 3 의 측정값
- Produces:
  - `SearchAxis = { supported: boolean; values: string[] | null; exhaustive: boolean | null; scope: string }`
  - `Feature = { supported: boolean; scope: string }`
  - `Capability['search'][axis]` 는 `SearchAxis`, `Capability['results' | 'count']` 와 `Capability['detail'][k]` 는 `Feature`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/core/capability.test.ts` 끝에 덧붙인다:

```ts
describe('축 선언은 내용을 말한다', () => {
  const cap = CTGOV_CAPABILITY;

  it('닫힌 어휘 축은 값 목록을 신고한다', () => {
    expect(cap.search.status.values).toContain('recruiting');
    expect(cap.search.phase.values).toContain('phase_3');
  });

  /**
   * 자유 텍스트 축의 `values` 는 `null` 이고 지원하지 않는 닫힌 어휘 축은 `[]` 다.
   * 둘을 같은 값으로 두면 "아무 값이나 받는다" 와 "아무 값도 못 받는다" 가 같아진다.
   */
  it('자유 텍스트 축은 values 가 null 이다 — 빈 배열과 다르다', () => {
    expect(cap.search.term.values).toBeNull();
    expect(cap.search.condition.values).toBeNull();
  });

  it('모든 축이 비어 있지 않은 scope 를 갖는다', () => {
    for (const [name, axis] of Object.entries(cap.search)) {
      expect(axis.scope.length, `'${name}' 축의 scope 가 비어 있습니다`).toBeGreaterThan(0);
    }
  });

  /** F14: 불리언이 무엇에 대한 참인지 말하지 않아 "결과 유무로 검색 가능" 으로 읽혔다. */
  it('results 는 그것이 서브커맨드 지원이라는 것을 말한다', () => {
    expect(cap.results.supported).toBe(true);
    expect(cap.results.scope).toContain('서브커맨드');
  });

  it('지원하지 않는 닫힌 어휘 축은 values 가 빈 배열이고 exhaustive 는 null 이다', () => {
    expect(ISRCTN_CAPABILITY.search.status.supported).toBe(false);
    expect(ISRCTN_CAPABILITY.search.status.values).toEqual([]);
    expect(ISRCTN_CAPABILITY.search.status.exhaustive).toBeNull();
  });
});
```

`import { ISRCTN_CAPABILITY } from '../../src/adapters/isrctn/adapter.js';` 를 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/core/capability.test.ts`
Expected: FAIL — `cap.search.status.values` 가 `undefined` (지금은 불리언이다)

- [ ] **Step 3: 스키마를 바꾼다**

`src/core/capability.ts` 의 `CapabilitySchema` 를 이렇게 바꾼다:

```ts
/**
 * 검색 축 하나의 신고. 불리언이었을 때는 "축이 있다"만 말했고, 그래서 0건이 "없음"
 * 인지 "안 봄" 인지 판별할 근거가 도구 안에 없었다(F2). 세 가지를 더 말한다 —
 * 무엇을 받는지(`values`), 데이터를 덮는지(`exhaustive`), 무엇을 보는지(`scope`).
 */
const SearchAxisSchema = z.strictObject({
  supported: z.boolean(),
  /**
   * 이 레지스트리가 **필터로 받는** 공통 어휘 값.
   * - 배열 — 닫힌 어휘 축. 여기 없는 값은 거부된다.
   * - `null` — 자유 텍스트 축(닫힌 어휘가 없다).
   * 지원하지 않는 닫힌 어휘 축은 `[]` 다. `null` 과 `[]` 는 다르다 —
   * 앞은 "아무 값이나 받는다", 뒤는 "아무 값도 못 받는다".
   */
  values: z.array(z.string()).nullable(),
  /**
   * 이 축의 값이 모든 레코드에 있는가. `false` 면 값별 건수의 합이 전체 총계보다
   * 작다 — 그 차이가 F8 이 이름 붙이지 못했던 부분이다. 자유 텍스트 축과
   * `supported: false` 인 축은 `null` 이다(물음 자체가 성립하지 않는다).
   */
  exhaustive: z.boolean().nullable(),
  /** 이 축이 실제로 무엇을 보는지 한 문장. 불리언이 말하지 못하는 것. */
  scope: z.string().min(1),
});

/** 축이 아닌 기능(`results`·`count`·detail 섹션)의 신고. F14 가 요구한 것은 `scope` 다. */
const FeatureSchema = z.strictObject({
  supported: z.boolean(),
  scope: z.string().min(1),
});

export const CapabilitySchema = z.strictObject({
  key: z.enum(REGISTRY_KEYS),
  name: z.string(),
  region: z.string(),
  search: z.strictObject({
    condition: SearchAxisSchema, intervention: SearchAxisSchema, term: SearchAxisSchema,
    title: SearchAxisSchema, sponsor: SearchAxisSchema, lead: SearchAxisSchema,
    location: SearchAxisSchema, id: SearchAxisSchema, patient: SearchAxisSchema,
    outcomeQuery: SearchAxisSchema, geo: SearchAxisSchema, status: SearchAxisSchema,
    phase: SearchAxisSchema, studyType: SearchAxisSchema,
    updatedRange: SearchAxisSchema, startRange: SearchAxisSchema, completionRange: SearchAxisSchema,
  }),
  detail: z.strictObject({
    eligibilityText: FeatureSchema, outcomes: FeatureSchema, contacts: FeatureSchema,
  }),
  results: FeatureSchema,
  count: FeatureSchema,
  limits: z.strictObject({
    maxPageSize: z.number(), ratePerSec: z.number(), maxBatchIds: z.number(),
  }),
});
export type Capability = z.infer<typeof CapabilitySchema>;
export type SearchAxis = z.infer<typeof SearchAxisSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
```

기존 `geoNeedsCoords` 주석과 날짜 축 주석은 그대로 옮긴다.

- [ ] **Step 4: ctgov 선언을 바꾼다**

`src/adapters/ctgov/adapter.ts` 의 `CTGOV_CAPABILITY` 를 통째로 교체한다:

```ts
const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });

export const CTGOV_CAPABILITY: Capability = {
  key: 'ctgov',
  name: 'ClinicalTrials.gov',
  region: 'US / global',
  search: {
    condition: free('질환·상태 이름. 동의어 확장이 업스트림에서 일어난다'),
    intervention: free('약물·처치·기기 이름'),
    term: free('제목·조건·중재·요약을 아우르는 본문 전반의 자유 텍스트'),
    title: free('공식 제목과 간략 제목에만 걸린다 — 본문은 보지 않는다'),
    sponsor: free('주 스폰서와 공동 스폰서를 모두 본다'),
    lead: free('주 스폰서만 본다 — 공동 스폰서는 제외된다'),
    location: free('시험 사이트의 기관명·도시·주·국가'),
    id: free('NCT 번호와 업스트림이 기재한 보조 식별자'),
    patient: free('환자 친화 표현으로 쓴 자유 텍스트'),
    outcomeQuery: free('1차·2차 평가변수 문구'),
    geo: { supported: true, values: null, exhaustive: null,
      scope: '좌표와 반경. 좌표를 가진 사이트만 매칭한다 — 지명은 받지 않는다(--near 는 lat,lon)' },
    status: { supported: true, values: CTGOV_FILTERABLE.status, exhaustive: /* Task 3 측정값 */ true,
      scope: '시험 전체의 대표 상태 하나 — 사이트별 모집 상태가 아니다' },
    phase: { supported: true, values: CTGOV_FILTERABLE.phase, exhaustive: /* Task 3 측정값 */ false,
      scope: '시험이 신고한 단계. 여러 단계를 신고한 시험은 그 전부에 걸린다' },
    studyType: { supported: true, values: CTGOV_FILTERABLE.studyType, exhaustive: /* Task 3 측정값 */ true,
      scope: '중재/관찰/확대접근 구분' },
    updatedRange: { supported: true, values: null, exhaustive: null,
      scope: '마지막 갱신 게시일(LastUpdatePostDate)' },
    startRange: { supported: true, values: null, exhaustive: null, scope: '시험 시작일(StartDate)' },
    completionRange: { supported: true, values: null, exhaustive: null,
      scope: '1차 완료일(PrimaryCompletionDate) — 최종 완료일이 아니다' },
  },
  detail: {
    eligibilityText: { supported: true, scope: '적격 기준 원문. --include eligibility 로 켠다' },
    outcomes: { supported: true, scope: '평가변수 목록(측정 항목·시점). 결과 수치가 아니다' },
    contacts: { supported: true, scope: '중앙 연락처. 사이트별 연락처는 locations 에 있다' },
  },
  results: { supported: true,
    scope: 'results 서브커맨드를 지원한다 — 결과 유무로 검색하는 것이 아니다' },
  count: { supported: true, scope: '같은 필터로 건수만 받는다. 페이로드를 받지 않는다' },
  limits: { maxPageSize: 200, ratePerSec: 1, maxBatchIds: 50 },
};
```

`/* Task 3 측정값 */` 자리에는 Task 3 Step 4 에서 **실제로 출력된 값**을 넣고 주석은 지운다. import 에 `type SearchAxis` 와 `CTGOV_FILTERABLE` 을 더한다.

- [ ] **Step 5: isrctn 선언을 바꾼다**

`src/adapters/isrctn/adapter.ts` 의 `ISRCTN_CAPABILITY` 를 교체한다. 기존의 긴 머리 주석(왜 false 인지)은 **그대로 둔다** — 이 파일에서 가장 중요한 설명이다.

```ts
const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });

export const ISRCTN_CAPABILITY: Capability = {
  key: 'isrctn',
  name: 'ISRCTN',
  region: 'UK / global',
  search: {
    condition: free('질환 설명 자유 텍스트(condition 필드)'),
    intervention: free('중재 설명 자유 텍스트(intervention 필드)'),
    term: free('본문 전반의 자유 텍스트'),
    title: free('시험 제목'),
    sponsor: free('스폰서 기관명(sponsorOrganisation) — 자금 제공자는 별개다'),
    lead: off('ISRCTN 에는 주 스폰서와 공동 스폰서를 가르는 검색 축이 없다'),
    location: off('자유 문자열 장소 축이 없다. 살아 있는 것은 국가 완전일치뿐이라 "서울" 은 0건이 된다'),
    id: off('식별자 전용 축이 전부 죽어 있다 — isrctn:·secondaryNumber:·clinicalTrialsGovNumber: 모두 0건'),
    patient: off('환자 친화 검색 축이 없다'),
    outcomeQuery: free('평가변수 문구(outcomeMeasures 필드)'),
    geo: off('데이터에 좌표가 없다'),
    status: { supported: false, values: ISRCTN_FILTERABLE.status, exhaustive: null,
      scope: 'trialStatus·recruitmentStatus 가 문서에 값 목록까지 있으나 실측에서 전부 0건이다. 상태는 레코드에는 실려 나온다 — 받아 보고 거르는 것은 된다' },
    phase: { supported: true, values: ISRCTN_FILTERABLE.phase, exhaustive: /* Task 3 측정값 */ false,
      scope: 'ISRCTN 이 신고한 단계. early_phase_1 에 해당하는 값이 어휘에 없다' },
    studyType: { supported: true, values: ISRCTN_FILTERABLE.studyType, exhaustive: /* Task 3 측정값 */ false,
      scope: 'primaryStudyDesign — 중재/관찰 두 값뿐이고 확대접근 자리가 없다' },
    updatedRange: { supported: true, values: null, exhaustive: null,
      scope: '마지막 편집 시각(lastEdited)' },
    startRange: { supported: false, values: null, exhaustive: null,
      scope: 'overallStartDate 는 문서에 있으나 필터가 통째로 무시되어 전체를 돌려준다 — 0건보다 위험해서 끈다' },
    completionRange: { supported: true, values: null, exhaustive: null,
      scope: '시험 종료일(overallEndDate)' },
  },
  detail: {
    eligibilityText: { supported: true, scope: '포함·제외 기준을 하나의 본문으로 합쳐 낸다' },
    outcomes: { supported: true, scope: '1차·2차 평가변수 문구. 결과 수치가 아니다' },
    contacts: { supported: true, scope: '공개·과학 연락처' },
  },
  results: { supported: false,
    scope: 'ISRCTN 의 결과는 논문 링크와 첨부 PDF 이지 구조화된 평가변수·이상반응 데이터가 아니다' },
  count: { supported: true, scope: 'default 포맷의 limit=0 응답에서 총계만 읽는다' },
  limits: { maxPageSize: CAPS.pageSize.max, ratePerSec: 1, maxBatchIds: 10 },
};
```

- [ ] **Step 6: 가드를 `.supported` 로 읽게 한다**

`src/cli/guard.ts` 의 `assertSupported` 안 두 루프를 바꾼다:

```ts
  for (const [axis, used] of axes) {
    if (used && !cap.search[axis].supported) {
```

```ts
  for (const [axis, used] of detailAxes) {
    if (used && !cap.detail[axis].supported) {
```

`count.ts` 의 `if (!cap.count)` 를 `if (!cap.count.supported)` 로, `results.ts` 의 `cap.results` 검사를 `cap.results.supported` 로 바꾼다.

- [ ] **Step 7: 계약 스위트와 나머지 테스트를 새 모양으로 옮긴다**

`tests/contract/adapter-contract.ts`:
- `cap.search[k] === false` → `cap.search[k].supported === false`
- `{ ...cap, search: { ...cap.search, condition: false } }` → `{ ...cap, search: { ...cap.search, condition: { ...cap.search.condition, supported: false } } }`
- `capability: () => ({ ...adapter.capability(), results: false })` → `results: { ...adapter.capability().results, supported: false }`
- `count: false` 도 같은 모양으로
- `if (!cap.results) return;` → `if (!cap.results.supported) return;`
- `if (cap.detail.eligibilityText)` → `if (cap.detail.eligibilityText.supported)` (outcomes 도)

`tests/cli/guard.test.ts` 의 `limited` 와 `capOff` 도 같은 방식으로 옮긴다.

- [ ] **Step 8: 전부 통과하는지 확인한다**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck 무출력, 전체 PASS

- [ ] **Step 9: 사보타주로 가드가 여전히 무는지 확인한다**

`src/cli/guard.ts` 에서 `if (used && !cap.search[axis].supported)` 를 `if (false)` 로 바꾸고:

Run: `npx vitest run tests/cli/guard.test.ts`
Expected: FAIL — "미지원 검색 축은 빈 결과가 아니라 exit 3 이다" 가 깨진다

되돌린 뒤 다시 `npx vitest run` 이 전부 통과하는지 확인한다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "feat(core): make capability declare content, not existence

A boolean said an axis existed and nothing else, so a zero could not
be told apart from an axis that never looked (F2), the accepted values
only surfaced by guessing wrong (F5, F9), and results: true was read as
'searchable by whether results exist' (F14).

Each search axis now carries values, exhaustive and scope; results,
count and the detail sections carry supported and scope. Values come
from the tables each adapter already uses to build filters, and
exhaustive is the measurement from the field-test scripts.

Breaking by intent: version 0.1.0 with no npm release, every reader of
the boolean is inside this repo, and the skill names no fields at all.
Keeping both shapes would write one fact in two places, which has
already gone wrong twice here."
```

---

### Task 5: `exhaustive: false` 축으로 필터하면 경고한다

F8 의 사용 시점 절반이다. 경고는 **가드**에서 낸다 — 어댑터마다 복제하면 M3(페이지 크기)에서 방금 고친 것과 같은 문제가 된다.

**Files:**
- Modify: `src/cli/guard.ts`
- Modify: `src/cli/commands/search.ts:31`, `get.ts:81`, `count.ts:30`
- Test: `tests/cli/guard.test.ts`, `tests/cli/commands.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `cap.search[axis].exhaustive`
- Produces: `assertSupported(cap, q, fetch): { warnings: Warning[] }` — 반환형이 `void` 에서 바뀐다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/cli/guard.test.ts` 의 `describe('capability 가드', ...)` 안에 덧붙인다:

```ts
  /**
   * F8. 값별 건수를 아무리 정확히 세도 합이 총계에 못 미치는데, 모자란 부분에 이름을
   * 붙일 수단이 없었다. 필터를 거는 시점에 그 사실을 말한다 — 날짜 축이 이미
   * `date_filter_excludes_missing` 으로 하는 것과 같은 자리·같은 모양이다.
   */
  it('exhaustive:false 인 축으로 필터하면 경고를 낸다', () => {
    const notExhaustive: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: false } },
    };
    const r = assertSupported(notExhaustive, { phase: ['phase_3'] }, fetchOpts);
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: 'vocab_excludes_missing', registry: 'ctgov' }),
    ]);
    expect(r.warnings[0]!.message).toContain('phase');
  });

  it('exhaustive:true 인 축은 경고하지 않는다', () => {
    const exhaustive: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: true } },
    };
    expect(assertSupported(exhaustive, { phase: ['phase_3'] }, fetchOpts).warnings).toEqual([]);
  });

  it('그 축을 쓰지 않으면 경고하지 않는다 — 선언만으로는 경고가 나오지 않는다', () => {
    const notExhaustive: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: false } },
    };
    expect(assertSupported(notExhaustive, { condition: 'x' }, fetchOpts).warnings).toEqual([]);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/cli/guard.test.ts`
Expected: FAIL — `assertSupported(...)` 가 `undefined` 를 돌려줘 `.warnings` 를 읽을 수 없다

- [ ] **Step 3: 구현한다**

`src/cli/guard.ts` 의 `assertSupported` 반환형과 끝부분을 바꾼다:

```ts
export function assertSupported(
  cap: Capability,
  q: NormalizedQuery,
  fetch: FetchOpts,
): { warnings: Warning[] } {
```

축 루프 안에서 `used` 이고 지원되는 축에 대해 수집한다. 두 detail 루프 뒤, 함수 끝에 덧붙인다:

```ts
  /**
   * 축은 지원되는데 그 축의 어휘가 데이터를 다 덮지 못하는 경우(F8). 값별 건수의
   * 합이 전체 총계보다 작다는 사실을 필터를 거는 **시점에** 말한다 — 선언만으로는
   * 미리 읽은 호출자만 알게 되고, 필드 테스트에서 에이전트가 뺄셈으로 발견한 상황이
   * 그대로 남는다. 날짜 축의 date_filter_excludes_missing 과 같은 모양이고, 어느
   * 쪽도 종료 코드를 바꾸지 않는다.
   */
  const warnings: Warning[] = [];
  for (const [axis, used] of axes) {
    if (used && cap.search[axis].supported && cap.search[axis].exhaustive === false) {
      warnings.push({
        code: 'vocab_excludes_missing',
        message:
          `${cap.name} 의 '${axis}' 를 게시한 시험만 매칭합니다. ` +
          '이 축으로 나눈 건수의 합은 전체 총계보다 작습니다 — 값을 기재하지 않은 시험이 결과에서 빠집니다.',
        registry: cap.key,
      });
    }
  }
  return { warnings };
```

`import type { Capability, Warning } from '../core/capability.js';` 로 넓힌다.

- [ ] **Step 4: 세 호출 지점이 경고를 싣게 한다**

`src/cli/commands/search.ts:31`:

```ts
      warnings.push(...assertSupported(adapter.capability(), args.query, args.fetch).warnings);
```

`src/cli/commands/count.ts:30` 도 같은 모양으로. `src/cli/commands/get.ts:81` 은 빈 쿼리를 넘기므로 축 경고가 나올 일이 없지만 형태를 맞춘다:

```ts
      warnings.push(...assertSupported(adapter.capability(), {}, args.fetch).warnings);
```

> 세 파일 모두 이미 `warnings` 배열을 갖고 있다. `get.ts` 는 `warnings` 이름이 다를 수 있으니 해당 함수의 지역 배열을 확인하고 맞춘다.

- [ ] **Step 5: 봉투까지 도달하는지 확인하는 테스트를 쓴다**

`tests/cli/commands.test.ts` 에 덧붙인다:

```ts
describe('vocab_excludes_missing 는 봉투까지 간다', () => {
  /**
   * 가드가 경고를 만들어도 커맨드가 봉투에 싣지 않으면 사용자에게 도달하지 않는다.
   * 이 저장소에서 같은 형태의 구멍이 세 번 났다 — 고친 함수가 아니라 **부르는 자리**
   * 를 검사한다.
   */
  it('search 가 exhaustive:false 축 경고를 봉투에 싣는다', async () => {
    const cap: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: false } },
    };
    const env = await runSearch(parseCliArgs(['search', '--condition', 'X', '--phase', 'phase_3']), stubAdapter({}, cap));
    expect(env.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'vocab_excludes_missing' })]),
    );
  });

  it('count 도 같은 경고를 싣는다', async () => {
    const cap: Capability = {
      ...CTGOV_CAPABILITY,
      search: { ...CTGOV_CAPABILITY.search, phase: { ...CTGOV_CAPABILITY.search.phase, exhaustive: false } },
    };
    const env = await runCount(parseCliArgs(['count', '--condition', 'X', '--phase', 'phase_3']), stubAdapter({}, cap));
    expect(env.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'vocab_excludes_missing' })]),
    );
  });
});
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npm run typecheck && npx vitest run`
Expected: 전부 PASS

- [ ] **Step 7: 사보타주 — 호출 자리를 겨눈다**

`src/cli/commands/search.ts` 의 `warnings.push(...assertSupported(...).warnings)` 에서 `.warnings` 를 떼고 `assertSupported(...)` 만 부르게 바꾼다(경고를 버린다).

Run: `npx vitest run tests/cli/commands.test.ts`
Expected: FAIL — "search 가 exhaustive:false 축 경고를 봉투에 싣는다" 가 깨진다

되돌린 뒤 `npx vitest run` 이 전부 통과하는지 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat(cli): warn when a filter's vocabulary does not cover the data

Second half of F8. The declaration alone only reaches a caller who
read it first, which leaves the field-test situation intact — the
agent found the shortfall by subtracting counts and had no name for
it. Filtering on a non-exhaustive axis now says so at the moment of
use, the same shape the date axes already use.

The warning is built in the guard rather than in each adapter's query
builder: duplicating it per adapter recreates the problem just fixed
for page size, where a policy drifts into a different silence per
registry. Verified by sabotage at the call site, not the function."
```

---

### Task 6: 계약 스위트가 선언과 구현의 어긋남을 잡는다

**Files:**
- Modify: `tests/contract/adapter-contract.ts`

**Interfaces:**
- Consumes: Task 4 의 `SearchAxis`
- Produces: 없음 (검사만)

- [ ] **Step 1: 검사를 쓴다**

`tests/contract/adapter-contract.ts` 의 `describe` 안, 선언 검사들 옆에 덧붙인다:

```ts
    /**
     * 신고해 놓고 거부하는 어댑터를 잡는다. **이 검사를 쓰기 직전까지 ISRCTN 이
     * 정확히 그랬다** — phase 어휘에 early_phase_1 자리가 없어 exit 2 로 거부하는데
     * 선언에는 그 사실이 없었다. 신고와 구현이 어긋나면 사용자는 부딪혀야만 안다.
     */
    it('신고한 values 는 전부 실제로 질의로 조립된다', async () => {
      const cap = makeAdapter().capability();
      const probes: [string, string[], (v: string) => NormalizedQuery][] = [
        ['status', cap.search.status.values ?? [], (v) => ({ status: [v as never] })],
        ['phase', cap.search.phase.values ?? [], (v) => ({ phase: [v as never] })],
        ['studyType', cap.search.studyType.values ?? [], (v) => ({ studyType: v as never })],
      ];
      for (const [axis, values, probe] of probes) {
        for (const v of values) {
          const { adapter } = ok();
          await expect(
            adapter.search(probe(v), fetchOpts),
            `'${axis}' 에 '${v}' 를 신고해 놓고 그 값으로 검색하면 실패합니다 — ` +
              '선언과 구현이 어긋나면 사용자는 부딪혀야만 알게 됩니다.',
          ).resolves.toBeDefined();
        }
      }
    });

    /**
     * `supported: false` 인데 `values` 에 뭔가 들어 있으면 두 선언이 서로를 부정한다.
     * 읽는 쪽은 어느 쪽을 믿어야 할지 알 수 없다.
     */
    it('지원하지 않는 축은 values 가 비어 있다', () => {
      const cap = makeAdapter().capability();
      for (const [name, axis] of Object.entries(cap.search) as [string, SearchAxis][]) {
        if (axis.supported) continue;
        expect(axis.values ?? [], `'${name}' 은 supported:false 인데 values 가 비어 있지 않습니다`).toEqual([]);
        expect(axis.exhaustive, `'${name}' 은 supported:false 인데 exhaustive 가 null 이 아닙니다`).toBeNull();
      }
    });
```

`import { ... type SearchAxis } from '../../src/core/capability.js';` 를 더한다.

- [ ] **Step 2: 통과를 확인한다**

Run: `npx vitest run tests/contract/`
Expected: PASS (Task 4 에서 선언을 바르게 썼다면)

- [ ] **Step 3: 사보타주로 검사가 무는지 확인한다**

`src/adapters/isrctn/adapter.ts` 의 `phase.values` 를 `[...ISRCTN_FILTERABLE.phase, 'early_phase_1' as never]` 로 바꾼다.

Run: `npx vitest run tests/contract/isrctn.contract.test.ts`
Expected: FAIL — "'phase' 에 'early_phase_1' 를 신고해 놓고 그 값으로 검색하면 실패합니다"

되돌린다. 이어서 `status.values` 를 `['recruiting' as never]` 로 바꾼다(supported 는 false 그대로).

Run: `npx vitest run tests/contract/isrctn.contract.test.ts`
Expected: FAIL — "'status' 은 supported:false 인데 values 가 비어 있지 않습니다"

되돌린 뒤 `npx vitest run` 전체 통과 확인.

- [ ] **Step 4: 커밋**

```bash
git add tests/contract/adapter-contract.ts
git commit -m "test(contract): catch a declaration that its own adapter refuses

Until this check, ISRCTN declared nothing about early_phase_1 while
rejecting it with exit 2 — the declaration and the implementation
disagreed and only a user hitting the wall would find out. Every value
an adapter declares must actually assemble into a query, and an axis
declared unsupported must not also list values.

Both sabotages verified: adding early_phase_1 to the declared list
trips the first, listing a value on the dead status axis trips the
second."
```

---

### Task 7: `--help` 가 값 어휘를 적는다

F9. 지금은 대소문자 규칙도 값 목록도 **틀린 값을 넣었을 때만** 말한다.

**Files:**
- Modify: `src/cli/args.ts:12-33` (USAGE)
- Test: `tests/cli/args.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `FILTERABLE_*`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/cli/args.test.ts` 끝에 덧붙인다:

```ts
import { USAGE } from '../../src/cli/args.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../../src/core/vocab.js';

describe('--help 는 값 어휘를 적는다', () => {
  /**
   * F9. 세 시나리오가 `--status` 에 대문자를, `--phase` 에 틀린 값을 넣어 거부당했고
   * **셋 다 같은 힌트**를 받았다. --help 가 값을 적지 않아 틀려 봐야만 알 수 있었다.
   * 목록을 어휘에서 파생해 적으면 어휘가 늘어도 --help 가 저절로 따라간다.
   */
  it('세 닫힌 어휘의 값을 전부 적는다', () => {
    for (const v of FILTERABLE_STATUS) expect(USAGE, `--status 값 '${v}' 가 --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_PHASE) expect(USAGE, `--phase 값 '${v}' 가 --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_STUDY_TYPE) expect(USAGE, `--study-type 값 '${v}' 가 --help 에 없습니다`).toContain(v);
  });

  /**
   * --help 는 **이 CLI 가 받는 값**을, registries 는 **각 레지스트리가 그 값으로
   * 무엇을 하는가**를 말한다. 여기서 레지스트리별 차이까지 적으면 같은 사실이 두
   * 곳에 살게 되고, 이 저장소에서 그렇게 했다가 한쪽만 갱신된 사고가 이미 두 번 있었다.
   */
  it('레지스트리별 차이는 적지 않고 registries 로 보낸다', () => {
    expect(USAGE).toContain('ctreg registries');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — `--status 값 'recruiting' 가 --help 에 없습니다`

- [ ] **Step 3: 구현한다**

`src/cli/args.ts` 의 `USAGE` 를 템플릿 리터럴 보간으로 바꾼다. `필터` 줄을 이렇게 교체한다:

```ts
필터      --status ${FILTERABLE_STATUS.join('|')}
          --phase ${FILTERABLE_PHASE.join('|')}
          --study-type ${FILTERABLE_STUDY_TYPE.join('|')}
          (셋 다 반복 가능. 값은 소문자다 — 레지스트리 원문 값이 아니라 공통 어휘다)
          --near <lat,lon> --radius <N>km|mi
          --updated-since --updated-before --start-after --start-before
          --completion-after --completion-before   (YYYY-MM-DD)
```

그리고 exit 설명 위에 한 줄 더한다:

```ts
레지스트리마다 받는 값이 다르다. 어느 축을 어떤 값으로 쓸 수 있는지는 `ctreg registries` 가 말한다.
```

`import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../core/vocab.js';` 를 더한다.

- [ ] **Step 4: 통과를 확인하고 눈으로도 본다**

Run: `npx vitest run tests/cli/args.test.ts && npm run build && node dist/cli/bin.js --help`
Expected: PASS, 그리고 `--help` 출력에 세 축의 값 목록이 보인다

- [ ] **Step 5: 커밋**

```bash
git add src/cli/args.ts tests/cli/args.test.ts
git commit -m "feat(cli): put the value vocabulary in --help

F9. Three scenarios sent an uppercase status or a wrong phase and all
three got the same hint — after being wrong. --help named the flags
and never their values, so the only way to learn them was to guess.

The lists interpolate from the vocabulary, so adding a value updates
--help by itself. Per-registry differences stay out and point at
ctreg registries instead: one fact, one place."
```

---

### Task 8: README 와 선결 조건 문서를 갱신한다

**Files:**
- Modify: `README.md` (`ctreg registries` 절, ISRCTN 표)
- Modify: `docs/slice-2-prerequisites.md`
- Modify: `docs/agent-field-test-2026-08-22.md` (우선순위 절에 해소 표시)

- [ ] **Step 1: README 의 registries 예시를 새 모양으로 바꾼다**

`### ctreg registries` 절의 JSON 예시를 실제 출력에서 가져온다:

Run: `node dist/cli/bin.js registries` — 출력에서 `ctgov` 의 `search.status`·`search.term`, `results`, 그리고 `isrctn` 의 `search.status`·`search.startRange` 를 발췌해 예시로 넣는다.

예시 아래 설명 문단을 이렇게 바꾼다:

```markdown
`false` 를 읽는 것이 이 커맨드의 요점이지만, 이제 `true` 도 내용을 말한다 —
`values` 는 그 축이 받는 값 목록(자유 텍스트 축은 `null`), `exhaustive` 는 그 값들이
데이터를 다 덮는지, `scope` 는 그 축이 실제로 무엇을 보는지다. `results` 의 `scope` 가
"결과 유무로 검색하는 것이 아니다" 라고 적는 이유는 실제로 그렇게 오독됐기 때문이다.

**네트워크를 전혀 타지 않는다.**
```

- [ ] **Step 2: README 의 ISRCTN 표에 값 어휘 행을 더한다**

"ISRCTN 으로는 할 수 없는 것" 표 아래에 덧붙인다:

```markdown
같은 축이라도 **받는 값이 다르다.** ISRCTN 의 phase 어휘에는 `early_phase_1` 자리가
없고 studyType 에는 `expanded_access` 가 없다. `ctreg registries` 의 `search.<축>.values`
가 레지스트리별 목록을 그대로 낸다 — 부딪혀서 알 필요가 없다.
```

- [ ] **Step 3: 두 문서에 해소 표시를 남긴다**

`docs/agent-field-test-2026-08-22.md` 의 `### CLI-FIX 우선순위` 5번 줄 아래에 인용문을 넣는다:

```markdown
> **해소됨 (2026-08-23).** 다섯을 하나의 설계로 함께 고쳤다 —
> `docs/superpowers/specs/2026-08-23-capability-says-content-design.md`.
> 축이 `values`·`exhaustive`·`scope` 를 신고하고, `--help` 가 값 어휘를 적으며,
> `exhaustive: false` 축으로 필터하면 `vocab_excludes_missing` 이 붙는다.
```

`docs/slice-2-prerequisites.md` 의 F2·F5·F8·F14 절 첫머리에 같은 취지의 한 줄씩을 넣는다(F9 는 이 문서에 절이 없다).

- [ ] **Step 4: 최종 검증**

Run: `npm run typecheck && npx vitest run && npm run build && node dist/cli/bin.js registries`
Expected: 전부 통과, `registries` 가 새 모양으로 나온다

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/
git commit -m "docs: record that the declaration now says content

Update the registries example to the new shape, say what values,
exhaustive and scope each mean, and note that the two registries take
different subsets of the same vocabulary. Mark priority item 5 closed
in the canonical field-test list."
```

---

## 자체 검토 기록

**스펙 대조:** §3.1 → Task 4 Step 3 · §3.2 → Task 4 Step 3 · §3.3 → Task 4 커밋 메시지 · §4 → Task 2 · §5 → Task 3(측정) + Task 5(경고) · §6 → Task 7 · §7.1 → Task 6 Step 1 · §7.2 → Task 6 Step 1 · §7.3 → 검사로 만들지 않기로 한 항목이라 태스크 없음(의도됨) · §8 파일 목록 → Task 1~8 이 전부 덮는다.

**스펙 정정:** §5 의 "호출 지점은 다섯 커맨드다"는 틀렸다 — 셋이다(`search`·`get`·`count`). Task 5 가 셋만 고친다.

**타입 일관성:** `SearchAxis`·`Feature` 는 Task 4 에서 정의되고 Task 6 이 `SearchAxis` 를 import 한다. `CTGOV_FILTERABLE`·`ISRCTN_FILTERABLE` 은 Task 2 에서 정의되고 Task 3·4 가 읽는다. `assertSupported` 의 반환형 변경은 Task 5 안에서 정의와 세 호출 지점이 함께 바뀐다.

**순서 의존:** Task 3 이 Task 4 보다 앞이다 — `exhaustive` 는 측정값이라 재고 나서 선언해야 한다. Task 3 은 Task 2 의 값 목록만 필요하고 새 capability 모양은 필요 없으므로 이 순서가 성립한다.
