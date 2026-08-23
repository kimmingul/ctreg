# 에이전트 필드 테스트 — 2026-08-22

`ctreg` 를 얇은 플러그인으로 감싸고, 여섯 개의 서브에이전트에게 실제 임상시험 질문을 던졌다.
목적은 CLI 가 **스스로를 설명하지 못하는 지점**을 찾는 것이다.

## 방법

각 에이전트에게 준 것은 넷뿐이다 — 사용자 질문 한 줄, 스킬 파일 경로, 바이너리 실행법,
전용 캐시 디렉터리. 저장소 소스(`src/`, `tests/`, `docs/`)는 차단했다. 예상 실패도,
시나리오의 의도도, 다른 시나리오의 존재도 알리지 않았다.

스킬은 의도적으로 얇다 — 커맨드 목록도, 플래그 목록도, exit code 의미표도, 경고 코드
목록도 없다. 규율만 가르친다. **이 누락은 편의가 아니라 측정 장치다.** 스킬이 적어두면
에이전트가 그것을 쓸 뿐, CLI 가 그 사실을 전달할 수 있는지는 알 수 없게 된다.

여섯 전사 모두 오염 검사 통과(소스 접근 흔적 0).

### 사전 등록

시나리오를 돌리기 **전에** 두 가지 함정을 예측해 원장에 적었다. 사후해석을 막기 위해서다.

- **H1** — `--location Seoul` 은 119건인데 `--location "Korea, Republic of"` 는 1건이다.
  경고 없이 exit 0. 넓힌 질의가 더 적은 결과를 낸다.
- **H2** — `results` 요약 모드는 `items: []` 를 준다. "심장 관련은?" 에 답하려고 `items` 를
  보면 빈 배열을 보고 "없다"고 답할 수 있다. 실제로는 15건이고 전부 serious 다.

**둘 다 발동하지 않았다.** H1 은 에이전트가 그 경로에 들어가지 않았고(반증이 아니다),
H2 는 에이전트가 `--ae-organ` 을 써서 우회했다.

**그리고 예측하지 못한 것이 더 컸다.** 내가 `--help` 와 스펙을 읽고 짐작한 실패와
에이전트가 실제로 부딪힌 실패가 달랐다. 이 필드 테스트를 하는 이유가 그것이다.

## 시나리오별 결과

| # | 질문 | 답의 정확성 | 예상 실패 | 실제로 일어난 것 |
| :-- | :-- | :-- | :-- | :-- |
| S1 | 서울 근처 모집중 NSCLC | 하한선(109)이 실측과 일치 | 지명→좌표 변환 실패 / **반경 밖 사이트를 보고 필터가 깨졌다고 판단** | **뒤엣것이 발동했다** — 에이전트가 파리 좌표로 대조 실험을 스스로 설계해 겨우 빠져나왔다. **F1** 필터에 걸린 사이트가 결과에서 잘려나감 |
| S2 | 펨브롤리주맙 건수와 phase 분포 | 정확 | `count` 안 쓰고 페이지 긁기 | `count` 를 옳게 씀. **F5** 어휘를 몰라 추측 강요됨 |
| S3 | NCT04280705 유해사례, 심장 관련 | **정확** | 요약을 완전한 것으로 읽음 | 안 빠짐. **F6** 경고가 부분 전개를 구분 못 함 |
| S4 | 세 NCT 정리(하나는 없는 ID) | **정확** | `not_found` 못 보고 3건 보고 | 안 빠짐. **F4** 없는 복구 경로를 사용자에게 권함 |
| S5 | EudraCT 번호로 조회 | **정확** | exit 3 을 "없음"으로 보고 | 안 빠짐. **F2** 0건이 "없음"인지 "안 봄"인지 구분 불가 |
| S6 | 결과 게시된 완료 당뇨 시험 | 표본 48건이 실측과 일치 | 없는 플래그를 지어냄 | 안 지어냄. **F7** 파이프에 물리면 크래시 |

