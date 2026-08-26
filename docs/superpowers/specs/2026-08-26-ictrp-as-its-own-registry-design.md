# ICTRP 를 별도 레지스트리로 붙인다 — 설계

- **일자:** 2026-08-26
- **상태:** 구현됨 — 커밋 `9c004d5..6dc1e47`
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
| 진짜 질의 표면 | `AdvSearch.aspx` 의 ViewState POST. quick search(`Default.aspx?...`)는 **다른 것**이고 훨씬 좁다(pembrolizumab 86 vs 1,013 — 후자는 모집중만, §1.1) |
| 쿠키 | **필요 없다.** 검색 POST 도 페이지 postback 도 쿠키 없이 성립한다 |
| 페이지 크기 컨트롤 | `ctl00$ContentPlaceHolder1$ddlPageSize` |
| 결과 행이 싣는 것 | 모집상태 · TrialID · Public title · 등록일 |
| 총계 | **절단 없음.** `title=a` → `120819 records for 110319 trials` |
| 페이지 | `dlPager2$ctlNN$lnkPageNo` postback. 2페이지 확인, 1페이지와 겹침 0 |
| 페이지 크기 | 폼이 10 / 20 / 50 / 100 을 제공 |
| 결과 행 | `Trial2.aspx?TrialID=<id>` 링크. 한 결과에 NCT·CTRI·JPRN-jRCT·DRKS 혼재 |
| 레코드 | `Trial2.aspx?TrialID=<id>` 는 **세션 없는 안정적 GET** |
| 묶음 | 결과가 `N records for M trials` 로 나온다(pembrolizumab 1,435 → 1,013) |

### 1.1 `ddlRecruitingStatus` 의 기본값 — 구현이 반드시 막아야 할 함정

`ddlRecruitingStatus` 에는 `selected` 속성이 없다. 즉 **기본 선택이 첫 항목인 `1`(Recruiting)**
이고, 폼 필드를 보내지 않으면 서버는 그 값을 쓴다. 실측:

| 보낸 값 | diabetes 결과 |
| :-- | :-- |
| (보내지 않음) | `7107 records for 6844 trials` — 1페이지 상태 전부 `Recruiting` |
| `1` | 같음 |
| `ALL` | **`40635 records for 36264 trials`** — 1페이지에 `Not Recruiting` 9 / `Recruiting` 1 |

**따라서 어댑터는 사용자가 `--status recruiting` 을 주지 않는 한 언제나 `ALL` 을 명시해야 한다.**
명시하지 않으면 모든 질의가 조용히 모집중만으로 좁혀진다 — 이 CLI 가 없애려는 실패 그 자체이고,
어느 경고도 붙지 않는다. 필드테스트가 이 불변식을 지킨다(§4).

이 발견이 §2 의 `condition` 관찰도 뒤집는다: ICTRP 의 diabetes 는 **36,264 trials** 로 ctgov 의
24,273 보다 **크다**(집계자이므로 당연하다). "ICTRP 가 ctgov 보다 좁다" 는 관찰은 기본값이
만든 착시였다.

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
| `location` | `txtFreeCountry` + `lstCountries` | **false** — 아래 §2.3(필드테스트가 죽은 축임을 실측) |
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

`condition` 의 `scope` 는 실측을 적는다: 모든 상태를 포함하면 ICTRP 의 diabetes 는
**36,264 trials** 로 ctgov 의 24,273 보다 크다(§1.1). 집계자이므로 자연스럽다. 동의어 처리는
양쪽이 다르므로(ICTRP 는 끄는 체크박스가 있고 ctgov 는 업스트림이 확장한다) `scope` 는
**다르다**고만 적고 어느 쪽이 넓다고 단정하지 않는다.

### 2.1 `phase`

ICTRP: `Phase 0` `Phase 1` `Phase 2` `Phase 3` `Phase 4`.
공통 어휘: `early_phase_1` `phase_1` `phase_2` `phase_3` `phase_4` `na`.

- `phase_1`–`phase_4` 는 직접 대응한다.
- `early_phase_1` ↔ `Phase 0` 으로 잇는다. CT.gov 의 Early Phase 1 이 Phase 0 의 후신이다.
- **`na` 는 신고하지 않는다** — ICTRP 목록에 자리가 없다.

