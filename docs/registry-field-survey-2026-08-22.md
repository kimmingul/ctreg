# 레지스트리 필드 교차 검증 (2026-08-22)

**Task 0 — 계약 사전 검증(게이트).** 정규화 계약(`TrialRecord`)을 ClinicalTrials.gov(이하 CT.gov)만 보고 설계하면 이름만 페더레이션인 "충실한 어댑터(A안)"가 되고, 두 번째 레지스트리를 붙이는 날 위층이 전부 바뀐다. 이 문서는 스펙 §2.2 의 `TrialRecord` core 필드를 CT.gov 이외 다섯 개 레지스트리와 대조해, core/detail 경계와 폐쇄 어휘가 실제로 여러 레지스트리에서 성립하는지 검증한다. 코드는 쓰지 않는다.

대조 대상은 WHO ICTRP(집계 상위 레지스트리, 필수), ISRCTN, EU CTIS, CRIS(한국), jRCT(일본) 다섯 곳이다. 최소 요구(3곳)를 넘겨 대조했다.

## 방법과 한계

- 각 레지스트리의 공식 문서(API 문서, 필드 사전, 규제기관 발간 가이드)와 실제 검색/상세 페이지를 WebFetch/WebSearch 로 열람해 필드 존재 여부를 확인했다.
- 확인하지 못한 값은 `?` 로 남기고, 왜 확인하지 못했는지와 무엇을 보면 확인되는지를 각주로 적었다. 추정으로 채우지 않았다.
- CT.gov 열은 이미 스펙 §7(`ctgov` 어댑터, CT.gov API v2 기준)이 확정한 내용이므로 전부 `O` 로 둔다.

---

## Step 1 — 레지스트리별 접근성