### SILENT-WRONG: 핵심 답에서 **0건** — 그러나 이것이 무엇의 증거인지 정확히 말해야 한다

여섯 에이전트 중 누구도 미지원(exit 3)을 "결과 없음"으로 오독하지 않았고, 누구도 없는
플래그를 지어내지 않았고, 누구도 틀린 답을 자신 있게 내놓지 않았다. 여섯 개 최종 답을
전부 실제 데이터와 대조했고 — S1 의 109, S2 의 일곱 숫자, S3 의 110/15/17, S4 의 2+1,
S5 의 0건, S6 의 48 — 틀린 것이 없었다.

**그러나 "설계가 검증됐다"고 쓰면 증거보다 반 발짝 앞선다. 이 증거의 상한은
"반증되지 않았다"이다.** 세 가지 이유에서다.

**첫째, 사전 등록한 덫 둘 다 실행되지 않았다.** H1 은 에이전트가 그 경로에 들어가지
않았다. H2 는 성격이 다르다 — 에이전트가 `items: []` 를 "없다"로 읽을 **기회 자체를
얻지 못했다.** `--ae-organ` 으로 우회했고, 같은 출력의 `byOrgan` 에 `Cardiac disorders: 15`
가 나란히 있었다. 즉 **덫을 막은 것이 경고인지 `byOrgan` 인지 이 실험은 구분하지 못한다.**
스펙 §4.1 이 핵심이라 못박은 자리에서 예측된 실패 양식은 한 번도 시험되지 않았다.

**둘째, 더 약한 모델로 재실행한 결과가 기전과 결과를 갈라놓았다.** S3·S4 를 다른 모델
계열로 다시 돌렸다(`s3-haiku.md`, `s4-haiku.md`). 둘 다 답은 정확했다. 그러나
S4 는 경고를 읽어 사용자에게 전달했고(`not_found`, "60개 장소 중 처음 10개만"),
**S3 는 전사 전체에 경고 언급이 0회였다.** 답이 맞은 것은 물어본 것을 정확히 전개시키는
플래그를 골랐기 때문이다.

차이는 **답이 경고에 의존했는가**였다. 의존하면 읽고, 아니면 건너뛴다. 합리적인 행동이다.
그러나 그렇다면 이 결과가 말하는 것은 **에이전트가 경고를 필요할 때 읽는다**는 것이지
**경고 체계가 오독을 막는다**는 것이 아니다. 진짜 위험은 답이 경고에 의존한다는 사실
자체를 에이전트가 모르는 경우 — 정확히 H2 의 형태 — 이고, 그것은 시험되지 않았다.

**셋째, 표본이 작다.** 시나리오 6개, 에이전트 각 1개(재실행 2개 추가). 통계가 아니다.

**얻은 것은 이것이다**: 설계가 모델 능력에 **부분적으로 독립**이라는 증거(S4 재현).
그리고 여섯 개의 서로 다른 실제 질문에서 틀린 답이 나오지 않았다는 사실.
**얻지 못한 것은**: 경고 체계가 오독을 실제로 막는다는 증거.

## 판정