`exhaustive` 는 **여기서 정하지 않는다.** 필드테스트가 실측한다(§4). P1 이 세운 규칙대로,
지원되는 닫힌 어휘 축은 `exhaustive` 가 `null` 이면 계약 스위트가 막는다.

**여러 단계를 고르면 키를 반복해 보낸다 — 콤마로 이으면 안 된다(실측 2026-08-26).**
`ListBoxPhase` 는 multi-select 라 값 하나에 콤마로 둘을 넣으면 **페이지가 깨진다.**

| 보낸 것 | diabetes(ALL) 결과 |
| :-- | :-- |
| phase 없음 | 36,264 trials |
| `Phase 3` | 4,027 |
| `Phase 2` | 2,749 |
| `"Phase 2,Phase 3"` | **건수 문구 자체가 없음 — 깨진 페이지** |
| 같은 키를 두 번 | 6,775 (≈ 합, 겹침 1건) |

콤마 이음이 특히 나쁜 이유는 그냥 안 되는 것이 아니라 **조용히 0건이 되기** 때문이다. 깨진
페이지에는 건수 문구가 없어 `parse.ts` 가 `records = 0` 으로 읽고, 자기 고장 감지(§6)는
`records > 0` 일 때만 발화하므로 통과한다. 사용자에게는 "그런 시험 없음" 으로 도착한다.

귀결: 폼 본문을 `Record<string, string>` 으로 표현할 수 없다(중복 키가 불가능하다).
`buildForm` 의 반환과 `postForm` 의 `form` 을 **`[이름, 값]` 쌍의 배열**로 둔다.
`new URLSearchParams(pairs)` 가 그 모양을 그대로 받으므로 인코딩 로직은 바뀌지 않는다.
캐시 키를 만드는 `cacheKeyParams` 는 **논리 질의**이지 전송 본문이 아니므로 그대로 `Record` 다.

### 2.3 `location` — 신고를 내렸다 (필드테스트 실측 2026-08-26)

원래 `true` 로 신고했다. **필드테스트가 첫 실행에서 그것이 거짓임을 잡았다:** 서로 다른 나라
세 개를 각각 넣은 질의가 **전부 무필터 기준선(1,148,325건)과 같은 수**를 냈다. 수가 똑같다는 것은
그 절이 서버에 도달조차 하지 않는다는 뜻이다.

원인: `AdvSearch.aspx` 는 `txtFreeCountry` 에 적은 값을 **`butAdd` postback** 으로
`lstCountriesSelected` 로 옮겨야 검색에 반영한다. `buildForm` 은 텍스트 상자만 채우므로 그 값은
어디에도 쓰이지 않는다.

**그래서 `supported: false` 다.** 조용히 전체를 돌려주는 축을 지원한다고 신고하는 것은 이 CLI 가
없애려는 실패 그 자체이고, ISRCTN 이 죽은 필드를 `false` 로 신고한 것과 같은 자리다.
지금은 `--location` 이 exit 3 으로 즉시 거절된다(네트워크를 치지도 않는다).

**되살리는 길 — 이제 실측됐다(2026-08-26).** 검색 POST 전에 `butAdd` 왕복을 한 번 더 하면
**실제로 걸린다.** `condition=diabetes` · 상태 ALL 기준:

| 보낸 것 | 결과 |
| :-- | :-- |
| 나라 없음(기준선) | 36,264 trials |
| `txtFreeCountry` 만 | **36,264 trials** — 기준선과 같다(죽어 있다) |
| `butAdd` 왕복 뒤 `lstCountriesSelected=Japan` | **2,981 trials** — 걸린다 |

`butAdd` POST 를 보내면 응답의 `lstCountriesSelected` 에 `Japan` 이 들어가 있고, 그 상태의
ViewState 로 검색하면 나라로 좁혀진다. 첫 판에서 뺀 이유(왕복이 필터를 거는지 재지 않았다)는
이제 해소됐다 — **남은 것은 구현이고, 그 대가는 질의마다 요청 하나가 더 는다는 것이다**
(지금도 폼 GET + 검색 POST 이므로 나라를 쓰면 셋이 된다).