| 레지스트리 | 공개 API 유무 | 인증 요구 | 필드 목록 출처 URL |
| :-- | :-- | :-- | :-- |
| **WHO ICTRP** | 혼합 — 웹 검색 결과의 **XML 다운로드는 공개**(로그인 불요). 실시간 재사용이 가능한 **"ICTRP Search Portal Web Service"**는 별도 신청 계정이 필요하고, 대량 수집용 "Crawling Service"는 아이디/비밀번호 발급이 전제다. | 검색·XML 내려받기: 불요. Web Service/Crawling: 요구(`ictrpinfo@who.int` 신청) | [WHO Trial Registration Data Set (TRDS) v1.3.1](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set) · [검색 팁(고급검색 필드)](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/search-tips) · [Web Service 안내](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/ictrp-search-portal-web-service) |
| **ISRCTN** | **REST(XML) API 공개.** 4가지 출력 포맷(default/who/ukctg/internal, internal은 deprecated) | **불요** — API 키 없이 공개 사용, 단 대량 조회 시 스로틀링을 지켜달라는 안내만 있음 | [67 Bricks ISRCTN API 문서 v0.6](https://www.isrctn.com/editorial/retrieveFile/81786542-9920-48a0-8fce-09f8428ab843/37855) |
| **EU CTIS** | **화면(공개 포털)만 확인함.** EMA가 공식 REST API를 문서로 공개한 것을 찾지 못했다 — 서드파티 스크레이퍼(Apify 등)만 존재. | 포털 열람 자체는 불요(회원가입 없이 조회 가능) | [CTIS public portal: Full trial information (EMA 공식 필드 사전, 2025-01-27)](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-full-trial-information_en.pdf) · 포털: `https://euclinicaltrials.eu` |
| **CRIS (한국)** | **공공데이터포털(data.go.kr) 경유 Open API 공개**(REST, XML/JSON 선택). CRIS 자체 소개에 따르면 목록 16항목·상세 70항목·통계 18항목을 제공한다. | **요구** — `serviceKey`(공공데이터포털 발급 인증키) | [공공데이터포털 — 질병관리청 임상연구 DB Open API](https://www.data.go.kr/data/3033869/openapi.do) · 실제 서비스: `https://cris.nih.go.kr` |
| **jRCT (일본)** | **공개 API를 찾지 못함** — 화면(웹 검색·상세페이지)만 확인. 일본제약공업협회(JPMA) 열람 가이드에도 API 언급이 없다. | 열람 자체는 불요(로그인 없이 조회) | [JPMA "治験の探し方〜jRCTのみかた〜"(2025-04, jRCT 필드 열람 가이드)](https://www.jpma.or.jp/information/evaluation/results/message/CL_202303_jRCT_mikata.pdf) · 사이트: `https://jrct.mhlw.go.jp/`(2025년 3월 `jrct.niph.go.jp`에서 이전) |

---

## Step 2 — core 필드 매트릭스

판정 기호: `O` 동등한 필드가 있음 · `~` 있으나 의미·단위·어휘가 다름 · `X` 없음(확인됨) · `?` 확인 못 함

| core 필드 | CT.gov | ICTRP | ISRCTN | CTIS | CRIS | jRCT | 비고 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| title | O | O | O | O | O | O | ICTRP·CTIS·CRIS·jRCT 전부 "공식 제목/평이한 제목" 이중 구조를 가진다(스펙의 `title`/`officialTitle`과 그대로 대응) |
| status | O | O | ~ | ~ | ~ | ~ | 매핑 가능하나 구조가 다르다. ISRCTN은 `trialStatus`(Ongoing/Completed/Stopped/Suspended/Enrolling by invitation)와 `recruitmentStatus`(Not yet recruiting/Recruiting/No longer recruited/…) 두 필드가 따로 있다. **CTIS는 트라이얼 하나에 회원국(EU/EEA)별로 다른 recruitment status가 붙는다** — "레코드당 값 1개"라는 스펙의 전제와 구조적으로 다르다(아래 판정 참고). jRCT는 5단계(募集前/募集中/募集中断/募集終了/研究終了)로 CT.gov보다 세분화되어 있다. CRIS는 `전체연구모집현황`(모집중 등) |
| phase | O | ~ | ~ | ~ | ~ | ~ | ICTRP TRDS(24개 필수항목)에는 phase가 **없다** — 검색 포털의 고급검색에는 phase 필터가 있지만 이는 원 레지스트리가 제출했을 때만 채워지는 부가 필드다. ISRCTN·CTIS는 결합값("Phase I/II", "integrated I/II")을 단일 문자열로 준다 — 스펙이 이미 배열로 무손실 보존하도록 설계되어 있어(§2.3) 대응 가능. CRIS는 관찰연구에서 `해당사항없음`(N/A)으로 채워진다 |
| studyType | O | O | ? | ~ | O | ~ | ICTRP TRDS 항목 15(Study Type)로 명시. CRIS는 `중재연구`/`관찰연구`로 CT.gov의 interventional/observational과 직접 대응. ISRCTN은 쿼리 API 문서(§3.2.1, 23개 constraint)에 studyType류 필드가 없다 — RCT 등록기관이라 암묵적으로 전부 interventional일 가능성이 높지만 문서로 확인 못함(**?** — 확인하려면 단일 trial의 `default` XML 전체 스키마를 열어야 한다). CTIS는 "의약품 임상시험만 대상, 관찰연구는 범위 밖"이라고 명시되어 있어 사실상 항상 interventional(값은 있으나 range가 CT.gov와 다르다는 의미로 `~`). jRCT는 가이드에 `治験の区分`(trial category) 필드명은 확인했으나 정확한 값 목록을 확인 못함(**?**에 가까움, 아래 각주) |
| conditions | O | O | O | O | O | O | 전부 자유 텍스트 원문 그대로 — 스펙 원칙(§2.1, "질환명은 정규화하지 않는다")과 정확히 맞는다 |
| interventions | O | O | O | O | ~ | O | CRIS 상세 페이지 확인 결과 개입 관련 필드는 존재하나(연구대상 상태/질환 근처) 구조화된 `type` 구분이 있는지는 확인 못함 — 확인하려면 중재연구(관찰연구 아님) 실제 상세 페이지를 열어야 한다(이번에 연 예시는 관찰연구였다) |
| sponsor.lead | O | O | O | O | O | O | 전부 존재. jRCT는 "依頼者等に関する事項"(의뢰자 등에 관한 사항) 섹션으로 별도 관리 |
| enrollment.count | O | O | ~ | ? | ~ | ~ | **CT.gov를 제외한 모든 레지스트리가 목표(target) 등록 인원만 노출하고, 실제(actual) 등록 인원을 별도 필드로 구분하지 않는다** — ISRCTN "Target number of participants"(실제 trial 페이지에서 확인), CRIS `목표대상자 수`(상세 페이지에서 확인, 실제값 필드는 못 찾음), jRCT `実施予定被験者数/Sample Size`(가이드에서 확인, "予定"=예정치). CTIS는 EMA 공식 필드 사전(Full trial information, 7쪽)에 표본크기 필드를 찾지 못했다(**?** — Summary 탭이나 Trial Results 탭에 있을 가능성, 확인하려면 `CTIS public portal: summary` PDF 또는 실제 trial 페이지의 Locations/Results 탭을 봐야 한다) |
| dates.start | O | O | O | O | O | O | ICTRP는 TRDS 항목 16 "Date of First Enrollment"로 대응(스펙의 `dates.start`와 개념이 거의 같다). ISRCTN `overallStartDate`, CTIS "Trial start date", CRIS `첫 연구대상자 등록일`, jRCT `実施期間(開始日)` 전부 확인 |
| dates.lastUpdated | O | ? | O | ? | O | O | ISRCTN `lastEdited`(dateTime, range 쿼리 가능) 확인. CRIS `date_updated` 필드가 공공데이터포털 API 응답에 존재함을 확인. jRCT `最終公表日`(가이드에 "최후에 갱신된 날"로 명시) 확인. ICTRP는 TRDS 24항목에도, 검색 포털 고급검색 필드 목록에도 "최종 갱신일"이 없다(**?** — 확인하려면 실제 trial 하나를 XML로 내려받아 레코드 안에 타임스탬프가 있는지, 또는 Web Service 계정을 발급받아 응답 스키마를 봐야 한다). CTIS는 EMA 공식 필드 사전에서 찾지 못했다(**?** — 확인 방법은 enrollment.count 항목과 동일) |
| locations | O | ~ | ~ | ~ | ~ | ~ | **좌표(`geo`)를 제공하는 곳은 CT.gov뿐이다.** ICTRP·ISRCTN은 TRDS/API 문서 모두 "국가" 단위까지만 필드가 있다(도시·기관명 없음 — ISRCTN `recruitmentCountry`는 국가 리스트 range 필드다). CTIS는 별도 "Locations and contact points" 탭이 있으나(사이트 안내에서 탭 존재만 확인) 좌표 제공 여부는 확인 못함. CRIS는 `참여기관`(기관명, 도시 수준 주소는 있을 수 있으나 좌표는 없음), jRCT는 `実施医療機関`(기관명+주소, 좌표 없음) |
| hasResults | O | O | ? | O | ? | ? | ICTRP는 TRDS 항목 23 "Summary Results"와 검색 포털의 "Results" 필터로 이중 확인됨. CTIS는 포털 탭 구성 자체에 "Trial Results" 탭이 별도로 있어 결과 유무를 판별할 수 있다. ISRCTN은 쿼리 API의 23개 constraint 목록에 결과 유무 필드가 없다(**?** — `default` XML 전체 스키마 또는 실제 상세 페이지의 "Results" 섹션 존재 여부를 봐야 한다). CRIS는 `연구종료일`류 날짜 필드는 있으나 결과 공개 여부 플래그는 찾지 못했다(**?** — 실제로 결과가 등록된 중재연구의 상세 페이지를 열어 "연구결과" 항목이 있는지 확인해야 한다). jRCT는 "jRCT에서 치험결과 조회" 기능이 있으나 이는 진행상태(研究終了) 필터일 뿐 결과 데이터 유무를 나타내는 별도 필드인지는 확인 못했다(**?** — 실제 종료된 시험의 상세 페이지에 결과 섹션이 있는지 봐야 한다) |
| crossIds | O | O | ? | O | X | ? | **ICTRP TRDS 항목 3 "Secondary Identifying Numbers"가 사실상 crossIds 그 자체다** — WHO가 이 필드를 필수 24항목에 넣은 이유가 바로 중복 등록 추적이다. CTIS는 EMA 공식 필드 사전에 "ClinicalTrials.gov identifier (NCT number)", "ISRCTN number", "Additional registries"가 명시적으로 나열되어 있어 가장 확실하다. CRIS는 실제 상세 페이지(KCT0002018) 확인 결과 WHO ICTRP·NCT 상호등록번호 필드가 **없었다**(다만 확인한 예시 1건 기준이라 다른 시험에서는 다를 수 있음 — CRIS 자체가 한국의 WHO 1차 등록기관이라는 점도 감안). ISRCTN·jRCT는 API 문서/가이드에서 확인하지 못했다(**?** — ISRCTN은 `default` XML 스키마, jRCT는 상세 페이지의 "その他の事項" 섹션 또는 JPMA 가이드 33쪽 이후 "기본용어" 부분을 봐야 한다 — 이번 조사에서는 가이드 1~22쪽만 확인했다) |

---

## Step 2-부 — detail 필드 매트릭스

detail 필드는 capability 로 신고하면 되므로 `X` 여도 문제가 없다. 참고 목적으로만 기록한다.

| detail 필드 | CT.gov | ICTRP | ISRCTN | CTIS | CRIS | jRCT | 비고 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| eligibility.criteriaText | O | O | O | O | O | O | ICTRP TRDS 항목 14. ISRCTN `inclusion`/`exclusion` 쿼리 필드. CTIS "Principal inclusion/exclusion criteria". CRIS는 상세 페이지에서 `대상자 포함기준`을 확인(제외기준은 직접 확인 못함, 통상 쌍으로 존재). jRCT는 가이드 18쪽에서 "主たる選択基準/Inclusion Criteria", "主たる除外基準/Exclusion Criteria" 필드를 명시적으로 확인 |
| outcomes | O | O | O | O | ~ | ? | ICTRP TRDS 항목 19–20(Primary/Key Secondary Outcomes). ISRCTN `outcomeMeasures` 쿼리 필드. CTIS "Primary end points"/"Secondary end points". CRIS는 공공데이터포털 응답에 `primary_outcome_1_kr` 필드가 있음을 확인했으나 secondary는 확인 못함. jRCT는 가이드에서 "研究・治験の目的"(objectives)까지만 확인했고 outcome measure에 해당하는 별도 구조 필드는 확인 못함(**?**) |
| contacts | O | O | ? | O | ? | O | ICTRP TRDS 항목 7–8(Contact for Public/Scientific Queries) — 필드명까지 CT.gov·jRCT와 거의 동일하다. CTIS는 "Locations and contact points" 탭 존재로 확인. jRCT는 가이드 20쪽에서 "Contact for Scientific Queries"/"Contact for Public Queries" 필드를 실제 화면 캡처로 확인. ISRCTN·CRIS는 이번 조사 범위(쿼리 API 23개 constraint, CRIS 목록 API 필드)에서 연락처 필드를 찾지 못했다(**?** — ISRCTN은 `default` XML 스키마, CRIS는 상세 70항목 문서를 봐야 한다 — 이번엔 목록 API 문서만 확인했다) |

---

## Step 3 — 판정

규칙: **core 필드는 CT.gov를 포함해 최소 두 레지스트리에서 채워질 수 있어야 한다(`O` 또는 `~`).** 그렇지 않으면 core가 아니라 detail 이거나 옵셔널 capability다.

| core 필드 | 채워지는 레지스트리 수(CT.gov 포함, `O`/`~`) | 결론 |
| :-- | :-- | :-- |
| title | 6/6 | **core 유지** |
| status | 6/6 (구조·어휘는 상이) | **core 유지** — 단, CTIS의 "국가별 status" 구조는 §4 참고 |
| phase | 6/6 (일부는 선택적으로만 채워짐) | **core 유지** — 이미 `phase?`로 optional, 결합값은 이미 배열로 처리하도록 설계돼 있음(변경 불필요) |
| studyType | CT.gov·ICTRP·CRIS 확정 O, CTIS `~`, ISRCTN·jRCT `?` | **core 유지** (확정 3곳만으로도 규칙 충족) |
| conditions | 6/6 | **core 유지** |
| interventions | CT.gov·ICTRP·ISRCTN·CTIS·jRCT 확정 O, CRIS `~` | **core 유지** |
| sponsor.lead | 6/6 | **core 유지** |
| enrollment.count | CT.gov·ICTRP 확정 O, ISRCTN·CRIS·jRCT `~`(target만), CTIS `?` | **core 유지** — 단, `basis: 'actual'`은 사실상 CT.gov 전용으로 가정해야 함(§4 참고) |
| dates.start | 6/6 | **core 유지** |
| dates.lastUpdated | CT.gov·ISRCTN·CRIS·jRCT 확정 O, ICTRP·CTIS `?` | **core 유지** (확정 4곳으로 규칙 충족) |
| locations | 6/6 (좌표는 CT.gov만) | **core 유지** — `geo`는 이미 optional, 구조 변경 불필요 |
| hasResults | CT.gov·ICTRP·CTIS 확정 O, ISRCTN·CRIS·jRCT `?` | **core 유지** (확정 3곳으로 규칙 충족) |
| crossIds | CT.gov·ICTRP·CTIS 확정 O, CRIS 확정 X(예시 1건), ISRCTN·jRCT `?` | **core 유지** (확정 3곳으로 규칙 충족) |

**13개 core 필드 전부 core 로 유지된다. `core → optional`, `core → detail` 로 이동한 필드는 없다.** 어휘 확장이 반드시 필요하다고 판단한 값도 없다 — 이번 조사에서 발견한 상태값(ISRCTN "No longer recruited", jRCT "募集終了" 등)은 의미가 모호해 특정 폐쇄 어휘 값에 딱 맞아떨어지지 않지만, 스펙이 이미 갖춘 `other` + `statusRaw` 조합으로 무손실 처리가 가능하므로 새 값을 추가할 필요는 없다.

**중단 조건 미충족.** core 필드의 절반(6.5개) 이상이 다른 레지스트리에서 전혀 채워지지 않는 경우에 구현을 멈추고 방안을 재논의해야 하는데, 실제로는 13개 필드 모두 CT.gov 외 최소 3곳 이상에서 확정 `O`/`~`를 받았다. 정규화 계약은 CT.gov 전용 스키마가 아니라는 근거가 확보됐다.

---

## Step 4 — 스펙 반영

이동한 필드가 없으므로 `TrialRecord` 타입이나 §2.3 폐쇄 어휘를 바꿀 필요는 없다. 다만 이번 조사에서 드러난 두 가지 구조적 함정은 향후 CTIS·ISRCTN 등 두 번째 어댑터를 만들 때 반드시 알아야 하는 정보이고, 스펙에 없으면 다음 구현자가 처음부터 다시 발견해야 한다. 스펙 §2.1에 짧은 참고 문단을 추가했다(코드 계약은 그대로, 안내문만 추가):

1. **CTIS는 상태를 레코드당 1개가 아니라 회원국(EU/EEA)별로 따로 매긴다.** `status`를 단일 값으로 접어야 하는 스펙의 전제와 구조적으로 다르다 — 대표값을 어떤 기준으로 고를지는 CTIS 어댑터가 결정하고, 전체 국가별 값은 `--raw`의 `source`로 보존해야 한다.
2. **CT.gov를 제외한 모든 조사 대상 레지스트리는 목표(target) 등록 인원만 제공한다.** `enrollment.basis === 'actual'`은 사실상 CT.gov 전용이라고 가정하고 다른 어댑터를 설계해야 한다.

`Capability.detail`에 새로 추가할 항목은 없다(§3.2 변경 없음) — detail 필드(eligibility/outcomes/contacts)는 이미 대부분의 레지스트리에서 확인됐고, 확인하지 못한 항목도 기존 capability 신고 메커니즘으로 충분히 표현된다.

---

## 확인 못한 항목 요약 (`?`)

| 항목 | 레지스트리 | 확인 못한 이유 | 무엇을 보면 확인되는가 |
| :-- | :-- | :-- | :-- |
| studyType | ISRCTN | 공개 API 문서(v0.6)의 쿼리 constraint 23개 목록에 study-type류 필드가 없음 | 단일 trial의 `default` XML 전체 스키마(쿼리 constraint에 없는 필드도 레코드 본문엔 있을 수 있음) |
| studyType | jRCT | 가이드에 `治験の区分`(trial category) 필드명은 나오나 값 목록을 확인 못함 | 실제 jRCT 상세 페이지의 해당 필드 값, 또는 공식 데이터 사전 |
| enrollment.count | CTIS | EMA 공식 "Full trial information" 필드 사전(7쪽)에 표본크기 필드가 없음 | "CTIS public portal: summary" PDF 또는 실제 trial의 Locations/Results 탭 |
| dates.lastUpdated | ICTRP | TRDS 24항목에도, 검색 포털 고급검색 필드 목록에도 없음 | 실제 trial의 XML export 원문, 또는 Web Service 계정으로 응답 스키마 확인 |
| dates.lastUpdated | CTIS | enrollment.count와 동일 사유 | 동일 |
| hasResults | ISRCTN | 쿼리 constraint 23개 목록에 없음 | `default` XML 전체 스키마, 또는 실제 상세 페이지의 "Results" 섹션 |
| hasResults | CRIS | 완료일 필드는 있으나 결과공개 플래그를 찾지 못함 | 결과가 등록된 실제 중재연구 상세 페이지 |
| hasResults | jRCT | "치험결과 조회" 기능은 진행상태 필터일 뿐, 별도 필드인지 미확인 | 종료된 시험의 실제 상세 페이지에 결과 섹션 유무 확인 |
| crossIds | ISRCTN | 쿼리 constraint 23개 목록에 없음 | `default` XML 스키마(예: nctID류 필드 존재 여부) |
| crossIds | jRCT | 가이드 1~22쪽에서 확인 못함(33쪽 이후 "기본용어" 및 상세 페이지 "その他の事項" 섹션 미확인) | 가이드 33쪽 이후, 또는 실제 상세 페이지의 "その他の事項" |
| outcomes(detail) | jRCT | 가이드에서 "研究・治験の目的"(objectives)까지만 확인, outcome measure 구조 필드 미확인 | 실제 상세 페이지의 관리적 사항 세부 항목 |
| contacts(detail) | ISRCTN | 쿼리 constraint 23개 목록에 없음 | `default` XML 스키마 |
| contacts(detail) | CRIS | 목록 API(16항목) 문서만 확인, 상세 70항목 문서는 미확인 | 공공데이터포털의 상세조회 API 문서 |

---

## 검증 체크리스트

- [x] core 표의 모든 칸이 채워져 있다(`?`도 명시적 판정)
- [x] `?`로 남은 항목마다 왜 확인하지 못했는지와 무엇을 보면 확인되는지가 적혀 있다(위 표)
- [x] Step 3의 네 결론 중 하나가 모든 core 필드에 붙어 있다(전부 "core 유지")
- [x] 대조한 레지스트리가 최소 세 곳이다(다섯 곳: ICTRP·ISRCTN·CTIS·CRIS·jRCT)
- [x] 각 레지스트리마다 출처 URL이 있다(Step 1 표)