| # | 발견 | 범주 | 근거 |
| :-- | :-- | :-- | :-- |
| F1 | `--location` 은 매칭된 사이트를 잘라버리고 `--near` 는 보존한다 | **CLI-FIX** | 업스트림에 정보가 있는데 우리가 버린다. 두 경로의 차이를 말하는 것이 없다. **해소됨 — 커밋 `b76d759`, `30e5cf8`, `4a6cd3f`.** |
| F2 | 능력 선언이 존재만 말하고 적용 범위를 말하지 않는다 | **CLI-FIX** | `term: true` 는 축의 존재만 선언한다. 0건이 "없음"인지 "안 봄"인지 판별 근거가 도구 안에 없다 |
| F3 | 서브커맨드별 `--help` 가 없다 | **CLI-FIX** | 최상위와 바이트 단위로 동일. 세 시나리오가 부딪혔다 |
| F4 | 경고가 존재하지 않는 복구 경로를 암시한다 | **CLI-FIX** | "잘렸다"만 말하고 "되찾을 수 없다"를 안 말해 에이전트가 없는 해결책을 권했다. 실측: `get` 은 `--page-size`·`--page-token`·`--sort` 를 받아들이고 **exit 0 으로 조용히 무시**한다(위치는 10개 그대로, 경고 없음) |
| F5 | 어휘를 열거할 방법이 없다 | **CLI-FIX** | 에이전트가 틀린 값을 일부러 넣어 힌트를 캤고, 나머지는 추측했다 |
| F6 | `results_summarized` 가 부분 전개를 구분하지 않는다 | **CLI-FIX** | 전개 전과 부분 전개가 같은 코드 |
| F8 | 어휘가 데이터를 덮지 못한다 | **CLI-FIX** | `na` 와 "phase 필드 자체가 없음"은 다른 것인데 후자를 가리킬 값이 없다. 업스트림 표본 1000건 중 필드 부재 52건. 범주별 건수가 항상 총계에 못 미치고 모자란 부분에 이름을 붙일 수 없다 |
| F7 | 파이프가 일찍 닫히면 크래시한다 | **CLI-FIX** | exit 1(계약에 없는 코드) + 원시 스택트레이스. **해소됨 — 커밋 `a3cce54`.** |
| F9 | 대문자 값 거부 → 힌트 → 자력 복구 | **CLI-FIX** (정정) | 처음엔 AGENT(설계 성공)로 적었으나 **잘못이다.** S2 가 받은 것과 **문자 그대로 같은 힌트**다. 같은 도구 동작이 시나리오에 따라 다른 판정을 받을 수 없다. `--help` 는 세 경우 모두 대소문자 규칙도 값 어휘도 말하지 않고 **틀린 값을 넣었을 때만** 말한다 — F8 이 지적한 그 패턴이다 |
| A1 | S2 가 어휘를 **추측**해 채웠다 | **AGENT** | 전사 자백: *"CT.gov API v2 의 익숙한 enum 을 추측해서 대입했다 … '추측하지 말라'는 스킬 지침을 정확히는 못 지켰다."* 이번엔 맞았지만 훈련 데이터에서 끌어온 것이고 **다음 레지스트리에서는 조용히 틀린다.** F5 와 별개 사실이다 |
| A2 | S4 가 **해보지 않은 방법**을 사용자에게 권했다 | **AGENT** | 최종 답에서 페이지네이션을 권해놓고 같은 전사에 *"`--page-size` 를 `get` 에 붙여서 시도해보지는 않았습니다"*. F4 의 유인은 실재하지만, 권하기 전에 확인하는 것은 에이전트의 몫이다 |
| F10 | `exit 5`(부분 실패)의 의미를 말하는 것이 없다 | **CLI-FIX** | S4 가 §5.3-4번에 명시적으로 적어 반환했다: 경고가 둘인데 exit 는 0 이었고 "5 = 부분 실패"가 언제 뜨는지 도구가 설명하지 않는다. 지금은 레지스트리가 하나라 도달 불가지만 **두 번째 어댑터가 붙는 순간 처음 발생한다.** 스킬의 첫 규율이 "종료 코드로 분기하라"이므로 F3 보다 무겁다. **해소됨 — 커밋 `04805cc`.** |
| F11 | `locations_truncated` 의 스코프가 불명확하다 | **CLI-FIX** | S1 이 "검색 결과가 잘렸다"로 오해할 뻔했다. 시험당 위치 목록이 잘린 것인데 경고만 보고는 무엇이 잘렸는지 모른다. **해소됨 — 커밋 `b76d759`, `30e5cf8`, `4a6cd3f`.** |
| F12 | `--radius` 기본값이 선언되지 않는다 | **CLI-FIX** | S1: *"50km 는 임의로 고른 값 — 도구에 기본값이 없어 이 선택이 답의 경계를 좌우한다."* 답의 범위를 정하는 값이 문서화되지 않았다 |
| F13 | `--full` 이 organ 필터를 덮어쓴다 | **CLI-FIX** | S3 이 `--full` 로 arm 별 분리를 찾다가 organ 필터가 무시되는 것을 발견했다. 경고 없이 무시된다 |
| F14 | `registries` 의 `results: true` 가 오독을 부른다 | **CLI-FIX** | S6 이 이것을 "결과 게시 여부로 검색 가능"으로 읽었다. 실제로는 `results` 서브커맨드 지원을 뜻한다. F2 와 같은 뿌리 |
| T1 | 시험 전체 상태 ≠ 사이트별 상태 | **SKILL-TEACH** | 레지스트리 데이터 해석의 문제이지 도구 표면의 문제가 아니다 |
| T2 | 범주별 건수의 합이 총계보다 클 수 있다 | **SKILL-TEACH** | 한 시험이 여러 범주에 속한다. 도구는 합산 의도를 알 수 없다 |
| O2 | 재현되지 않는 `data: null` | **미해결** | 두 번 관찰, 세 가설 기각, 재현 실패 |

