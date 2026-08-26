# ICTRP 를 별도 레지스트리로 붙인다 — 설계

- **일자:** 2026-08-26
- **상태:** 설계 확정, 구현 전
- **성격:** 어댑터 #3. **연계하지 않는다** — ctgov·ISRCTN 과 비교하거나 묶으려 하지 않고,
  자기 어휘와 자기 한계를 신고하는 **하나의 DB** 로 붙인다.

## 0. 왜 이 모양인가 — 기각된 대안

처음 검토는 ICTRP 를 **교차 레지스트리 해석기**(중복 제거)로 쓰는 쪽이었고, **측정으로 기각됐다.**

- ICTRP 사본이 원본보다 정보가 적은 사례가 있다. `ISRCTN11928588` 의 `Secondary ID(s)` 섹션이
  ICTRP 에서는 **비어 있는데**, ISRCTN 자체 API 는 EudraCT `2018-000003-16`·IRAS `235666`·
  Wellcome grant 를 준다(표본 1건).
- ISRCTN diabetes 12건을 ICTRP 에 물었을 때 **12건 전부 NCT 다리가 없었다.**
- 우리 손 안의 `crossIds` 도 교차 등록 링크가 아니다 — ctgov 7/50 은 전부 NIH 연구비 번호,
  ISRCTN 28/50 은 대부분 IRAS·CPMS·연구비 코드다. NCT 를 가리키는 것은 양쪽 모두 0건.

즉 **중복 제거는 ICTRP 로도 안 되고 우리 데이터로도 안 된다.** I6 이 낸 답(합계를 내지 않고
`totals_not_summable` 로 상한이라고 말한다)이 이 데이터에서 낼 수 있는 최선이고, 이 설계는
그것을 바꾸지 않는다.

**별도 DB 로 보면 이야기가 다르다.** `--registry` 는 이미 명시적이고 조회 커맨드의 기본값은
이름 붙은 하나(`DEFAULT_REGISTRY = 'ctgov'`)라, 어댑터를 더해도 기존 호출자의 동작은 바뀌지
않는다. ICTRP 가 주는 것은 **커버리지**다 — 한 결과에 NCT·ISRCTN·JPRN-jRCT·DRKS·CTRI 가
섞여 나온다. ctgov·ISRCTN 어댑터로는 존재조차 알 수 없는 시험들이다.

## 1. 실측 (2026-08-26)

접근 경로 정정의 정본은 `docs/registry-field-survey-2026-08-22.md` 의
「ICTRP 접근 경로 실측」 절이다. 여기서는 **이 설계가 의존하는 사실만** 적는다.

| 항목 | 실측 |
| :-- | :-- |
| 진짜 질의 표면 | `AdvSearch.aspx` 의 ViewState POST. quick search(`Default.aspx?...`)는 **다른 것**이고 훨씬 좁다(pembrolizumab 86 vs 1,013) |
| 총계 | **절단 없음.** `title=a` → `120819 records for 110319 trials` |
| 페이지 | `dlPager2$ctlNN$lnkPageNo` postback. 2페이지 확인, 1페이지와 겹침 0 |
| 페이지 크기 | 폼이 10 / 20 / 50 / 100 을 제공 |
| 결과 행 | `Trial2.aspx?TrialID=<id>` 링크. 한 결과에 NCT·CTRI·JPRN-jRCT·DRKS 혼재 |
| 레코드 | `Trial2.aspx?TrialID=<id>` 는 **세션 없는 안정적 GET** |
| 묶음 | 결과가 `N records for M trials` 로 나온다(pembrolizumab 1,435 → 1,013) |

**quick search 로 잰 초기 수치는 전부 폐기한다.** 「묶음 1.5–7.6%」·「키 이름이 무시된다」는
그 표면의 성질이었고, 고급검색에는 해당하지 않는다.

## 2. 축 매핑 — 신고할 것과 끌 것

폼 필드를 직접 열어 확인했다(`AdvSearch.aspx`).

| ctreg 축 | ICTRP 필드 | 신고 |
| :-- | :-- | :-- |
| `title` | `txtTitle` (+ `ddlTitle` = NOT 연산자) | **true** |
| `condition` | `txtCondition` (+ 동의어 끄기 체크박스) | **true** |
| `intervention` | `txtIntervention` (+ 동의어 끄기) | **true** |
| `lead` | `txtPrimarySponsor` | **true** — primary sponsor 만 |
| `id` | `txtSecondaryID` ("is or contains") | **true** |
| `location` | `txtFreeCountry` + `lstCountries` | **true** — **국가 단위뿐** |
| `phase` | `ListBoxPhase` = Phase 0/1/2/3/4 | **true**, 아래 §2.1 |
| `status` | `ddlRecruitingStatus` = `Recruiting` / `ALL` | **true**, 값은 `['recruiting']` 하나. 아래 §2.2 |
| `sponsor` | 없음(primary 만 있다) | **false** |
| `studyType` | 없음 | **false** |
| `term`·`patient`·`outcomeQuery`·`geo` | 없음 | **false** |
| `updatedRange`·`startRange`·`completionRange` | 있는 것은 **등록일** 범위(`Date of registration is between`)뿐 | **셋 다 false** |