되살릴 때 함께 정할 것: 나라 이름의 어휘(포털의 목록에 있는 이름만 받는가), 그리고 `location`
이 `scope` 에서 약속할 범위(국가 단위뿐이고 도시·기관은 여전히 없다).

**이것이 필드테스트를 만든 이유 그 자체다.** 스텁 계약 스위트는 원리상 이것을 잡을 수 없다 —
스텁은 무엇을 물어보든 같은 픽스처로 답하기 때문이다.

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

**레코드의 `status` 는 별개 문제다.** `TrialRecord.status` 는 필수인데 결과 행이 싣는 값은
`Recruiting` / `Not Recruiting` **이진**이다(실측). 매핑:

| ICTRP 행 | `status` | `statusRaw` |
| :-- | :-- | :-- |
| `Recruiting` | `recruiting` | `Recruiting` |
| `Not Recruiting` | `other` | `Not Recruiting` |

`other` 인 이유는 어휘의 정의 그대로다 — `unknown` 은 "레지스트리가 모른다", `other` 는
**"매핑 없음"** 이다. `Not Recruiting` 은 ICTRP 가 아는 값이지만 완료·중단·모집종료를 한데
묶은 굵은 통이라 여덟 개 중 어느 것과도 같지 않다. `completed` 로 접으면 거짓이 된다.
원문은 `statusRaw` 가 보존한다.

## 3. 전송

### 3.1 검색

1. `AdvSearch.aspx` 를 GET 해 hidden 필드(`__VIEWSTATE`·`__EVENTVALIDATION`·
   `__VIEWSTATEGENERATOR`)를 수확한다. **쿠키는 필요 없다**(실측).
2. 폼 필드에 질의를 채우고 `btnSearch` 로 POST 한다. `ddlRecruitingStatus` 는
   **언제나 명시한다**(§1.1) — 사용자가 `--status recruiting` 을 줬으면 `1`, 아니면 `ALL`.
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

- `limits.maxPageSize = 10` — **정정(구현 중 실측 2026-08-26).** 원래 `100` 으로 적었던 것은
  근거가 없었다. 페이지 크기 컨트롤(`ddlPageSize`)은 **결과 페이지에만** 렌더되고, 그것을 검색
  POST 에 실으면 ASP.NET 이 `__EVENTVALIDATION` 으로 그 POST 를 거절해 **결과가 0건이 된다**
  (실측: 안 보내면 10행, `50`/`100` 을 보내면 각각 0행). 즉 검색 시점에는 페이지 크기를 정할 수
  없고 첫 페이지는 언제나 10행이다. 그래서 어댑터는 `ddlPageSize` 를 **보내지 않는다** —
  보내면 조용히 틀린 답(0건)이 나가는데, 그것이 이 도구가 없애려는 실패 그 자체다.
  `applyLimits` 가 레지스트리별로 적용하고 `page_size_clamped` 로 알린다.

  **감수하는 대가:** CLI 기본 페이지 크기가 20(`CAPS.pageSize.default`)이라 **기본 질의마다**
  `page_size_clamped` 가 붙는다. 늘 발화하는 경고는 L11 의 자리이지만, 이 경고는 참이고 고치는
  법(`--page-size 10`)을 함께 말하므로 침묵보다 낫다고 판단했다. 더 받으려면 페이지를 넘긴다
  (페이저 postback 은 실측으로 동작한다 — 2페이지가 겹침 0으로 다른 10건을 낸다).
- `limits.ratePerSec = 1` — 요청 하나가 여러 번의 postback 을 뜻하므로 보수적으로 잡는다.
  `ratePerSec` 는 이미 어댑터 선언값을 쓴다(커밋 `5ad8450`).

### 3.2.1 페이저는 라벨로 읽는다 — 마지막 링크는 페이지가 아니다

결과 화면의 페이저는 전체 목록이 아니라 **창(window)** 이고, 그 창의 마지막 링크는 페이지
번호가 아니라 **`Last`** 다. 커밋된 픽스처가 그렇다: `ctl00`→`1` … `ctl09`→`10`, `ctl10`→`Last`.