### CLI-FIX 우선순위

1. **F7** — 결정적이고 100% 재현되며 흔한 사용에서 터진다. 가장 싸고 가장 확실하다.
2. **F1** — 임상적 결과가 가장 크다. 답을 조용히 틀리게 만든다.
3. **F10** — 두 번째 어댑터가 붙는 순간 처음 발생한다. 지금 고치면 싸고, 그때 고치면 비싸다.
4. **F4** — F1 과 같은 뿌리. 경고가 오독을 막는 대신 새 오독을 만든다.
5. **F2·F5·F8·F9·F14** — 같은 뿌리. 선언이 존재만 말하고 내용을 말하지 않는다.

   > **넷 해소 · F2 는 절반 (2026-08-23) — 커밋 `0bf9075`, `a057a65`, `fffb44c`,
   > `ac1da10`, `5f067bb`, `e134e29`, `ae90a3e`.** 다섯을 하나의 설계로 함께 고쳤다
   > (`docs/superpowers/specs/2026-08-23-capability-says-content-design.md`).
   > 축이 `values`·`exhaustive`·`scope` 를 신고하고, `--help` 가 값 어휘를 적으며,
   > `exhaustive: false` 축으로 필터하면 `vocab_excludes_missing` 이 붙는다.
   >
   > **F2 만 다르다.** `scope` 는 선언에 근거를 실었지만 **응답에는 싣지 않았다.**
   > 빌드한 CLI 로 재확인: `search --registry ctgov --term "2015-000397-19"` 는
   > 결과 0건 · 경고 없음 · exit 0 — 브랜치 이전과 같다. 다섯 중 실패 경로가 아직도
   > **exit 0 인 0건** 으로 끝나는 것은 F2 뿐이다. 자유 텍스트 축의 0건에 붙는 경고는
   > 별도 변경이다(F8 이 받은 사용 시점 경고와 같은 자리·같은 모양이 될 것이다).
6. **F6·F11·F13** — 경고와 플래그의 의미가 불명확하다.
7. **F3·F12** — 마찰이지 오답이 아니다.

**F1·F2·F4·F5·F8·F9·F14 는 하나의 패턴이다** — 선언이 불완전하면 에이전트는 한도를
부딪혀서만 알게 되고, 부딪힌 것을 알아채지 못하면 조용히 틀린다. 일곱을 따로 고치면
패턴은 남아 다음 항목에서 다시 나타난다.

### 판정 분포와 그 의미

CLI-FIX 14 · SKILL-TEACH 2 · AGENT 2 · 미해결 1.

**CLI-FIX 가 압도적으로 많은 것은 이 방법이 그렇게 설계됐기 때문이 아니다.** 반대 방향의
장치가 있다 — 원장 R1 은 "표면 요소를 이름 대야만 표현되는 SKILL-TEACH 항목은 실은
CLI-FIX 다"라고 정해두었고, 그것이 항목을 CLI-FIX 로 미는 힘이다. 그런데 이번에
그 장치는 **한 번도 발동하지 않았다** — SKILL-TEACH 두 건 모두 표면을 이름 대지 않고
표현되어 그대로 스킬에 들어갔다.