**날짜 축 셋을 전부 끄는 이유를 적어 둔다.** 폼에 날짜 범위가 있으니 `startRange` 로 신고하고
싶어지지만, 그 필드는 **등록일**이고 이 스키마의 세 날짜 축(갱신·시작·완료) 중 어느 것도
아니다. 뜻이 다른 것을 같은 이름으로 신고하면 ISRCTN 이 `overallStartDate` 로 겪은 그 실패가
된다 — 조용히 다른 것을 걸러 놓고 사용자는 자기가 요청한 것을 받았다고 믿는다. 등록일 축을
스키마에 더할지는 **별도 결정**이고 이 설계의 범위 밖이다.

`condition` 의 `scope` 는 실측을 적는다: ICTRP 의 condition 은 ctgov 와 폭이 다르다
(diabetes → ICTRP 6,844 trials vs ctgov 24,273). 좁다고 단정하지 않고 **다르다**고 적는다 —
ctgov 쪽은 업스트림 동의어 확장이 일어난다고 이미 자기 `scope` 에 적고 있다.

### 2.1 `phase`

ICTRP: `Phase 0` `Phase 1` `Phase 2` `Phase 3` `Phase 4`.
공통 어휘: `early_phase_1` `phase_1` `phase_2` `phase_3` `phase_4` `na`.

- `phase_1`–`phase_4` 는 직접 대응한다.
- `early_phase_1` ↔ `Phase 0` 으로 잇는다. CT.gov 의 Early Phase 1 이 Phase 0 의 후신이다.
- **`na` 는 신고하지 않는다** — ICTRP 목록에 자리가 없다.

`exhaustive` 는 **여기서 정하지 않는다.** 필드테스트가 실측한다(§4). P1 이 세운 규칙대로,
지원되는 닫힌 어휘 축은 `exhaustive` 가 `null` 이면 계약 스위트가 막는다.

### 2.2 `status` 와 그것이 드러낸 구멍

`ddlRecruitingStatus` 의 값은 `Recruiting` 과 `ALL` 둘뿐이다. **상태 어휘가 아니라
"모집중만 / 전부" 토글이다.** 공통 어휘 8개 중 표현되는 것은 `recruiting` 하나다.

그래서 `status: { supported: true, values: ['recruiting'], ... }` 로 신고한다. 정직한 신고다.
**그런데 아무도 그것을 강제하지 않는다:**

- `assertSupported`(`src/cli/guard.ts`)는 축의 `supported` 와 `exhaustive` 만 본다.
- `args.ts` 는 값을 **공통 어휘**(`FILTERABLE_STATUS` 8개)에 대조할 뿐, 그 레지스트리가
  신고한 부분집합에는 대조하지 않는다.

지금까지 안 물린 이유는 두 어댑터 다 **전체를 신고하거나 축을 끄거나** 둘 중 하나였기
때문이다. ICTRP 는 **진부분집합을 신고하는 첫 어댑터**다. 그대로 두면
`--registry ictrp --status completed` 가 파싱과 가드를 통과한 뒤 필터가 조용히 사라진다 —
이 CLI 가 없애려는 실패 그 자체다. 닫는 법은 §5.2.

## 3. 전송

### 3.1 검색

1. `AdvSearch.aspx` 를 GET 해 hidden 필드(`__VIEWSTATE`·`__EVENTVALIDATION`·
   `__VIEWSTATEGENERATOR`)를 수확한다. 쿠키 세션을 유지한다.
2. 폼 필드에 질의를 채우고 `btnSearch` 로 POST 한다.
3. 결과 HTML 에서 건수(`N records for M trials found`)와 행(`Trial2.aspx?TrialID=…`)을 읽는다.

### 3.2 페이지 — `nextPageToken` 에 ViewState 를 싣지 않는다

ViewState 는 11.7KB 이상이고 결과 페이지에서는 더 크다. 그것을 봉투의 `nextPageToken` 에
실으면 **봉투가 데이터보다 커진다.** 그리고 그것은 커서가 아니라 서버 내부 상태의 직렬화라,
호출자가 저장했다가 나중에 쓰는 순간 무엇이 깨지는지 아무도 설명할 수 없다.

**대신 페이지 번호를 토큰으로 쓴다.** 어댑터는 매 호출에서 검색을 처음부터 다시 몰아
그 페이지까지 postback 한다.