그래서 컨트롤 인덱스로 페이지를 세면 **한 칸이 어긋난다.** 실제로 그렇게 만들었다가 최종
리뷰의 재리뷰가 잡았다: `ctl10` 이 있으니 11페이지도 갈 수 있다고 판단하고 `Last` 를 눌러
**전체의 마지막 페이지를 11페이지라고 내주었다.** 결과가 적은 질의일수록 빨리 닿는다 —
링크가 `ctl01`..`ctl03`(2~4페이지) + `ctl04`=`Last` 라면 5페이지 요청이 그렇게 된다.

**구별할 근거는 화면에 있다.** 앵커 본문이 곧 페이지 번호이고 그 앵커의 `href` 안에 postback
대상 이름이 있다. 둘을 **한 앵커에서 함께** 읽으므로 번호와 대상이 어긋날 수 없다. 인덱스
산술(`pagerTarget(page - 1)`)은 통째로 사라졌다 — 추측하던 자리가 없어진 것이 이 수정의 요점이다.

번호가 아닌 라벨(`Last`, `>>`)은 잡지 않는다. 그 자리가 몇 페이지인지 화면이 말해 주지 않기
때문이고, 모르는 것을 아는 척하지 않는 것이 이 저장소의 규칙이다. 현재 페이지의 링크는
`disabled` 라 `href` 가 없어 역시 잡히지 않는다 — 지금 있는 페이지로 postback 할 일은 없다.

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

## 5. core 변경 셋

전부 ICTRP 때문에 필요해졌지만 **모든 어댑터가 덕본다.**

### 5.0 `http.ts` 에 POST

지금 런타임이 내보내는 것은 `getJson` 하나이고 **GET 전용**이다. ICTRP 는 폼 POST 가 필요하다.
그렇다고 어댑터가 `fetch` 를 직접 부르면 캐시·스로틀·재시도·타임아웃·`page_size_clamped`
같은 신뢰성 장치를 통째로 다시 구현하게 되고, **레지스트리마다 신뢰성이 갈린다** — `decode`
훅이 존재하는 이유와 같은 논거다(그 자리 주석 참고).

그래서 캐시/스로틀/재시도 루프를 내부 함수로 뽑고 `getJson` 과 새 `postForm` 이 함께 쓴다.
`getJson` 의 시그니처와 동작은 **바뀌지 않는다**.

**캐시 키는 ViewState 가 아니라 논리 질의로 만든다.** ViewState 는 요청마다 달라서 그것을
키에 넣으면 캐시가 영원히 미스다. 폼을 얻는 GET 은 캐시하지 않는다(ViewState 가 만료될 수
있다). 캐시하는 것은 **최종 결과 페이지**이고, 키는 사용자가 준 질의 + 페이지 번호다.

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
검사를 지웠을 때 **닿는 자리마다** 빨개져야 한다.

**정정(구현 중 실측):** "다섯 커맨드" 는 틀렸다. `assertSupported` 를 부르는 것은 셋
(`search`·`count`·`get`)이고, 그중 `get` 은 질의로 `{}` 를 넘기므로 이 검사가 영구히
무효다(`get.ts`). 실제로 닿는 자리는 `search` 와 `count` 둘이다.

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
그대로 넣으면 **다른 것을 같은 이름으로 신고하는** 것이 된다.

**자리:** `TrialRecordSchema` 는 `strictObject` 라 임의 키를 받지 않는다. 그래서 선택 필드
`sourceRefreshedAt?: string` 을 스키마에 더한다 — "이 레코드를 이 레지스트리가 마지막으로
수확한 시각". 집계 레지스트리에만 의미가 있으므로 ctgov·ISRCTN 은 채우지 않는다. 이름에
`source` 를 넣는 이유는 `dates.*` 가 **시험의** 날짜를 담는 자리이기 때문이다 — 그 안에 넣으면
같은 뭉치 안에서 두 가지 뜻이 섞인다.

첫 판은 `search` 만 있고 결과 행에는 이 값이 없다(행이 싣는 것은 상태·ID·제목·등록일뿐).
따라서 **첫 판에서는 채워지지 않는다** — 필드와 그 뜻만 먼저 세우고, `get` 이 열릴 때
`Trial2.aspx` 의 `Last refreshed on` 으로 채운다. 약관의 처리일 표시 의무는 그때 충족된다.
그 전까지는 README 가 ICTRP 데이터의 출처와 수확 주기(주간, 실측)를 적는다.

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