**AGENT 2 건은 에이전트의 실제 이탈이다.** 처음 판정에서는 AGENT 칸에 "대문자 거부 →
자력 복구"라는 **성공 사례**가 들어 있었다. 그것은 에이전트가 잘한 일이지 에이전트의
문제가 아니고, 같은 도구 동작이 다른 시나리오에서는 CLI-FIX(F5)로 판정되고 있었다.
최종 리뷰가 이 모순을 잡았고 F9 로 재분류했다.

## 방법의 한계

- 시나리오 여섯 개, 에이전트 각 하나(재실행 둘 추가). 통계가 아니라 표본이다.
- 본 실행 여섯은 모두 같은 모델 계열이다. S3·S4 만 다른 계열로 재실행했다.
- 스킬이 얇으므로 여기 발견된 마찰 중 일부는 두꺼운 스킬이면 안 보였을 것이다.
  그것이 설계 의도지만, 실사용 스킬이 이만큼 얇을 이유는 없다.
- H1 이 발동하지 않은 것은 반증이 아니다 — 그 경로에 들어가지 않았을 뿐이다.
- **H2 는 시험되지 않았다 — 그리고 노출된 에이전트는 둘뿐이다.** S3 을 맡은 두 에이전트
  (sonnet·haiku)만 `results` 를 실제로 불렀고, 둘 다 `--ae-organ` 으로 우회했다. S4 계열은
  `results` 를 아예 부르지 않았다. 덫을 막은 것이 경고인지 같은 출력의 `byOrgan` 인지
  이 실험은 구분하지 못한다.
- **다만 H2 는 "시험 불가"가 아니라 한 걸음 앞에서 멈췄다.** `s3-haiku.md` 는 정확한 답을
  내면서 *"헤맨 지점: 없음, 확신이 없는 지점: 없음"* 이라고 적었다 — **경고를 한 번도
  읽지 않고 의심도 0 인 상태**다. H2 가 요구하는 조건이 정확히 그것인데, 그 에이전트가
  `items` 대신 `--ae-organ` 을 골라 덫 위를 지나갔을 뿐이다.
  **다음 필드 테스트에서 싸게 시험할 수 있다** — 질문에서 기관계를 지목하지 않으면
  (*"이 시험의 유해사례를 정리해 주세요"*) `--ae-organ` 에 손댈 이유가 없어지고
  요약 모드의 `items: []` 를 직접 마주한다.
- O2 는 결함으로 확정하지 않았다. 재현하지 못한 것을 확정하면 이 문서의 나머지도 못 믿게 된다.

## 부록 — 에이전트가 실행한 커맨드

스펙 §7 이 요구하는 시나리오별 커맨드 목록이다. 전사에서 실제 실행된 `ctreg` 호출만 뽑았다
(환경변수 접두사·파이프·리다이렉션·중복 제거, `--help` 출력의 사용법 줄과 산문 언급은 제외).
전사 원문은 `docs/fieldtest/` 에 있다.

**S1 서울 근처 모집중 NSCLC** — 14개

```
ctreg --help
ctreg registries
ctreg search --condition "non-small cell lung cancer" --location "Seoul" --status RECRUITING --format text
ctreg search --condition "non-small cell lung cancer" --location "Seoul" --status recruiting --format text
ctreg search --condition "non-small cell lung cancer" --location "Seoul" --status recruiting --format json --page-size 3
ctreg search --condition "non-small cell lung cancer" --near "37.5665,126.9780" --radius 50km --status recruiting --format text
ctreg count --condition "non-small cell lung cancer" --status recruiting
ctreg count --condition "non-small cell lung cancer" --location "Seoul" --status recruiting
ctreg count --condition "non-small cell lung cancer" --near "37.5665,126.9780" --radius 50km --status recruiting
ctreg count --condition "non-small cell lung cancer" --near "48.8566,2.3522" --radius 50km --status recruiting
ctreg search --condition "non-small cell lung cancer" --near "37.5665,126.9780" --radius 50km --status recruiting --format text --page-size 150
ctreg search --condition "non-small cell lung cancer" --near "37.5665,126.9780" --radius 50km --status recruiting --format json --page-size 150
ctreg get CTGOV:NCT07100080 --format json
ctreg get CTGOV:NCT07100080 --raw --format json
```

