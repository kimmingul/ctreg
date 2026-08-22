# 슬라이스 2 준비 — 필드 테스트 결함 수정 + 어댑터 #2 선결 조건

> **에이전트 작업자에게:** 필수 하위 스킬 — superpowers:subagent-driven-development 로 태스크별로 구현한다.

**목표:** 에이전트 필드 테스트가 찾은 CLI 결함 중 우선순위 상위 셋을 고치고, 어댑터 #2 를 붙이기 전에 반드시 해결해야 할 선결 조건 넷을 해소한다.

**아키텍처:** 기존 구조를 바꾸지 않는다. F1 은 `FetchOpts.near` 가 이미 확립한 "표현 계층" 패턴을 대칭으로 확장한다. 선결 조건들은 이미 선언된 채널(`caps`, `limits`, `Record`)에 소비자를 붙이는 일이다.

**기술 스택:** TypeScript(ESM), Bun(개발), vitest, zod v4.

**스펙:** `docs/agent-field-test-2026-08-22.md`(판정과 근거) + `docs/slice-2-prerequisites.md`(선결 조건). 두 문서가 이 계획의 권위다.

## Global Constraints

- **absent-means-absent** — 값이 없으면 필드를 생략한다. `null`·`""`·`0`·빈 컨테이너를 쓰지 않는다.
- **조용히 좁히지 않는다** — 모든 절단·암묵적 축소는 `warnings[]` 에 항목을 남긴다. 조용히 *넓히는* 것도 같다.
- **종료 코드 계약** — 0 정상(0건 포함) · 2 사용법 · 3 미지원 · 4 업스트림 · 5 부분 실패. 이 다섯 외의 코드로 끝나지 않는다.
- 산문·주석·경고 메시지는 한국어. 식별자와 코드값은 영어.
- 커밋은 `git add <경로>` 후 `git commit ... -- <같은 경로>`. 인덱스 사고가 이 저장소에서 두 번 났다.
- 어떤 태스크도 서브에이전트를 띄우지 않는다.

---

## Task 1: F7 — 파이프가 일찍 닫혀도 크래시하지 않는다

**Files:**
- Modify: `src/cli/bin.ts`
- Test: `tests/cli/epipe.test.ts` (신규)

**근거:** `ctreg search ... | head` 가 `Error: write EPIPE` 와 원시 Node 스택트레이스를 내고 **exit 1** 로 죽는다. 1 은 공표된 계약(0/2/3/4/5)에 없는 코드다. 100% 재현되고 `head`·`grep -m1`·조기 종료하는 파서 전부에서 난다. S6 에이전트가 여기 걸렸다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/cli/epipe.test.ts`:

```ts
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const BIN = new URL('../../dist/cli/bin.js', import.meta.url).pathname;

/** 빌드 산출물을 실제 프로세스로 띄워 파이프를 조기에 닫는다. */
function pipeThroughHead(): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile('sh', ['-c', `node ${BIN} registries | head -c 10`], (_e, _o, stderr) => {
      resolve({ code: child.exitCode, stderr });
    });
  });
}

describe('출력 파이프가 일찍 닫힐 때', () => {
  it('스택트레이스를 내지 않는다', async () => {
    const { stderr } = await pipeThroughHead();
    expect(stderr).not.toContain('EPIPE');
    expect(stderr).not.toContain('node:internal');
  });
});
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `bun run build && bunx vitest run tests/cli/epipe.test.ts`
Expected: FAIL — stderr 에 `EPIPE` 와 `node:internal` 이 들어 있다.

- [ ] **Step 3: 최소 구현**

`src/cli/bin.ts` 를 아래로 바꾼다:

```ts
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `bun run build && bunx vitest run tests/cli/epipe.test.ts` → PASS
전체: `bunx vitest run` → 기존 278 + 1

- [ ] **Step 5: 커밋**

```bash
git add src/cli/bin.ts tests/cli/epipe.test.ts
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "fix(cli): a closed pipe is not an error" -- src/cli/bin.ts tests/cli/epipe.test.ts
```

---

## Task 2: F1 + F11 — 필터에 걸린 사이트를 잘라내지 않는다

**Files:**
- Modify: `src/core/query.ts`(FetchOpts 확장), `src/cli/args.ts`(조립), `src/adapters/ctgov/map.ts`(정렬·경고)
- Test: `tests/adapters/ctgov/map.test.ts`

**Interfaces:**
- Produces: `FetchOpts.locationTerm?: string`

**근거 (필드 테스트 최대 발견):** `--location Seoul` 로 걸린 시험 100건 중 **81건**이 반환된 `locations` 에 한국 사이트를 하나도 담지 않는다. 그 시험들은 서울 사이트가 있어서 선택됐는데 도구가 앞에서 10개만 잘라 보여준다. `--near` 는 거리순 정렬을 하므로 같은 문제가 없다 — **두 경로가 다르다는 사실을 알려주는 것이 출력에 없다.** 업스트림은 위치 102개를 상태와 함께 준다. 정보는 있고 우리가 버린다.

F11 도 같이 고친다: 경고 문구가 무엇이 잘렸는지 말하지 않아 S1 이 "검색 결과가 잘렸다"로 오해할 뻔했다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/adapters/ctgov/map.test.ts` 에 추가한다:

```ts
  it('--location 으로 좁혔으면 매칭된 장소가 잘림에서 살아남는다', () => {
    const study = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000001' },
        contactsLocationsModule: {
          locations: [
            ...Array.from({ length: 15 }, (_, i) => ({ city: `Elsewhere${i}`, country: 'United States' })),
            { facility: 'Seoul National University Hospital', city: 'Seoul', country: 'South Korea' },
          ],
        },
      },
    };
    const { record, warnings } = mapStudy(study, { ...baseOpts, locationTerm: 'Seoul' }, FETCHED_AT);
    expect(record.locations).toHaveLength(CAPS.locations.default);
    expect(record.locations!.some((l) => l.city === 'Seoul')).toBe(true);
    expect(warnings.find((w) => w.code === 'locations_truncated')?.message).toContain('일치하는 장소를 앞에');
  });

  it('locationTerm 이 없으면 원래 순서를 유지한다', () => {
    const study = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000002' },
        contactsLocationsModule: {
          locations: Array.from({ length: 12 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const { record } = mapStudy(study, baseOpts, FETCHED_AT);
    expect(record.locations!.map((l) => l.city)).toEqual(
      Array.from({ length: CAPS.locations.default }, (_, i) => `City${i}`),
    );
  });

  it('경고가 무엇이 잘렸는지 말한다 — 검색 결과가 아니라 이 시험의 장소', () => {
    const study = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000003' },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const { warnings } = mapStudy(study, baseOpts, FETCHED_AT);
    expect(warnings.find((w) => w.code === 'locations_truncated')?.message).toContain('이 시험의 장소');
  });
```

- [ ] **Step 2: 돌려서 실패를 확인한다**

Run: `bunx vitest run tests/adapters/ctgov/map.test.ts`
Expected: FAIL — `locationTerm` 이 타입에 없고, 서울이 잘려나가고, 경고 문구가 다르다.

- [ ] **Step 3: `FetchOpts` 에 표현 계층 대칭을 추가한다**

`src/core/query.ts` 의 `FetchOpts` 에서 `near` 바로 아래에 붙인다:

```ts
  /**
   * 조회를 좁힌 장소 문자열. `NormalizedQuery.location` 은 검색 필터(등록 축소)이고,
   * 이건 매퍼가 캡을 적용하기 전에 일치하는 사이트를 앞으로 보내기 위한 것이다.
   * `near` 와 정확히 같은 계층이다 — 필드 테스트에서 `--location` 으로 걸린 시험의
   * 81% 가 반환된 장소 목록에 매칭 사이트를 하나도 담지 못했다. 필터에 걸린 근거를
   * 잘라내고 보여주면 사용자는 그 시험이 왜 걸렸는지 알 수 없다.
   */
  locationTerm?: string;
```

- [ ] **Step 4: 매퍼가 그것을 쓰게 한다**

`src/adapters/ctgov/map.ts` 의 정렬·캡 블록(현재 102~112행)을 아래로 바꾼다:

```ts
    if (o.near) {
      const center = o.near;
      mapped = mapped
        .map((l) => (l.geo ? { ...l, distanceKm: haversineKm(center, l.geo) } : l))
        .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
    } else if (o.locationTerm) {
      const needle = o.locationTerm.toLowerCase();
      const hit = (l: TrialLocation) =>
        [l.facility, l.city, l.state, l.country].some((f) => f?.toLowerCase().includes(needle));
      // 안정 분할: 일치하는 것을 원래 순서대로 앞에, 나머지를 원래 순서대로 뒤에.
      mapped = [...mapped.filter(hit), ...mapped.filter((l) => !hit(l))];
    }
    const cap = want('locations') ? CAPS.locations.max : o.caps.locations;
    if (mapped.length > cap) {
      const ordered = o.near
        ? ' 가까운 순으로 정렬했습니다.'
        : o.locationTerm
          ? ` '${o.locationTerm}' 에 일치하는 장소를 앞에 두었습니다.`
          : '';
      warnings.push({
        code: 'locations_truncated',
        message: `이 시험의 장소 ${mapped.length}곳 중 ${cap}곳만 담았습니다.${ordered}`,
        id,
        at: cap,
      });
      mapped = mapped.slice(0, cap);
    }
```

- [ ] **Step 5: 조립부가 값을 넘기게 한다**

`src/cli/args.ts` 에서 `FetchOpts` 를 만드는 두 곳(현재 220행 근처와 243행 근처)에 정규화된 질의의 `location` 을 `locationTerm` 으로 넘긴다. **`near` 를 넘기는 것과 같은 자리다** — 그 코드를 찾아 대칭으로 추가하라. 값이 없으면 필드를 생략한다(absent-means-absent).

- [ ] **Step 6: 통과 확인**

Run: `bunx vitest run` → 기존 + 3 전부 통과. `bunx tsc -p tsconfig.typecheck.json --noEmit` 클린.

- [ ] **Step 7: 실물로 확인한다 — 이것이 이 태스크의 진짜 합격 기준**

```bash
bun run build
export PATH=/tmp/ctreg-bin:$PATH CTREG_CACHE_DIR=/tmp/ctreg-f1
ctreg search --condition "non-small cell lung cancer" --status recruiting --location Seoul --page-size 100 \
 | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d["data"]; n=sum(1 for x in r if not [l for l in (x.get("locations") or []) if l.get("country")=="South Korea"]); print("한국 사이트 0개인 시험:", n, "/", len(r))'
```

수정 전에는 100건 중 81건이었다. **10건 미만이어야 한다.** 그보다 크면 구현이 틀렸다.

- [ ] **Step 8: 커밋**

```bash
git add src/core/query.ts src/cli/args.ts src/adapters/ctgov/map.ts tests/adapters/ctgov/map.test.ts
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "fix(ctgov): keep the site that matched the filter" -- src/core/query.ts src/cli/args.ts src/adapters/ctgov/map.ts tests/adapters/ctgov/map.test.ts
```

---

## Task 3: F10 — `exit 5` 가 무엇인지 도구가 말한다

**Files:**
- Modify: `src/cli/index.ts` 또는 도움말 문자열이 있는 파일(먼저 `grep -rn "exit: 0 정상" src/` 로 찾아라)
- Test: `tests/cli/run.test.ts`

**근거:** `--help` 가 "5 부분 실패"라고만 하고 언제 뜨는지 말하지 않는다. S4 에이전트가 경고 둘에 exit 0 을 받고 "5 가 언제 뜨는지 도구가 설명하지 않아 추측으로 남긴다"고 명시적으로 보고했다. exit 5 는 **레지스트리 단위**이고 레지스트리가 하나뿐인 지금은 도달 불가다 — **두 번째 어댑터가 붙는 순간 처음 발생한다.** 스킬이 가르치는 첫 규율이 "종료 코드로 분기하라"이므로 에이전트는 반드시 이 코드를 만난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/cli/run.test.ts` 에 추가:

```ts
  it('도움말이 exit 5 가 언제 나는지 말한다 — 경고가 아니라 레지스트리 실패', () => {
    // (이 파일의 기존 관례대로 --help 를 실행해 stdout/stderr 를 잡는다)
    const help = /* 기존 헬퍼로 --help 출력을 얻는다 */ '';
    expect(help).toContain('레지스트리');
    expect(help).toMatch(/5[^\n]*레지스트리/);
  });