**대가를 문서와 `scope` 에 적는다:** N 페이지를 받으려면 요청이 N+1 번이다. ctgov 는 업스트림이
준 불투명 커서를 그대로 넘기지만 **ICTRP 는 그런 것을 주지 않고**, 프로세스가 매 호출마다 죽는
CLI 에서 세션을 이어 붙일 방법이 없다. 그래서 이것이 유일하게 가능한 방법이다.

이 비용 때문에 다음 둘을 신고한다:

- `limits.maxPageSize = 100` — 폼이 주는 최대치. `applyLimits` 가 이미 레지스트리별로 적용하고
  `page_size_clamped` 로 알린다.
- `limits.ratePerSec = 1` — 요청 하나가 여러 번의 postback 을 뜻하므로 보수적으로 잡는다.
  `ratePerSec` 는 이미 어댑터 선언값을 쓴다(커밋 `5ad8450`).

### 3.3 `get` 과 `results` 는 첫 판에 없다

`capability.get`·`capability.results` 를 `supported: false` 로 신고한다.
`Trial2.aspx?TrialID=<id>` 가 안정적인 GET 이라 `get` 은 다음 판에 어렵지 않게 열 수 있다 —
**막혀서가 아니라 파싱 면적을 줄이려고 미룬다.** `results` 는 ICTRP 가 구조화된 결과 데이터를
싣지 않으므로(TRDS 항목 23 은 요약 결과의 유무·링크다) 당분간 열리지 않는다.

## 4. capability 는 실측에서만 나온다 — `scripts/ictrp-field-test.ts`

ISRCTN 선례를 그대로 따른다(`scripts/isrctn-field-test.ts`). 스텁 기반 계약 스위트로는
**필드명이 틀려 조용히 무시되는 것**을 원리상 잡을 수 없기 때문이다 — ISRCTN 에서 실제로
겪었고, 그래서 ICTRP 도 같은 방어선이 필요하다.

스크립트가 재는 것:

1. **양방향 확인.** `true` 로 신고한 축은 실제로 결과를 좁히는가(같은 질의에 축을 더했을 때
   건수가 줄어드는가), `false` 로 신고한 축은 정말 자리가 없는가.
2. **닫힌 어휘의 `exhaustive`.** `phase` 값별 건수의 합을 전체와 대조한다.
   `scripts/exhaustive.ts` 의 `judgeExhaustive`/`compareDeclared` 를 그대로 쓴다 —
   선언이 `null` 이면 이제 실패다(커밋 `f61a318`).
   `status` 는 값이 하나뿐이라 합/총계 대조가 성립하지 않는다. **실측 불가를 실측 불가라고
   적고**, `exhaustive: false` 로 신고한다(증명하지 못하면 덜 신고한다).
3. **선언은 capability 에서 읽는다.** 리터럴을 적으면 대조가 자기 자신을 검사하게 된다 —
   두 기존 스크립트의 같은 자리에 붙은 주석과 같은 이유이고, 그 이음매는 스위트가 못 잡는다.

## 5. core 변경 둘

둘 다 ICTRP 때문에 필요해졌지만 **모든 어댑터가 덕본다.**

### 5.1 `IdSpec` 에 "추론 대상 아님"

`parseTrialId` 의 접두사 없는 경로는 이렇다:

```ts
const inferred = REGISTRY_KEYS.find((key) => ID_PATTERNS[key].pattern.test(trimmed));
```

**배열 순서대로 첫 매치가 이긴다.** ICTRP 의 ID 는 20여 레지스트리의 형식이 섞여 있어
(`NCT…`, `ISRCTN…`, `CTRI/2026/07/113311`, `JPRN-jRCT…`, `DRKS…`) 패턴이 관대해질 수밖에 없고,
그러면 둘 중 하나가 터진다:

- `ictrp` 가 앞에 오면 맨 `NCT01234567` 이 **ctgov 대신 ICTRP 로** 간다 — 기존 호출자 전원의
  동작이 조용히 바뀐다.
- 맨 뒤에 둬도, 지금은 깔끔하게 exit 2(`레지스트리를 알아낼 수 없습니다`)가 나는 입력이
  ICTRP 로 라우팅됐다가 0건이 된다.

그래서 `IdSpec` 에 **추론에 참여하지 않는다는 표시를 명시적으로 둔다.** 매치되지 않는
정규식(`/(?!)/`)으로 같은 효과를 낼 수 있지만 그것은 트릭이라, 다음 사람이 버그로 알고
"고칠" 위험이 있다. 이 저장소의 규율은 **왜 없는지를 그 자리에 남기는 것**이다.

귀결: **ICTRP 는 언제나 `ICTRP:` 접두사를 요구한다.** 그리고 `ICTRP:NCT07749586` 과
`CTGOV:NCT07749586` 은 **같은 시험의 두 ctreg id** 다. 「연계하지 않는다」의 직접적 귀결이고,
받아들인다 — 다만 `registries` 와 README 가 그것을 말해야 한다.

