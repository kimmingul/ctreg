# ctreg 얇은 플러그인 + 에이전트 필드 테스트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ctreg` 를 스킬 하나로 감싼 얇은 플러그인을 만들고, 그것을 준 에이전트에게 실제 임상시험 질문 여섯 개를 던져 CLI 자기설명의 결함을 찾는다.

**Architecture:** 플러그인은 스킬 하나만 싣는다(MCP 서버 없음). 스킬은 규율만 가르치고 커맨드·플래그·exit code·경고 코드는 적지 않는다 — CLI 가 스스로 말한다. 그 얇음은 취향이 아니라 측정 장치이고, 테스트로 고정한다. 시나리오 에이전트는 소스를 읽지 못하며 시나리오의 의도를 모른다.

**Tech Stack:** Markdown(SKILL.md), JSON(plugin.json), TypeScript/vitest(얇음을 고정하는 테스트), 기존 `ctreg` 바이너리

**Spec:** `docs/superpowers/specs/2026-08-22-ctreg-plugin-fieldtest-design.md`

## 두 종류의 태스크

이 계획은 성격이 다른 두 종류를 담는다. 실행자는 구분해서 다뤄야 한다.

- **BUILD 태스크 (1, 5, 6)** — 평범한 구현 태스크. 구현자 서브에이전트에게 넘기고 리뷰한다.
- **CONTROLLER 태스크 (2, 3, 4)** — 시나리오 에이전트를 띄우고 그 결과를 판정한다. **구현자에게 넘길 수 없다** — 구현자는 서브에이전트를 띄우지 않는 계약이고, 시나리오 에이전트는 브리핑 계약이 전혀 다르다(§5). 컨트롤러가 직접 수행한다.

## Global Constraints

스펙에서 그대로 옮긴 전역 요구사항. 모든 태스크에 암묵적으로 포함된다.

- **스킬은 커맨드 목록·플래그 목록·exit code 의미 표·경고 코드 목록·출력 형식 설명을 담지 않는다.** 이것은 편의를 위한 생략이 아니라 측정 장치다 — 스킬이 적어두면 에이전트가 그것을 쓸 뿐, CLI 가 그 사실을 전달할 수 있는지는 알 수 없게 된다.
- **예외 하나:** "이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다." 는 스킬에 넣는다. 안전 경계가 실험의 순수성보다 우선한다.
- **시나리오 에이전트는 저장소 소스를 읽지 못한다.** `src/`, `tests/`, `docs/`(스킬 제외) 접근 금지. 읽으면 도구의 자기설명이 아니라 소스에서 답을 얻고 실험이 무의미해진다.
- **시나리오 에이전트에게 예상 실패·시나리오 의도·다른 시나리오의 존재를 알리지 않는다.**
- 시나리오마다 별도 `CTREG_CACHE_DIR` 를 쓴다. CT.gov 요청은 설계상 초당 1건으로 제한되므로 대기 시간을 예산에 넣는다.
- **CLI 수정은 이 계획의 범위 밖이다.** 식별까지가 범위다.
- 산문은 한국어.

---

## 파일 구조

| 경로 | 책임 |
| :-- | :-- |
| `.claude-plugin/plugin.json` | 플러그인 매니페스트. 스킬만 싣는다 |
| `skills/ctreg/SKILL.md` | 규율만 가르치는 한 페이지 |
| `tests/plugin/skill.test.ts` | 스킬의 **얇음** 과 면책 문장을 고정 |
| `docs/agent-field-test-2026-08-22.md` | 시나리오 결과·판정 (Task 4 가 생성) |
| `.superpowers/fieldtest/` | 시나리오 전사 (gitignore, Task 2 가 생성) |

---

## Task 1: 플러그인 골격 + 얇은 스킬 (BUILD)

**Files:**
- Create: `.claude-plugin/plugin.json`, `skills/ctreg/SKILL.md`, `tests/plugin/skill.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `skills/ctreg/SKILL.md` (Task 2·3 의 시나리오 에이전트가 읽는 유일한 문서), `.claude-plugin/plugin.json`

- [ ] **Step 1: 얇음을 고정하는 테스트를 먼저 쓴다**

`tests/plugin/skill.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(join(__dirname, '../../skills/ctreg/SKILL.md'), 'utf8');
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '../../.claude-plugin/plugin.json'), 'utf8'),
);