**S2 펨브롤리주맙 건수와 phase 분포** — 9개

```
ctreg --help
ctreg registries
ctreg count --intervention "pembrolizumab"
ctreg count --intervention "pembrolizumab" --phase BOGUS
ctreg count --intervention "pembrolizumab" --phase $p
ctreg search --intervention "pembrolizumab" --phase phase_1 --phase phase_2 --page-size 5
ctreg count --intervention "pembrolizumab" --phase early_phase_1 --phase phase_1 --phase phase_2 --phase phase_3 --phase phase_4 --phase na
ctreg count --term "pembrolizumab"
ctreg count --intervention "Keytruda"
```

**S3 NCT04280705 유해사례, 심장 관련** — 6개

```
ctreg --help
ctreg registries
ctreg results NCT04280705
ctreg results NCT04280705 --ae-organ "Cardiac disorders"
ctreg get NCT04280705
ctreg results NCT04280705 --ae-organ "Cardiac disorders" --full
```

**S4 세 NCT 정리 (하나는 없는 ID)** — 4개

```
ctreg --help
ctreg registries
ctreg get NCT04280705 NCT00000102 NCT99999999
ctreg get --help
```

**S5 EudraCT 번호 조회** — 7개

```
ctreg --help
ctreg registries
ctreg search --help
ctreg get --help
ctreg search --id "2020-000001-11"
ctreg get "2020-000001-11"
ctreg search --term "2020-000001-11"
```

**S6 결과 게시된 완료 당뇨 시험** — 9개

```
ctreg --help
ctreg registries
ctreg search --help
ctreg search --condition diabetes --status COMPLETED --page-size 5
ctreg search --condition diabetes --status completed --page-size 5
ctreg search --condition diabetes --status completed --has-results true
ctreg search --condition diabetes --status completed --page-size 200 --format ndjson
ctreg count --condition diabetes --status completed
ctreg results CTGOV:NCT00982644
```

**S3 재실행 (다른 모델 계열)** — 5개

```
ctreg --help
ctreg registries
ctreg results NCT04280705
ctreg results NCT04280705 --ae-organ "Cardiac disorders"
ctreg get NCT04280705
```

**S4 재실행 (다른 모델 계열)** — 3개

```
ctreg --help
ctreg registries
ctreg get NCT04280705 NCT00000102 NCT99999999 --format json
```

합계 57개 호출.

## 근거를 다시 확인하려면

전사와 정답표는 **`docs/fieldtest/` 에 커밋되어 있다**: `s1.md`~`s6.md`,
재실행 `s3-haiku.md`·`s4-haiku.md`, 정답표 `ground-truth-s1.md`·`ground-truth-s2-s6.md`.
이 문서의 모든 판정과 숫자는 거기서 확인할 수 있다.

작업 중의 룰링과 판정 과정은 `.superpowers/sdd/2026-08-22-ctreg-plugin-fieldtest/progress.md`
에 있으나 그것은 gitignore 된 스크래치이므로 남아 있지 않을 수 있다.

대조 시점은 **2026-08-22** 다. ClinicalTrials.gov 는 매일 갱신되므로 이 문서의 모든
숫자(119·109·2934·110·15·48·15120 등)는 그날의 값이다. 나중에 재측정하면 달라진다 —
달라졌다는 것이 결함의 증거는 아니다.

바이너리는 `bun run build` 후 `dist/cli/bin.js` 를 `ctreg` 라는 이름으로 PATH 에 올려 썼다.