```

**주의:** 이 파일의 기존 테스트가 `--help` 를 어떻게 실행하는지 먼저 읽고 그 관례를 따르라. 위 주석 자리를 실제 호출로 채워라.

- [ ] **Step 2: 실패 확인** — Run: `bunx vitest run tests/cli/run.test.ts`

- [ ] **Step 3: 도움말 한 줄을 고친다**

현재:
```
exit: 0 정상 · 2 사용법 · 3 미지원 · 4 업스트림 · 5 부분 실패
```
바꾼다:
```
exit: 0 정상(0건 포함) · 2 사용법 · 3 미지원 · 4 업스트림
      5 부분 실패 — 일부 레지스트리만 성공. 경고는 종료 코드를 바꾸지 않는다.
```

**마지막 절이 핵심이다.** S4 가 헷갈린 것은 "경고가 둘인데 왜 0인가"였다. 경고와 종료 코드가 다른 축이라는 것을 도구가 말해야 한다.

- [ ] **Step 4: 통과 확인** — `bunx vitest run`

- [ ] **Step 5: 커밋**

```bash
git add src/cli/ tests/cli/run.test.ts
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "docs(cli): say when exit 5 happens and that warnings do not change the code" -- src/cli tests/cli/run.test.ts
```

---

## Task 4: 선결 1 — `caps` 채널이 실제로 정책을 나른다

**Files:**
- Modify: `src/core/query.ts`, `src/cli/args.ts`, `src/adapters/ctgov/map.ts`
- Test: `tests/adapters/ctgov/map.test.ts`, `tests/cli/args.test.ts`

**근거(최종 리뷰 I3):** `caps.outcomes` 는 아무도 읽지 않고 `caps.locations` 는 어댑터가 덮어쓴다. 문서화된 채널을 성실히 따르는 어댑터 #2 는 스펙 §5.2 를 양방향으로 어긴다. `CAPS.outcomes.default` 가 죽은 상수인 것이 같은 문제의 증상이다 — **상수만 지우면 채널이 망가졌다는 증거가 사라지므로 둘을 함께 고친다.**

- [ ] **Step 1** — `grep -rn "caps.outcomes\|caps.locations" src/` 로 모든 생산·소비 지점을 찾아 목록을 만든다. 보고서에 그 목록을 적는다.
- [ ] **Step 2** — 실패하는 테스트: `caps.outcomes` 를 3 으로 준 요청이 결과 섹션의 outcome 을 3개로 자르고 `outcomes_truncated` 경고를 남긴다. `caps.locations` 를 5 로 준 요청이 5개를 낸다(어댑터가 덮어쓰지 않는다).
- [ ] **Step 3** — 실패 확인.
- [ ] **Step 4** — 매퍼가 `o.caps.outcomes` 를 읽어 자르고 경고하게 한다. `want('locations')` 가 캡을 `CAPS.locations.max` 로 올리는 현재 동작은 **정책이 아니라 덮어쓰기**다 — `--include locations` 는 `args.ts` 에서 `caps.locations` 를 올리고, 매퍼는 언제나 `o.caps.locations` 만 읽게 바꾼다.
- [ ] **Step 5** — 통과 확인, 전체 스위트.
- [ ] **Step 6** — 커밋: `fix(core): make the caps channel carry policy in one direction`

---

## Task 5: 선결 2 — 선언된 `limits` 에 소비자를 붙인다

**Files:**
- Modify: `src/runtime/throttle.ts`, `src/runtime/http.ts`, `src/cli/args.ts`, `src/cli/guard.ts`
- Test: `tests/runtime/throttle.test.ts`, `tests/cli/guard.test.ts`

**근거(최종 리뷰 I5):** `limits.maxPageSize`·`limits.ratePerSec`·`search.geoNeedsCoords` 가 capability 에 선언되지만 아무도 읽지 않는다. 스펙 §6.2 는 레지스트리마다 예산이 다르다고 하는데 런타임은 전역 요청률 하나를 쓴다 — **어댑터 #2 가 다른 예산을 선언해도 무시된다.**

- [ ] **Step 1** — 세 값 각각의 선언 지점과 (없는) 소비 지점을 찾아 목록화한다.
- [ ] **Step 2** — 실패하는 테스트 셋:
  - 서로 다른 `ratePerSec` 를 선언한 두 레지스트리가 **각자의 버킷**을 쓴다(하나가 느려도 다른 하나가 막히지 않는다).
  - `--page-size` 가 그 레지스트리의 `limits.maxPageSize` 를 넘으면 exit 2 이고, 넘지 않으면 통과한다.
  - `geoNeedsCoords: true` 인 레지스트리에 지명 문자열로 `--near` 를 주면 exit 2 이고 힌트가 좌표 형식을 말한다.
- [ ] **Step 3** — 실패 확인.
- [ ] **Step 4** — 구현. 스로틀 버킷을 레지스트리 키로 분리한다. 온디스크 락파일 경로도 키별로 나뉘어야 한다.
- [ ] **Step 5** — 통과 확인.
- [ ] **Step 6** — 커밋: `fix(runtime): give each registry its own declared budget`

---

## Task 6: 선결 3 — 어댑터 없는 레지스트리 키를 타입이 허용한다

**Files:**
- Modify: `src/core/registry.ts`, `src/adapters/index.ts`, `src/cli/commands/*.ts`
- Test: 기존 커맨드 테스트

**근거(최종 리뷰 I7):** 다섯 커맨드 시그니처가 전체 `Record<RegistryKey, RegistryAdapter>` 를 요구해서 스펙이 계획한 "심만 비워 둔다"를 타입이 금지한다. 코드 네 군데의 `adapters[key]!` 가 그 증상이다. 측정된 비용은 테스트 호출 지점 10곳.

- [ ] **Step 1** — `Partial<Record<RegistryKey, RegistryAdapter>>` 로 바꾸고 `!` 네 개를 제거한다. 어댑터가 없는 키를 만나면 **exit 3(미지원)** 으로 끝나야 한다 — 크래시가 아니다.
- [ ] **Step 2** — 실패하는 테스트: 등록되었으나 어댑터가 없는 키를 `--registry` 로 지목하면 exit 3 이고 `error.code=unsupported` 다.
- [ ] **Step 3~5** — 구현·통과·커밋: `refactor(core): let a registry key exist before its adapter does`

---

## Task 7: 선결 4 — 계약 스위트의 두 공백을 닫는다

**Files:**
- Modify: `tests/contract/adapter-contract.ts`
- Test: 같은 파일(스위트 자체가 테스트다)

**근거(최종 수정 웨이브 재리뷰):** 스위트가 여섯 사보타주를 잡지만 둘을 놓친다.

- [ ] **Step 1: 경고를 전부 버리는 어댑터가 통과하는 것을 재현한다**

먼저 **사보타주를 실제로 만들어라** — 모든 `warnings` 를 `[]` 로 반환하는 어댑터 래퍼를 스위트에 넣고, 현재 스위트가 그것을 **통과시키는지** 확인하라. 통과하면 그것이 RED 다. 통과하지 않으면 보고하고 멈춰라(전제가 틀린 것이다).

- [ ] **Step 2** — 절단이 일어나는 입력(장소 37곳)에서 `locations_truncated` 경고의 **존재**를 요구하는 검사를 추가한다. 모양만이 아니라 존재다.

- [ ] **Step 3: `--raw` 의 source 사보타주도 같은 방식으로 재현한다**

`rec.source` 를 얕게 좁힌 어댑터가 현재 통과하는 것을 확인한 뒤, 하네스의 `respond(url)` 이 쥐고 있는 업스트림 본문과 `rec.source` 가 **깊은 동등**인지 요구하는 검사를 추가한다.

- [ ] **Step 4** — 두 사보타주가 이제 잡히는지, 그리고 진짜 ctgov 어댑터는 여전히 통과하는지 확인한다. **둘 다 확인해야 한다** — 사보타주만 잡고 진짜를 떨어뜨리면 검사가 너무 빡빡한 것이다.

- [ ] **Step 5** — 커밋: `test(contract): catch adapters that drop warnings or narrow source`

---

## Task 8: O3 플레이크 — 벽시계 마진 의존을 없앤다

**Files:**
- Modify: `tests/runtime/http.test.ts`

**근거:** 전체 스위트가 간헐적으로 1건 실패하는 것을 **세 번** 목격했다. 세 번 다 전체 스위트
실행 중이었고, 세 번째에 이름을 잡았다 — `tests/runtime/http.test.ts` 의 AbortSignal 타임아웃.

해당 테스트 둘이 실제 타이머에 작은 값을 쓴다: `cfg.timeoutMs = 20`, 그리고
`setTimeout(() => controller.abort(), 5)`. 부하가 걸리면 스케줄링 지연이 이 마진을 넘길 수 있다.

**재현하지 못했다** — 단독 6회·전체 3회를 CPU 부하 하에 돌렸고 앞선 8회를 더해 17회 연속 통과.
그러므로 **"플레이크를 고쳤다"고 주장할 수 없다.** 이 태스크의 목표는 그것이 아니다.

**목표: 테스트가 무엇을 검사하는지 벽시계와 무관하게 만든다.** 두 테스트가 실제로 확인하려는
것은 "abort 가 발동하면 `code: upstream` 으로 던지고 fetch 를 한 번만 부른다"이다. 그것은
타이머 없이도 검사할 수 있다 — 컨트롤러를 직접 abort 시키거나, 주입된 fetch 가 abort 이벤트에
반응하도록 두고 테스트가 그 시점을 결정하면 된다.

- [ ] **Step 1** — 두 테스트를 읽고, 각각이 **실제로 주장하는 것**을 한 문장으로 적는다.
      타이머는 그 주장의 일부인가, 아니면 주장에 도달하는 수단인가?
- [ ] **Step 2** — 수단일 뿐인 곳에서 벽시계 의존을 제거한다. `cfg.timeoutMs` 가 20 이어야만
      하는 이유가 없다면 그 결합을 끊는다. **`AbortSignal.timeout` 자체가 발동한다는 사실을
      검사하는 테스트라면 그것은 남겨야 한다** — 다만 마진을 넉넉히 하고 그 테스트에만
      명시적 timeout 을 준다.
- [ ] **Step 3** — 리팩터 후 두 테스트가 **여전히 회귀를 잡는지 확인하라.** `http.ts` 에서
      abort 처리를 고의로 망가뜨려(예: AbortError 를 upstream 이 아닌 다른 코드로 매핑)
      테스트가 실패하는지 보고, 반드시 원복하라. **실패하지 않으면 리팩터가 검사를 지운 것이다.**
- [ ] **Step 4** — 전체 스위트 10회 반복 실행. 전부 통과해야 한다. **이것이 플레이크가
      사라졌다는 증거는 아니다**(재현한 적이 없으므로) — 리팩터가 새 문제를 만들지 않았다는
      증거일 뿐이다. 보고에 이 구분을 명시하라.
- [ ] **Step 5: 커밋**

```bash
git add tests/runtime/http.test.ts
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "test(runtime): assert abort behaviour without racing the wall clock" -- tests/runtime/http.test.ts
```

---

## 완료 조건

- [ ] F7: `ctreg registries | head -c 10` 이 스택트레이스 없이 끝난다
- [ ] F1: `--location Seoul` 로 걸린 100건 중 한국 사이트 0개인 시험이 10건 미만
- [ ] F10: `--help` 가 exit 5 의 조건과 "경고는 종료 코드를 바꾸지 않는다"를 말한다
- [ ] 선결 1~4 각각의 테스트가 통과
- [ ] 전체 스위트 통과, `bunx tsc -p tsconfig.typecheck.json --noEmit` 클린, `bun run build` 클린
- [ ] O3: `http.test.ts` 가 벽시계 마진에 의존하지 않고, 사보타주로 회귀 검출력을 확인함
- [ ] `docs/slice-2-prerequisites.md` 의 해당 항목에 "해소됨 + 커밋" 표시