### 5.2 가드에 "요청 값 ⊆ 신고 값"

`assertSupported` 에 검사를 더한다: 닫힌 어휘 축을 실제로 썼고, 그 축이 `supported: true` 이며,
`values` 가 요청한 값을 담지 않으면 **exit 3**. 축 미지원과 같은 코드인 이유는 사용자 입장에서
같은 사실이기 때문이다 — **결과가 없는 것이 아니라 그렇게 물어볼 수 없다.**

문구는 그 레지스트리가 받는 값을 함께 말한다(F4 에서 배운 것: 막기만 하면 복구 경로가 없다).

**사보타주는 부르는 자리를 겨눈다.** 이 저장소에서 같은 형태의 구멍이 세 번 났다.
검사를 지웠을 때 다섯 커맨드 각각에서 빨개져야 한다.

## 6. 자기 고장 감지 — 이 어댑터의 안전장치

계약이 없는 HTML 표면이라 **언제든 깨질 수 있다.** 이 설계는 그 사실을 없애지 못한다.
대신 깨짐을 **조용한 실패에서 시끄러운 실패로** 바꾼다.

결과 페이지는 건수와 행을 **둘 다** 낸다. 그래서:

> 건수 > 0 인데 파싱된 행이 0 이면 **exit 4(업스트림 오류)** 다.

HTML 구조가 바뀌면 0건 · exit 0 이 아니라 오류가 나간다. 반대로 건수가 진짜 0 이면 그것은
정상 경로이고, P2 의 `zero_results_scope` 가 이미 축의 `scope` 를 붙여 "0건이 없다는 뜻인지
이 축이 그것을 보지 않는다는 뜻인지 구분하지 못한다"고 말한다.

**이 규칙이 못 잡는 것도 적어 둔다:** 건수 문구 자체의 형식이 바뀌면 건수도 행도 0 이 되어
진짜 0건과 구별되지 않는다. 그 경우를 잡으려면 "알려진 질의가 0 이 아니다" 검사가 필요하고,
그것은 필드테스트의 몫이다(§4) — 스텁 스위트로는 원리상 못 잡는다.

## 7. 약관

검색 결과 페이지에 붙어 나오는 WHO ICTRP 이용 약관의 요구:

- **비상업 용도** — `marketing, promotional or commercial purposes` 금지.
- **출처를 WHO ICTRP 로 표기**, 데이터를 최신으로 유지.
- **ICTRP 가 처리한 날짜를 명시.**

마지막 조항 때문에 레코드에 ICTRP 의 `Last refreshed on` 을 싣는다. 이 값은
**시험이 갱신된 날이 아니라 ICTRP 가 자기 사본을 수확한 날**이다(실측: ctgov `2022-03-14` →
ICTRP `2022-03-21`, `2024-06-03` → `2024-06-10` — 두 표본 다 7일 뒤). `dates.lastUpdated` 에
그대로 넣으면 **다른 것을 같은 이름으로 신고하는** 것이 되므로, 그 자리에 넣지 않는다.
어디에 싣고 어떻게 이름 붙일지는 구현 계획에서 정한다.

비상업 조항은 README 에 한 줄로 적는다.

## 8. 첫 판의 범위

**들어가는 것**

- `REGISTRY_KEYS` 에 `ictrp` 추가(→ `ID_PATTERNS` 항목이 컴파일로 강제된다)
- `search` · `count`
- capability 선언(§2) — `exhaustive` 는 필드테스트가 실측한 값
- `scripts/ictrp-field-test.ts`
- core 변경 둘(§5)
- 계약 스위트에 `ictrp.contract.test.ts`

**안 들어가는 것**

- `get` · `results` — `supported: false` 로 신고
- 등록일 축을 스키마에 더하는 것 — 별도 결정
- 중복 제거·교차 레지스트리 연계 — §0 에서 기각

## 9. 알려진 한계 (신고하거나 문서에 적을 것)

1. 계약 없는 HTML 표면. §6 이 조용한 실패만 막는다.
2. 페이지 N 을 받으려면 요청 N+1 번(§3.2).
3. 레코드가 TRDS 최소치다 — 좌표 없음, 등록 인원은 **target only**(실측: 라벨이
   `Target sample size` 하나뿐), `Last refreshed on` 은 수확일.
4. 같은 시험이 ctgov·ISRCTN 과 **다른 ctreg id** 로 나온다(§5.1). 의도된 것이다.
5. `condition` 의 폭이 ctgov 와 다르다(§2). `scope` 가 말한다.
6. ICTRP 사본이 원본보다 secondary ID 를 덜 실은 사례가 있다(§0). 이 설계는 그것에
   의존하지 않지만, `id` 축(`txtSecondaryID`)의 `scope` 에 적어 둔다.