describe('플러그인 매니페스트', () => {
  it('스킬만 싣는다 — MCP 서버는 CLI 로 대체했다', () => {
    expect(MANIFEST.name).toBe('ctreg');
    expect(MANIFEST.license).toBe('Apache-2.0');
    expect(MANIFEST).not.toHaveProperty('mcpServers');
  });
});

describe('SKILL.md 는 얇다', () => {
  it('frontmatter 에 name 과 description 이 있다', () => {
    expect(SKILL.startsWith('---\n')).toBe(true);
    const fm = SKILL.split('---')[1]!;
    expect(fm).toMatch(/^name:\s*ctreg$/m);
    expect(fm).toMatch(/^description:\s*\S/m);
  });

  it('면책 문장을 축어로 담는다 — 안전 경계는 실험의 순수성보다 우선한다', () => {
    expect(SKILL).toContain(
      '이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.',
    );
  });

  it('--help 외의 어떤 플래그도 적지 않는다 — CLI 가 스스로 말해야 한다', () => {
    const flags = [...SKILL.matchAll(/--[a-z][a-z-]+/g)].map((m) => m[0]);
    expect([...new Set(flags)]).toEqual(['--help']);
  });

  it('registries 외의 커맨드 이름을 적지 않는다', () => {
    // `ctreg registries` 와 `ctreg --help` 는 규율이라 예외다.
    for (const cmd of ['ctreg search', 'ctreg get', 'ctreg results', 'ctreg count']) {
      expect(SKILL).not.toContain(cmd);
    }
  });

  it('exit code 의 의미나 경고 코드를 적지 않는다', () => {
    for (const leak of ['exit 0', 'exit 2', 'exit 3', 'exit 4', 'exit 5',
                        'not_found', 'results_summarized', 'locations_truncated',
                        'date_filter_excludes_missing', 'geo_radius_defaulted']) {
      expect(SKILL).not.toContain(leak);
    }
  });

  it('한 페이지를 넘지 않는다', () => {
    expect(SKILL.split('\n').length).toBeLessThan(60);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `bunx vitest run tests/plugin/skill.test.ts`
Expected: FAIL — `.claude-plugin/plugin.json` 과 `skills/ctreg/SKILL.md` 가 없음(ENOENT)

- [ ] **Step 3: 매니페스트 작성**

`.claude-plugin/plugin.json`:

```json
{
  "name": "ctreg",
  "version": "0.1.0",
  "description": "Query clinical trial registries through one normalized schema.",
  "license": "Apache-2.0"
}
```

`mcpServers` 키는 넣지 않는다. 이 프로젝트는 MCP 서버를 CLI 로 대체했다.

- [ ] **Step 4: 얇은 스킬 작성**

`skills/ctreg/SKILL.md`:

```markdown
---
name: ctreg
description: >
  Use when the user asks about clinical trials — finding trials for a condition
  or a drug, checking whether a trial reported results or adverse events,
  looking up a trial by its registry identifier, or asking how many trials
  exist for something. Drives the `ctreg` command-line tool.
---

# ctreg — 임상시험 레지스트리 조회

`ctreg` 는 임상시험 레지스트리를 하나의 정규화된 스키마로 조회하는 명령줄 도구다.
레지스트리마다 다른 필드 이름과 값 어휘를 흡수하고, 요청률과 페이로드를 묶고,
무엇을 할 수 없는지 명시한다.

## 시작하기 전에

**도구가 있는지 확인하라.** `ctreg --help` 가 동작하지 않으면 아직 설치되지 않은 것이다.
추측으로 진행하지 말고 사용자에게 알려라 — 이 스킬은 이 도구 없이는 아무것도 할 수 없다.

**`ctreg registries` 를 먼저 불러라.** 어떤 레지스트리를 조회할 수 있고 각각이 무엇을
할 수 있는지가 거기 있다. 네트워크를 치지 않으므로 공짜다. 사용자의 질문이 이 도구가
다루지 않는 레지스트리에 관한 것이면 그 자리에서 알 수 있다.

**표면은 `--help` 가 말한다.** 커맨드와 옵션을 추측하지 마라. 없는 것을 지어내는 것보다
`--help` 를 한 번 더 읽는 것이 싸다.

## 출력을 읽는 법

**종료 코드로 분기하라.** 이 도구는 성공과 실패를 다른 코드로 구분하고, 실패의 종류도
구분한다. 코드마다 옳은 행동이 다르다 — 어떤 것은 재시도, 어떤 것은 요청 수정, 어떤 것은
사용자에게 한계를 알리는 것이다. 무엇이 무엇인지는 `--help` 가 말한다.

**경고를 반드시 읽어라.** 이 도구는 조용히 좁히거나 자르지 않는다 — 대신 출력에 경고를
남긴다. 경고를 읽지 않으면 잘린 목록을 전체로, 좁혀진 검색을 완전한 검색으로 오독하게
된다. 답을 사용자에게 전하기 전에 경고를 확인하고, 관련된 것은 답에 반영하라.

**표준 출력은 기계용이다.** 기본 출력은 전체가 파싱되는 JSON 이고, 실패했을 때도 그렇다.
사람이 읽는 안내는 표준 에러로 나간다.

## 한계

이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `bunx vitest run tests/plugin/skill.test.ts`
Expected: PASS — 7 tests

전체 스위트도 돌린다: `bunx vitest run` (기존 267 + 7 = 274)

- [ ] **Step 6: 커밋**

```bash
git add .claude-plugin/plugin.json skills/ctreg/SKILL.md tests/plugin/skill.test.ts
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "feat(plugin): thin ctreg skill, with its thinness pinned by tests" -- .claude-plugin/plugin.json skills/ctreg/SKILL.md tests/plugin/skill.test.ts
```

---

## Task 2: 하네스 준비 + S1 파일럿 (CONTROLLER)

**컨트롤러가 직접 수행한다.** 구현자 서브에이전트에게 넘기지 않는다.

스펙 §10의 첫 번째 위험 완화다: 여섯 개를 한꺼번에 돌렸다가 전부 같은 지점에서 죽으면 정보량이 없다. 하나를 먼저 돌려 하네스가 작동하는지 확인한다.

**Files:**
- Create: `.superpowers/fieldtest/` (전사 저장, gitignore 됨)

- [ ] **Step 1: 바이너리를 PATH 에 올린다**

```bash
cd /Users/min/Projects/ctreg
bun run build
mkdir -p /tmp/ctreg-bin
printf '#!/bin/sh\nexec node /Users/min/Projects/ctreg/dist/cli/bin.js "$@"\n' > /tmp/ctreg-bin/ctreg
chmod +x /tmp/ctreg-bin/ctreg
PATH=/tmp/ctreg-bin:$PATH ctreg --help | head -3
```

Expected: 사용법이 출력된다. 이 래퍼가 시나리오 에이전트가 쓸 `ctreg` 다.

- [ ] **Step 2: 전사 디렉터리를 만든다**

```bash
mkdir -p .superpowers/fieldtest
printf '*\n' > .superpowers/fieldtest/.gitignore
```

- [ ] **Step 3: S1 시나리오 에이전트를 띄운다**

브리핑에 담는 것 (스펙 §5.1) 과 담지 않는 것 (§5.2) 을 지킨다. 브리핑 본문:

> 당신은 사용자를 돕는 에이전트입니다. 사용자가 이렇게 물었습니다:
>
> **"서울 근처에서 모집 중인 비소세포폐암 임상시험이 있나요?"**
>
> `/Users/min/Projects/ctreg/skills/ctreg/SKILL.md` 를 읽고 그 지침에 따르세요.
> `ctreg` 명령은 `PATH=/tmp/ctreg-bin:$PATH` 를 앞에 붙이면 실행됩니다.
> 캐시 디렉터리는 `CTREG_CACHE_DIR=/tmp/ctreg-ft-s1` 을 쓰세요.
>
> **제약:** `/Users/min/Projects/ctreg` 아래의 어떤 소스 코드도 읽지 마세요 —
> `src/`, `tests/`, `docs/` 전부입니다. 위에 지정한 스킬 파일 하나만 예외입니다.
> 이 도구에 대해 알아야 할 것은 도구 자신에게 물어서 알아내세요.
>
> 끝나면 다음을 반환하세요:
> 1. 실행한 모든 명령과 그 출력 (축어)
> 2. 사용자의 질문에 대한 최종 답 — 사용자에게 말하듯이
> 3. 헤맨 지점: 무엇을 하려다 무엇 때문에 막혔거나 돌아갔는지
> 4. 확신이 없는 지점: 답했지만 스스로 미심쩍은 부분

- [ ] **Step 4: 반환을 전사 파일로 저장하고 오염을 확인한다**

`.superpowers/fieldtest/s1.md` 에 저장한다. 전사에서 소스 접근 흔적(`cat src/`, `Read` 로 `src/` 접근 등)을 찾는다. 있으면 그 시나리오는 무효이고, 제약을 더 명확히 해 다시 돌린다.

- [ ] **Step 5: 하네스가 작동했는지 판단한다**

에이전트가 최소한 `ctreg registries` 나 `ctreg --help` 를 부르고 검색을 시도했는가?

- **시도했다** → Task 3 으로 간다.
- **아예 못 굴렀다** → 그 자체가 최상급 CLI-FIX 발견이다. 원인을 기록하고, 그래도 Task 3 을 진행한다(다른 시나리오는 다른 지점에서 막힐 수 있고, 여섯 개가 같은 지점에서 죽는다는 사실 자체가 결과다).

---

## Task 3: 나머지 다섯 시나리오 (CONTROLLER)

**컨트롤러가 직접 수행한다.**

S2–S6 을 띄운다. 브리핑 형식은 Task 2 Step 3 과 동일하고, 질문·캐시 디렉터리·전사 파일명만 바꾼다. 서로 독립이므로 병렬로 띄워도 된다.

- [ ] **Step 1: S2 — count 규율**

질문: **"펨브롤리주맙 임상시험이 몇 건이나 있고, phase 별로 어떻게 분포하나요?"**
`CTREG_CACHE_DIR=/tmp/ctreg-ft-s2` · 전사 `.superpowers/fieldtest/s2.md`

- [ ] **Step 2: S3 — 요약 vs 완전**

질문: **"NCT04280705 시험이 유해사례를 보고했나요? 심장 관련 이상반응은 어땠나요?"**
`CTREG_CACHE_DIR=/tmp/ctreg-ft-s3` · 전사 `.superpowers/fieldtest/s3.md`

- [ ] **Step 3: S4 — 배치 중 하나가 없음**

질문: **"NCT04280705, NCT00000102, NCT99999999 이 세 시험 정보를 정리해 주세요."**
`CTREG_CACHE_DIR=/tmp/ctreg-ft-s4` · 전사 `.superpowers/fieldtest/s4.md`

- [ ] **Step 4: S5 — 미지원 레지스트리**

질문: **"EudraCT 번호 2020-000001-11 인 시험을 찾아 주세요."**
`CTREG_CACHE_DIR=/tmp/ctreg-ft-s5` · 전사 `.superpowers/fieldtest/s5.md`

- [ ] **Step 5: S6 — 노출되지 않은 능력**

질문: **"결과가 게시된, 완료된 당뇨병 임상시험을 찾아 주세요."**
`CTREG_CACHE_DIR=/tmp/ctreg-ft-s6` · 전사 `.superpowers/fieldtest/s6.md`

- [ ] **Step 6: 전부 오염을 확인한다**

각 전사에서 소스 접근 흔적을 찾는다. 오염된 시나리오는 다시 돌린다.

---

## Task 4: 판정과 결과 문서 (CONTROLLER)

**컨트롤러가 직접 수행한다.** 판정은 위임하지 않는다 — 스펙과 CLI 를 다 아는 쪽이 해야 "CLI 가 이것을 말할 수 있었는가" 를 판단할 수 있다.

**Files:**
- Create: `docs/agent-field-test-2026-08-22.md`

- [ ] **Step 1: 각 최종 답이 옳은지 대조한다**

에이전트가 답을 냈다는 것과 그 답이 맞았다는 것은 다르다. 각 시나리오의 답을 실제 CT.gov 데이터와 대조한다. 총계처럼 변하는 값은 자릿수 수준으로, 존재/부재 같은 사실은 엄격하게 본다. 대조 시점을 기록한다.

- [ ] **Step 2: 각 헤맨 지점을 네 범주로 판정한다**

| 범주 | 판정 기준 |
| :-- | :-- |
| **CLI-FIX** | 그 사실이 `--help`·`registries`·에러 힌트·경고 중 어디에도 없었다 |
| **SKILL-TEACH** | 도구가 구조적으로 말할 수 없다 |
| **AGENT** | 도구도 스킬도 그 사실을 전달했는데 에이전트가 안 썼다 |
| **SILENT-WRONG** | 답이 틀렸는데 에이전트가 몰랐다 — 심각도 표시이며, 원인은 CLI-FIX 또는 SKILL-TEACH 로 세분한다 |

각 판정에 근거를 함께 적는다. CLI-FIX 판정은 "실제로 어디에도 없었는가" 를 확인해서 적는다 — 추측하지 않는다.

- [ ] **Step 3: 결과 문서를 쓴다**

`docs/agent-field-test-2026-08-22.md`. 시나리오마다: 질문 / 실행한 명령 목록 / 최종 답 요약 / **답이 옳았는가** / 헤맨 지점과 범주 판정. 그리고 종합: CLI-FIX 목록, SKILL-TEACH 목록, SILENT-WRONG 건수.

`docs/field-test-2026-08-22.md` 와 같은 형식을 따르되, 그 문서가 한 번 겪은 실수 — 판정 열이 자기 기대를 검사하지 않아 전부 녹색이던 것 — 를 반복하지 않는다. **"에이전트가 답을 냈다" 는 통과가 아니다.**

- [ ] **Step 4: 커밋**

```bash
git add docs/agent-field-test-2026-08-22.md
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "docs: agent field test — what an agent gets wrong with the thin skill" -- docs/agent-field-test-2026-08-22.md
```

---

## Task 5: SKILL-TEACH 반영 (BUILD)

**Files:**
- Modify: `skills/ctreg/SKILL.md`, `tests/plugin/skill.test.ts`

**Interfaces:**
- Consumes: Task 4 의 SKILL-TEACH 목록
- Produces: 자란 `skills/ctreg/SKILL.md`

- [ ] **Step 1: SKILL-TEACH 항목만 스킬에 추가한다**

`docs/agent-field-test-2026-08-22.md` 의 SKILL-TEACH 목록을 그대로 반영한다. **관찰된 것만 넣는다** — "이것도 가르치면 좋겠다" 는 추측은 넣지 않는다. 추측으로 채우면 다음 필드 테스트가 다시 무의미해진다.

- [ ] **Step 2: 얇음 테스트를 갱신한다**

추가한 내용이 §Global Constraints 의 금지 목록(플래그·커맨드 이름·exit code·경고 코드)에 걸리면, **스킬이 아니라 표현을 고친다.** 예를 들어 "`--near` 는 시험을 거르지 사이트를 거르지 않는다" 대신 "위치로 좁히면 시험이 걸러지지 사이트 목록이 걸러지지 않는다" 로 쓴다 — 규율은 남기고 표면은 남기지 않는다.

한 페이지 상한(60줄)도 갱신이 필요하면 근거와 함께 올린다. 무한정 자라면 그것은 얇은 스킬이 아니다.

- [ ] **Step 3: 테스트를 돌린다**

Run: `bunx vitest run tests/plugin/skill.test.ts && bunx vitest run`
Expected: 전부 통과

- [ ] **Step 4: 커밋**

```bash
git add skills/ctreg/SKILL.md tests/plugin/skill.test.ts
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "feat(plugin): teach what the CLI cannot say about itself" -- skills/ctreg/SKILL.md tests/plugin/skill.test.ts
```

---

## Task 6: CLI-FIX 목록을 다음 작업의 입력으로 남긴다 (BUILD)

**Files:**
- Modify: `docs/slice-2-prerequisites.md`

- [ ] **Step 1: CLI-FIX 항목을 선결 조건 문서에 옮긴다**

`docs/agent-field-test-2026-08-22.md` 의 CLI-FIX 목록을 `docs/slice-2-prerequisites.md` 에 새 절로 추가한다. 각 항목에 근거(어느 시나리오에서 어떻게 드러났는지)를 붙인다.

**적용하지 않는다.** 이 계획의 범위는 식별까지다(스펙 §9). 몇 개가 얼마나 큰지 보고 나서 별도로 결정한다.

- [ ] **Step 2: 커밋**

```bash
git add docs/slice-2-prerequisites.md
git -c user.name="min" -c user.email="kimmingul@gmail.com" commit -m "docs: carry the agent field test's CLI findings into the prerequisites" -- docs/slice-2-prerequisites.md
```

---

## 완료 조건

- [ ] 시나리오 6개 전부 실행되고 각각 전사·최종 답·판정이 기록됨
- [ ] 모든 헤맨 지점이 네 범주 중 하나로 판정되고 근거가 적힘
- [ ] 각 최종 답이 실제 데이터와 대조되어 옳고 그름이 판정됨
- [ ] SKILL.md 가 SKILL-TEACH 항목만큼 자람 — 관찰된 것만
- [ ] 얇음 테스트가 여전히 통과 (표면이 스킬에 새지 않음)
- [ ] CLI-FIX 목록이 `docs/slice-2-prerequisites.md` 에 남음
- [ ] 전체 스위트 통과, `bunx tsc -p tsconfig.typecheck.json` 클린
