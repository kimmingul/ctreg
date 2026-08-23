# 레지스트리 필드 교차 검증 (2026-08-22)

**Task 0 — 계약 사전 검증(게이트).** 정규화 계약(`TrialRecord`)을 ClinicalTrials.gov(이하 CT.gov)만 보고 설계하면 이름만 페더레이션인 "충실한 어댑터(A안)"가 되고, 두 번째 레지스트리를 붙이는 날 위층이 전부 바뀐다. 이 문서는 스펙 §2.2 의 `TrialRecord` core 필드를 CT.gov 이외 다섯 개 레지스트리와 대조해, core/detail 경계와 폐쇄 어휘가 실제로 여러 레지스트리에서 성립하는지 검증한다. 코드는 쓰지 않는다.

대조 대상은 WHO ICTRP(집계 상위 레지스트리, 필수), ISRCTN, EU CTIS, CRIS(한국), jRCT(일본) 다섯 곳이다. 최소 요구(3곳)를 넘겨 대조했다.

## 방법과 한계

- 각 레지스트리의 공식 문서(API 문서, 필드 사전, 규제기관 발간 가이드)와 실제 검색/상세 페이지를 WebFetch/WebSearch 로 열람해 필드 존재 여부를 확인했다.
- 확인하지 못한 값은 `?` 로 남기고, 왜 확인하지 못했는지와 무엇을 보면 확인되는지를 각주로 적었다. 추정으로 채우지 않았다.
- CT.gov 열은 이미 스펙 §7(`ctgov` 어댑터, CT.gov API v2 기준)이 확정한 내용이므로 전부 `O` 로 둔다.
- **`X`와 `~`를 가르는 기준.** 스키마(필수 데이터셋 또는 문서화된 필드 목록) 자체에 해당 개념이 들어갈 자리가 아예 없으면 `X`다. 자리는 있는데(문서에 필드로 명시되어 있는데) 값의 의미·구조가 CT.gov와 다르거나, 필수는 아니고 원 데이터 제공자가 채웠을 때만 조건부로 나타나는 부가 필드면 `~`다 — "필드가 없다"와 "필드는 있지만 항상 채워진다는 보장이 없다"는 서로 다른 판정이라 기호도 다르게 쓴다. 이 기준이 가장 뚜렷하게 걸리는 자리가 아래 phase/ICTRP 행이다: WHO TRDS(필수 최소 데이터셋) 24개 항목에는 phase가 없지만, 그 밖의 검색 포털 고급검색에는 phase 필터가 존재한다 — "TRDS라는 스키마엔 자리가 없다"가 아니라 "조건부 부가 필드로는 있다"는 뜻이므로 `X`가 아니라 `~`로 판정한다.

---

## Step 1 — 레지스트리별 접근성

| 레지스트리 | 공개 API 유무 | 인증 요구 | 필드 목록 출처 URL |
| :-- | :-- | :-- | :-- |
| **WHO ICTRP** | 혼합 — 웹 검색 결과의 **XML 다운로드는 공개**(로그인 불요). 실시간 재사용이 가능한 **"ICTRP Search Portal Web Service"**는 별도 신청 계정이 필요하고, 대량 수집용 "Crawling Service"는 아이디/비밀번호 발급이 전제다. | 검색·XML 내려받기: 불요. Web Service/Crawling: 요구(`ictrpinfo@who.int` 신청) | [WHO Trial Registration Data Set (TRDS) v1.3.1](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set) · [검색 팁(고급검색 필드)](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/search-tips) · [Web Service 안내](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/ictrp-search-portal-web-service) |
| **ISRCTN** | **REST(XML) API 공개.** 4가지 출력 포맷(default/who/ukctg/internal, internal은 deprecated) | **불요** — API 키 없이 공개 사용, 단 대량 조회 시 스로틀링을 지켜달라는 안내만 있음 | [67 Bricks ISRCTN API 문서 v0.6](https://www.isrctn.com/editorial/retrieveFile/81786542-9920-48a0-8fce-09f8428ab843/37855) · 실제 레코드 확인용으로 직접 호출: `https://www.isrctn.com/api/query/format/default?q=96189403&limit=1`(ISRCTN96189403) |
| **EU CTIS** | **화면(공개 포털)만 확인함.** EMA가 공식 REST API를 문서로 공개한 것을 찾지 못했다 — 서드파티 스크레이퍼(Apify 등)만 존재. | 포털 열람 자체는 불요(회원가입 없이 조회 가능) | [CTIS public portal: Full trial information (EMA/441147/2024, 2025-01-27)](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-full-trial-information_en.pdf) · [CTIS public portal: summary (EMA/441149/2024, 2024-09-20)](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-summary_en.pdf) · 포털: `https://euclinicaltrials.eu` |
| **CRIS (한국)** | **공공데이터포털(data.go.kr) 경유 Open API 공개**(REST, XML/JSON 선택). CRIS 자체 소개에 따르면 목록 16항목·상세 70항목·통계 18항목을 제공한다. | **요구** — `serviceKey`(공공데이터포털 발급 인증키) | [공공데이터포털 — 질병관리청 임상연구 DB Open API](https://www.data.go.kr/data/3033869/openapi.do) · 실제 서비스: `https://cris.nih.go.kr` |
| **jRCT (일본)** | **공개 API를 찾지 못함** — 화면(웹 검색·상세페이지)만 확인. 일본제약공업협회(JPMA) 열람 가이드에도 API 언급이 없다. | 열람 자체는 불요(로그인 없이 조회) | [JPMA "治験の探し方〜jRCTのみかた〜"(2025-04, jRCT 필드 열람 가이드)](https://www.jpma.or.jp/information/evaluation/results/message/CL_202303_jRCT_mikata.pdf) · 사이트: `https://jrct.mhlw.go.jp/`(2025년 3월 `jrct.niph.go.jp`에서 이전) |

---

## Step 2 — core 필드 매트릭스

판정 기호: `O` 동등한 필드가 있음 · `~` 있으나 의미·단위·어휘가 다름 · `X` 없음(확인됨) · `?` 확인 못 함

| core 필드 | CT.gov | ICTRP | ISRCTN | CTIS | CRIS | jRCT | 비고 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| title | O | O | O | O | O | O | ICTRP·CTIS·CRIS·jRCT 전부 "공식 제목/평이한 제목" 이중 구조를 가진다(스펙의 `title`/`officialTitle`과 그대로 대응) |
| status | O | O | ~ | ~ | ~ | ~ | 매핑 가능하나 구조가 다르다. ISRCTN은 `trialStatus`(Ongoing/Completed/Stopped/Suspended/Enrolling by invitation)와 `recruitmentStatus`(Not yet recruiting/Recruiting/No longer recruited/…) 두 필드가 따로 있다. **CTIS는 트라이얼 하나에 회원국(EU/EEA)별로 다른 recruitment status가 붙는다** — 출처: [CTIS public portal: summary](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-summary_en.pdf)(EMA/441149/2024, 2024-09-20) 4/6쪽 "Member State" 섹션의 "Current status" 필드 정의 — "The present stage of the clinical trial **in each member state**. Statuses can be: Authorised, recruitment pending / Authorised, recruiting / Ongoing, recruiting / Ongoing, recruitment ended / Temporarily halted / Suspended / Ended / Revoked / Not authorised / Expired." 10개 상태값이 트라이얼 전체가 아니라 회원국 하나하나에 붙는다 — "레코드당 값 1개"라는 스펙의 전제와 구조적으로 다르다(아래 판정 참고). jRCT는 5단계(募集前/募集中/募集中断/募集終了/研究終了)로 CT.gov보다 세분화되어 있다. CRIS는 `전체연구모집현황`(모집중 등) |
| phase | O | ~ | ~ | ~ | ~ | ~ | **ICTRP는 TRDS(24개 필수항목)에는 phase가 없지만, 검색 포털 고급검색에는 phase 필터가 있다** — 위 "방법과 한계"의 X/~ 기준대로, "스키마에 자리가 아예 없다(X)"가 아니라 "필수는 아니지만 조건부 부가 필드로 존재한다(~)"에 해당한다. 원 레지스트리가 phase를 제출했을 때만 채워지므로 채움 여부가 CT.gov만큼 보장되지는 않는다. ISRCTN·CTIS는 결합값("Phase I/II", "integrated I/II")을 단일 문자열로 준다 — 스펙이 이미 배열로 무손실 보존하도록 설계되어 있어(§2.3) 대응 가능. CRIS는 관찰연구에서 `해당사항없음`(N/A)으로 채워진다 |
| studyType | O | O | O | ~ | O | ? | ICTRP TRDS 항목 15(Study Type)로 명시. CRIS는 `중재연구`/`관찰연구`로 CT.gov의 interventional/observational과 직접 대응. **ISRCTN은 실제 trial의 `default` XML을 직접 열어 확인했다** — 출처: `https://www.isrctn.com/api/query/format/default?q=96189403&limit=1`(ISRCTN96189403). `<primaryStudyDesign>Interventional</primaryStudyDesign>` 요소가 존재해 CT.gov의 interventional/observational 개념과 직접 대응한다(다만 이번에 연 예시 1건은 값이 "Interventional"이었다 — "Observational"이 실제로 나오는 사례는 확인 못함, ISRCTN이 RCT 중심 등록기관이라는 점과 일치). CTIS는 "의약품 임상시험만 대상, 관찰연구는 범위 밖"이라고 명시되어 있어 사실상 항상 interventional(값은 있으나 range가 CT.gov와 다르다는 의미로 `~`). jRCT는 JPMA 가이드 **15쪽** "治験の内容確認：概要" 화면 캡처에서 `治験の区分`(trial category) 필드명 자체는 확인했으나(각주에 "용어 설명은 33쪽 이후 「기본용어」 참조"라고만 되어 있다), 정확한 값 목록(중재/관찰 구분인지 다른 분류 체계인지)은 확인하지 못했다(**?** — 아래 "확인 못한 항목 요약" 표에도 동일하게 기재) |
| conditions | O | O | O | O | O | O | 전부 자유 텍스트 원문 그대로 — 스펙 원칙(§2.1, "질환명은 정규화하지 않는다")과 정확히 맞는다 |
| interventions | O | O | O | O | ~ | O | CRIS 상세 페이지 확인 결과 개입 관련 필드는 존재하나(연구대상 상태/질환 근처) 구조화된 `type` 구분이 있는지는 확인 못함 — 확인하려면 중재연구(관찰연구 아님) 실제 상세 페이지를 열어야 한다(이번에 연 예시는 관찰연구였다) |
| sponsor.lead | O | O | O | O | O | O | 전부 존재. jRCT는 "依頼者等に関する事項"(의뢰자 등에 관한 사항) 섹션으로 별도 관리 |
| enrollment.count | O | O | ~ | ? | ~ | ~ | **ISRCTN·CRIS·jRCT 세 곳은 확인 결과 목표(target) 등록 인원만 노출하고, 실제(actual) 등록 인원을 별도 필드로 구분하지 않는다** — ISRCTN "Target number of participants"(실제 trial 페이지에서 확인), CRIS `목표대상자 수`(상세 페이지에서 확인, 실제값 필드는 못 찾음), jRCT `実施予定被験者数/Sample Size`(가이드에서 확인, "予定"=예정치). **ICTRP는 다르게 취급해야 한다 — target-only라고 단정할 근거가 없다.** WHO TRDS 항목 17의 공식 명칭은 "Sample Size"가 아니라 **"Target & final sample size"**다(목표치와 최종치를 항목명 자체에 함께 명시) — 개별 trial 레코드에서 "final"(실제) 값이 실제로 채워지는지는 이번 조사에서 확인하지 못했다(**?**, "확인 못한 항목 요약" 표에 추가). CTIS는 EMA 공식 필드 사전 두 건(Full trial information 7쪽, summary 6쪽) 어디에도 표본크기 필드가 없었다(**?** — 실제 trial 페이지의 Locations/Results 탭을 봐야 한다) |
| dates.start | O | O | O | O | O | O | ICTRP는 TRDS 항목 16 "Date of First Enrollment"로 대응(스펙의 `dates.start`와 개념이 거의 같다). ISRCTN `overallStartDate`, CTIS "Trial start date", CRIS `첫 연구대상자 등록일`, jRCT `実施期間(開始日)` 전부 확인 |
| dates.lastUpdated | O | ? | O | ~ | O | O | ISRCTN `lastEdited`(dateTime, range 쿼리 가능) 확인. CRIS `date_updated` 필드가 공공데이터포털 API 응답에 존재함을 확인. jRCT `最終公表日`(가이드에 "최후에 갱신된 날"로 명시) 확인. ICTRP는 TRDS 24항목에도, 검색 포털 고급검색 필드 목록에도 "최종 갱신일"이 없다(**?** — 확인하려면 실제 trial 하나를 XML로 내려받아 레코드 안에 타임스탬프가 있는지, 또는 Web Service 계정을 발급받아 응답 스키마를 봐야 한다). **CTIS는 필드 자체는 있다** — 출처: [CTIS public portal: summary](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-summary_en.pdf)(EMA/441149/2024) 4/6쪽, "Last update: The most recent date when information about the clinical trial was updated." 다만 이 정의가 놓인 위치가 "Current status"·"Start date"("in a Member State")·"End (or early termination)"("in the relevant Member State")처럼 명시적으로 회원국별이라고 적힌 항목들과 같은 "Member State" 표 블록 안이고 그 사이에 새 섹션 헤더가 없다 — **"Last update"도 회원국별일 가능성이 높지만, 그 정의 문장 자체에는 "in each member state" 같은 명시적 문구가 없어서(Current status·Start date와 달리) 단정하지 못한다.** 그래서 O가 아니라 `~`로 둔다(status와 같은 구조적 문제를 가질 가능성 — §4 참고) |
| locations | O | ~ | ~ | ~ | ~ | ~ | **좌표(`geo`)를 제공하는 곳은 CT.gov뿐이다.** ICTRP·ISRCTN은 TRDS/API 문서 모두 "국가" 단위까지만 필드가 있다(도시·기관명 없음 — ISRCTN `recruitmentCountry`는 국가 리스트 range 필드다). CTIS는 별도 "Locations and contact points" 탭이 있으나(사이트 안내에서 탭 존재만 확인) 좌표 제공 여부는 확인 못함. CRIS는 `참여기관`(기관명, 도시 수준 주소는 있을 수 있으나 좌표는 없음), jRCT는 `実施医療機関`(기관명+주소, 좌표 없음) |
| hasResults | O | O | O | O | ? | ? | ICTRP는 TRDS 항목 23 "Summary Results"와 검색 포털의 "Results" 필터로 이중 확인됨. CTIS는 포털 탭 구성 자체에 "Trial Results" 탭이 별도로 있어 결과 유무를 판별할 수 있다. **ISRCTN은 실제 trial의 `default` XML(ISRCTN96189403, 위 studyType 행과 동일 출처)에서 확인했다** — 최상위에 `<results>` 섹션이 통째로 있고 그 안에 `<publicationDetails>`(관련 논문 링크 3건), `<basicReport>`(첨부 PDF), `<ipdSharingStatement>`, `<dataPolicies>`가 들어 있다. 구조화된 결과 섹션의 존재 자체가 결과 유무 판별 기준이 될 수 있다. CRIS는 `연구종료일`류 날짜 필드는 있으나 결과 공개 여부 플래그는 찾지 못했다(**?** — 실제로 결과가 등록된 중재연구의 상세 페이지를 열어 "연구결과" 항목이 있는지 확인해야 한다). jRCT는 "jRCT에서 치험결과 조회" 기능이 있으나 이는 진행상태(研究終了) 필터일 뿐 결과 데이터 유무를 나타내는 별도 필드인지는 확인 못했다(**?** — 실제 종료된 시험의 상세 페이지에 결과 섹션이 있는지 봐야 한다) |
| crossIds | O | O | O | O | X | ? | **ICTRP TRDS 항목 3 "Secondary Identifying Numbers"가 사실상 crossIds 그 자체다** — WHO가 이 필드를 필수 24항목에 넣은 이유가 바로 중복 등록 추적이다. CTIS는 EMA 공식 필드 사전에 "ClinicalTrials.gov identifier (NCT number)", "ISRCTN number", "Additional registries"가 명시적으로 나열되어 있어 가장 확실하다. **ISRCTN은 실제 trial의 `default` XML(ISRCTN96189403, 위 studyType 행과 동일 출처)에서 확인했다** — `<externalRefs>` 섹션에 `<doi>`, `<protocolSerialNumber>`, `<clinicalTrialsGovNumber/>`, `<eudraCTNumber/>` 요소가 있다. 스키마 자체에 NCT/EudraCT 상호등록 슬롯이 있다는 게 확인됐다는 뜻이다(다만 이번 예시에서는 두 요소 다 비어 있었다 — 슬롯의 존재와 실제 값이 채워지는 빈도는 별개다). CRIS는 실제 상세 페이지(KCT0002018, **관찰연구 1건**) 확인 결과 WHO ICTRP·NCT 상호등록번호 필드가 **없었다** — 단 **이 X 판정은 근거가 약하다**: 확인한 표본이 1건뿐이고, 그마저 해외 이중등록 유인이 상대적으로 적은 국내 관찰연구다(해외 다기관이 참여하는 국내 중재연구라면 다를 수 있음). CRIS 자체가 한국의 WHO 1차 등록기관이라는 점도 감안해야 한다. jRCT는 API 문서/가이드에서 확인하지 못했다(**?** — 상세 페이지의 "その他の事項" 섹션 또는 JPMA 가이드 33쪽 이후 "기본용어" 부분을 봐야 한다 — 이번 조사에서는 가이드 1~22쪽만 확인했다) |

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
| phase | 6/6 — ICTRP는 TRDS 필수항목엔 없지만 검색 포털에 조건부 필터로 존재해 `~`(위 "방법과 한계"의 X/~ 기준 참고), 나머지도 `O`/`~` | **core 유지** — 이미 `phase?`로 optional, 결합값은 이미 배열로 처리하도록 설계돼 있음(변경 불필요) |
| studyType | CT.gov·ICTRP·ISRCTN·CRIS 확정 O(ISRCTN은 `default` XML로 재확인), CTIS `~`, jRCT `?` | **core 유지** (확정 4곳으로 규칙 충족) |
| conditions | 6/6 | **core 유지** |
| interventions | CT.gov·ICTRP·ISRCTN·CTIS·jRCT 확정 O, CRIS `~` | **core 유지** |
| sponsor.lead | 6/6 | **core 유지** |
| enrollment.count | CT.gov·ICTRP 확정 O, ISRCTN·CRIS·jRCT `~`(target만 확인됨), CTIS `?` | **core 유지** — 단, `basis: 'actual'`을 채울 수 없다고 확정할 수 있는 곳은 ISRCTN·CRIS·jRCT 세 곳뿐이다. ICTRP는 TRDS 항목명이 "Target & final sample size"라 실제치를 포함할 가능성이 있으나 개별 레코드에서 채워지는지 미확인 — CT.gov 전용이라고 단정하지 않는다(§4 참고) |
| dates.start | 6/6 | **core 유지** |
| dates.lastUpdated | CT.gov·ISRCTN·CRIS·jRCT 확정 O, CTIS `~`(필드는 있으나 회원국별 스코프일 가능성 — 확정은 아님), ICTRP `?` | **core 유지** (확정 4곳으로 규칙 충족) |
| locations | 6/6 (좌표는 CT.gov만) | **core 유지** — `geo`는 이미 optional, 구조 변경 불필요 |
| hasResults | CT.gov·ICTRP·CTIS·ISRCTN 확정 O(ISRCTN은 `default` XML의 `<results>` 섹션으로 재확인), CRIS·jRCT `?` | **core 유지** (확정 4곳으로 규칙 충족) |
| crossIds | CT.gov·ICTRP·CTIS·ISRCTN 확정 O(ISRCTN은 `default` XML의 `<externalRefs>` 섹션으로 재확인 — 슬롯은 있으나 이번 예시에서는 비어 있었음), CRIS `X`(**근거 약함** — 관찰연구 표본 1건에서만 확인, 매트릭스 각주 참고), jRCT `?` | **core 유지** (확정 4곳으로 규칙 충족 — CRIS의 X 판정 강도와 무관하게 결론은 바뀌지 않는다) |

**13개 core 필드 전부 core 로 유지된다. `core → optional`, `core → detail` 로 이동한 필드는 없다.** 어휘 확장이 반드시 필요하다고 판단한 값도 없다 — 이번 조사에서 발견한 상태값(ISRCTN "No longer recruited", jRCT "募集終了" 등)은 의미가 모호해 특정 폐쇄 어휘 값에 딱 맞아떨어지지 않지만, 스펙이 이미 갖춘 `other` + `statusRaw` 조합으로 무손실 처리가 가능하므로 새 값을 추가할 필요는 없다.

**중단 조건 미충족.** core 필드의 절반(6.5개) 이상이 다른 레지스트리에서 전혀 채워지지 않는 경우에 구현을 멈추고 방안을 재논의해야 하는데, 실제로는 13개 필드 모두 CT.gov 외 최소 3곳 이상에서 확정 `O`/`~`를 받았다. 정규화 계약은 CT.gov 전용 스키마가 아니라는 근거가 확보됐다.

---

## Step 4 — 스펙 반영

이동한 필드가 없으므로 `TrialRecord` 타입이나 §2.3 폐쇄 어휘를 바꿀 필요는 없다. 다만 이번 조사에서 드러난 두 가지 구조적 함정은 향후 CTIS·ISRCTN 등 두 번째 어댑터를 만들 때 반드시 알아야 하는 정보이고, 스펙에 없으면 다음 구현자가 처음부터 다시 발견해야 한다. 스펙 §2.1에 짧은 참고 문단을 추가했다(코드 계약은 그대로, 안내문만 추가):

1. **CTIS는 상태를 레코드당 1개가 아니라 회원국(EU/EEA)별로 따로 매긴다.** 출처: [CTIS public portal: summary](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-summary_en.pdf)(EMA/441149/2024, 2024-09-20) 4/6쪽 "Member State" 섹션의 "Current status" 필드 정의(위 Step 2 표에 원문 인용). `status`를 단일 값으로 접어야 하는 스펙의 전제와 구조적으로 다르다 — 대표값을 어떤 기준으로 고를지는 CTIS 어댑터가 결정하고, 전체 국가별 값은 `--raw`의 `source`로 보존해야 한다. **같은 표 블록에 `dates.lastUpdated`에 대응하는 "Last update" 필드도 있다**(위 dates.lastUpdated 행 참고) — 회원국별일 가능성이 높지만 정의 문장 자체엔 그 문구가 없어 단정하지 않았다. CTIS 어댑터를 만들 때 실물 페이지에서 먼저 확인해야 한다.
2. **ISRCTN·CRIS·jRCT 세 곳은 목표(target) 등록 인원만 제공한다는 것이 확인됐다.** 이 세 곳을 위한 어댑터는 `enrollment.basis === 'actual'`을 채울 수 없다고 가정해야 한다. **ICTRP는 target-only로 단정하지 않는다** — WHO TRDS 항목 17의 공식 명칭이 "Target & final sample size"라 실제(최종)치도 포함할 가능성이 있으나 개별 레코드에서 채워지는지 미확인이다(위 "확인 못한 항목 요약" 표 참고). CTIS도 표본크기 필드 자체를 찾지 못해 미확정이다.

`Capability.detail`에 새로 추가할 항목은 없다(§3.2 변경 없음) — detail 필드(eligibility/outcomes/contacts)는 이미 대부분의 레지스트리에서 확인됐고, 확인하지 못한 항목도 기존 capability 신고 메커니즘으로 충분히 표현된다.

---

## 확인 못한 항목 요약 (`?`)

| 항목 | 레지스트리 | 확인 못한 이유 | 무엇을 보면 확인되는가 |
| :-- | :-- | :-- | :-- |
| studyType | jRCT | JPMA 가이드 15쪽에서 `治験の区分`(trial category) 필드명은 확인했으나(용어 설명은 33쪽 이후로 미루고 있음) 값 목록을 확인 못함 | 실제 jRCT 상세 페이지의 해당 필드 값, 또는 공식 데이터 사전(가이드 33쪽 이후 "기본용어") |
| enrollment.count(실제치 여부) | ICTRP | WHO TRDS 항목 17의 공식 명칭이 **"Target & final sample size"**라 목표치와 실제치를 함께 가리킬 수 있으나, 개별 trial 레코드에서 "final" 값이 실제로 채워지는지는 확인하지 못함 | 실제 ICTRP trial의 XML export(검색 결과를 XML로 내려받기)를 열어 final sample size 요소가 값을 갖고 있는지 확인. 다음 라운드로 미룬다 — 지금 당장 결론을 낼 필요는 없다 |
| enrollment.count | CTIS | EMA 공식 필드 사전 두 건(Full trial information 7쪽, summary 6쪽) 어디에도 표본크기 필드가 없음 | 실제 trial 페이지의 Locations/Results 탭(두 공식 PDF에는 없다는 게 이번에 확인된 사실이라, 남은 후보는 화면 자체뿐) |
| dates.lastUpdated | ICTRP | TRDS 24항목에도, 검색 포털 고급검색 필드 목록에도 없음 | 실제 trial의 XML export 원문, 또는 Web Service 계정으로 응답 스키마 확인 |
| dates.lastUpdated(회원국별 여부) | CTIS | "Last update" 정의 문장 자체에는 회원국별 문구가 없으나 같은 "Member State" 블록 안에 있고, 블록의 다른 필드는 모두 회원국별임이 명시됨 | 실제 CTIS trial 페이지에서 Last update 가 트라이얼당 1개인지 회원국당 1개인지 확인 |
| hasResults | CRIS | 완료일 필드는 있으나 결과공개 플래그를 찾지 못함 | 결과가 등록된 실제 중재연구 상세 페이지 |
| hasResults | jRCT | "치험결과 조회" 기능은 진행상태 필터일 뿐, 별도 필드인지 미확인 | 종료된 시험의 실제 상세 페이지에 결과 섹션 유무 확인 |
| crossIds | jRCT | 가이드 1~22쪽에서 확인 못함(33쪽 이후 "기본용어" 및 상세 페이지 "その他の事項" 섹션 미확인) | 가이드 33쪽 이후, 또는 실제 상세 페이지의 "その他の事項" |
| outcomes(detail) | jRCT | 가이드에서 "研究・治験の目的"(objectives)까지만 확인, outcome measure 구조 필드 미확인 | 실제 상세 페이지의 관리적 사항 세부 항목 |
| contacts(detail) | ISRCTN | `default` XML 응답에서 top-level 요소로 `contact`가 보이긴 했으나(위 hasResults/crossIds 행에서 인용한 XML 요소 목록 참고), 그 안의 세부 필드(이름/역할/이메일 등 CT.gov `contacts`와 대응되는 하위 구조)까지는 이번 조사에서 열어보지 않았다 | 같은 `default` XML 응답에서 `<contact>` 요소 내부를 펼쳐 하위 필드 확인 |
| contacts(detail) | CRIS | 목록 API(16항목) 문서만 확인, 상세 70항목 문서는 미확인 | 공공데이터포털의 상세조회 API 문서 |

---

## 검증 체크리스트

- [x] core 표의 모든 칸이 채워져 있다(`?`도 명시적 판정)
- [x] `?`로 남은 항목마다 왜 확인하지 못했는지와 무엇을 보면 확인되는지가 적혀 있다(위 표)
- [x] Step 3의 네 결론 중 하나가 모든 core 필드에 붙어 있다(전부 "core 유지")
- [x] 대조한 레지스트리가 최소 세 곳이다(다섯 곳: ICTRP·ISRCTN·CTIS·CRIS·jRCT)
- [x] 각 레지스트리마다 출처 URL이 있다(Step 1 표)


## 정정 — ISRCTN 의 실제 등록 인원 (2026-08-22, 어댑터 #2 준비 중 실측)

위 표에서 `enrollment.count` 를 ISRCTN `~` 로 적고 **"목표 등록 인원만 노출하고 실제 등록
인원을 별도 필드로 구분하지 않는다"**고 썼다. **틀렸다.**

실측(`https://www.isrctn.com/api/query/format/default?q=condition:cancer&limit=5`):
모든 레코드에 `<targetEnrolment>` 와 **`<totalFinalEnrolment>` 가 함께** 있다.

| ISRCTN | target | final |
| :-- | --: | --: |
| 13423698 | 40 | **0** |
| 13555554 | 42 | **0** |
| 14565637 | 85 | **0** |
| 16053507 | 1000 | **231** |
| 14443970 | 57 | **0** |

**그러나 이것이 더 중요하다: `0` 은 "0명 등록"이 아니라 "아직 모름"이다.**
완료된 시험(16053507)만 실제 값을 갖고, 진행 중인 시험은 전부 `0` 이다.

**어댑터 #2 의 설계 제약**: `totalFinalEnrolment: 0` 을 `enrollment: { count: 0, type: 'actual' }`
로 매핑하면 **모집 중인 시험을 "0명 등록"으로 보고한다.** 이것이 이 프로젝트가 처음부터
막으려 한 형태 — 실패가 성공처럼 보이는 것 — 의 정확한 사례다. 스펙 §2 의 absent-means-absent
가 여기 적용된다: **`0` 이면 필드를 생략한다.** 0 을 실제 값으로 싣는 것은
`totalFinalEnrolment > 0` 일 때만이다.

(어느 값이 진짜 0 인 시험 — 등록 전 중단 등 — 을 ISRCTN 이 어떻게 표기하는지는 확인하지
못했다. 확인 전까지는 `0` 을 부재로 다루는 쪽이 안전하다. 없는 값을 0 으로 보고하는 오류가
있는 값을 생략하는 오류보다 임상적으로 위험하다.)

## ISRCTN 검색 축 — 미확인 (어댑터 #2 착수 전 반드시 확인)

실측으로 **작동 확인**: `condition:`(diabetes 1118) · `intervention:`(aspirin 145) ·
`sponsor:`(NHS 4). `<allTrials totalCount="N">` 로 총계가 오므로 **count 축은 지원된다.**

실측으로 **0건이 나온 것**: `location:` · `trialStatus:` · `recruitmentStatus:` · `phase:`
— 레코드에 그 요소들이 실제로 있는데도 0 이 나온다. 즉 **질의 필드명이 XML 요소명과 다르거나
값 형식이 다르다.**

### 결정적 실험 — 필드 질의는 진짜지만, 틀린 필드명은 0 을 돌려준다

| 질의 | 결과 |
| :-- | --: |
| `diabetes` (자유 텍스트) | 4308 |
| `condition:diabetes` | **1118** (좁혀진다 — 진짜 필드 질의다) |
| `zzzznonsense:diabetes` | **0** |
| `condition:zzzznonsense` | 0 |

**필드 질의는 실재한다.** 그러나 **모르는 필드명은 자유 텍스트로 떨어지지 않고 0 을 돌려준다.**

**이것이 ISRCTN 어댑터의 가장 위험한 함정이다.** 필드명을 하나 틀리면 모든 질의가 0건을
돌려주고, 그 0 은 "그런 시험이 없다"와 **구별되지 않는다.** exit 0, 경고 없음, 빈 결과 —
이 프로젝트가 처음부터 막으려 한 형태 그 자체다. 그리고 ctgov 에는 이 실패 양식이 없다
(CT.gov API 는 모르는 파라미터에 400 을 낸다).

**실측으로 확인된 필드명**: `condition`(1118) · `intervention`(145) · `sponsor`(4)
**0 을 돌려주는 이름** — 즉 유효하지 않다: `trialStatus` · `recruitmentStatus` · `phase` ·
`location` · `country` · `overallStatus` · `trialPhase` · `recruitmentCountry`
**유효하나 값 어휘가 다른 것**: `status`(`status:Ongoing` → 1건. 필드는 살아 있는데
값 형식이 다르다)

### 어댑터 #2 의 설계 요구 — 여기서 도출된다

1. **필드명을 추측하지 않는다.** API 문서(67 Bricks v0.6)의 질의 필드 목록을 확보한 뒤 선언한다.
2. **계약 스위트에 "알려진 질의가 0 이 아니다" 검사를 넣는다.** 필드명이 틀어지면 조용히
   0 을 돌려주므로, 스위트가 그것을 잡지 못하면 아무도 못 잡는다. 이 저장소의 계약 스위트는
   지금 "경고를 버리는 어댑터"와 "source 를 좁힌 어댑터"를 잡는다 — **"필드명이 틀린 어댑터"는
   못 잡는다.** 어댑터 #2 를 붙일 때 함께 넣어야 할 검사다.
3. **선언하지 못하는 축은 `false` 로 둔다.** `status`·`phase`·`location` 을 지금 아는 것만으로
   `true` 라고 선언하면, 사용자는 "결과 없음"과 "그렇게 검색할 수 없음"을 구분하지 못한다.

**capability 선언을 추측으로 쓰면 안 된다.** `status: true` 라고 선언했는데 실제로는 0건이
나오면, 사용자는 "결과 없음"과 "그렇게 검색할 수 없음"을 구분하지 못한다 — 이 CLI 가
존재하는 이유가 그 구분이다. API 문서(67 Bricks v0.6)의 질의 필드 목록을 확인한 뒤에
선언을 쓴다.


## ISRCTN 질의 필드 — 전수 실측 (2026-08-22, 어댑터 #2 준비)

API 문서(67 Bricks v0.6, `3.2.1.x`)가 정의한 필드를 **하나씩 실제로 쳐서** 확인했다.
문서만 읽고 capability 를 선언하면 안 되는 이유가 이 표에 있다.

### 작동 확인 — 이 축들은 선언해도 된다

| 질의 | 건수 |
| :-- | --: |
| `condition:diabetes` | 1118 |
| `conditionCategory:"Cancer"` | 3001 |
| `intervention:aspirin` | 145 |
| `recruitmentCountry:"United Kingdom"` | 14958 |
| `recruitmentCountry:"Korea, South"` | 206 |
| `phase:"Phase III"` | 911 |
| `phase:"Phase II/III"` | 123 |
| `ageRange:"Adult"` | 17746 |
| `gender:"Female"` | 2970 |
| `sponsorOrganisation:"University of Oxford"` | 659 |
| `funderName:"Wellcome Trust"` | 498 |
| `title:covid` | 325 |
| `outcomeMeasures:mortality` | 1633 |
| `overallStartDate GE 2020-01-01T00:00:00` | 28592 |
| `condition:"lung cancer" AND recruitmentCountry:"Korea, South"` | 3 |

### 문서에 있으나 **작동하지 않는** 것

- **`trialStatus`** — 문서 `3.2.1.1` 이 정의하고 값 목록(Ongoing/Completed/Stopped/Suspended/
  Enrolling by invitation)까지 준다. **다섯 값 전부 0 이다.** 레코드 XML 에는 이 요소가 있다.
- **`recruitmentStatus`** — 문서에 있고 `"Recruiting"`·`"No longer recruiting"` 둘 다 0.

**즉 ISRCTN 에는 `status` 축이 사실상 없다.** ctgov 의 `--status recruiting` 에 해당하는 것을
줄 수 없다. capability 에 `status: false` 로 선언해야 한다 — `true` 로 선언하면 사용자는
"모집 중인 시험이 없다"와 "이 레지스트리는 모집 상태로 검색할 수 없다"를 구분하지 못한다.

### 구문 함정 셋 — 셋 다 조용히 0 을 낸다

1. **따옴표.** `recruitmentCountry:United Kingdom` → 0. `recruitmentCountry:"United Kingdom"` → 14958.
   공백이 있는 값은 반드시 따옴표. `phase:Phase III` → 0, `phase:"Phase III"` → 911.
2. **날짜는 콜론이 아니라 공백.** `overallStartDate:GE 2020-01-01T00:00:00` → 0.
   `overallStartDate GE 2020-01-01T00:00:00` → 28592. 비교 연산자(LT/LE/GT/GE/NE)는 별개 토큰이다.
3. **값 어휘.** `gender:"Both"` → 0, `gender:"Female"` → 2970. 값이 틀려도 0 이다.

### 어댑터 저자에게 — 이것이 핵심이다

**필드명이 틀려도 0, 값이 틀려도 0, 구문이 틀려도 0, 필드가 죽어 있어도 0 이다.**
그리고 그 0 은 "그런 시험이 없다"와 **출력상 구별되지 않는다.** ctgov 에는 이 실패 양식이
없다(CT.gov 는 모르는 파라미터에 400 을 낸다).

따라서 ISRCTN 어댑터는 **자기가 만든 질의가 실제로 무언가를 찾는다는 것을 스스로 증명해야
한다.** 계약 스위트에 "알려진 질의가 0 이 아니다" 검사를 넣는 것이 최소한이고, 축마다
위 표의 실측 건수를 회귀 기준으로 삼을 수 있다(건수는 시간이 지나면 늘어나므로 **0 이 아님**을
기준으로 삼고 정확한 수는 쓰지 않는다).


---

## 정정 2 — `overallStartDate` 는 작동하지 않는다 (2026-08-23, 어댑터 #2 구현 중 실측)

위 「작동 확인」 표에 이렇게 적었다:

| `overallStartDate GE 2020-01-01T00:00:00` | 28592 |

**틀렸다. 28592 는 레지스트리 전체 건수다.** 좁혀진 것이 아니라 아무것도 안 걸러진 것이고,
표를 만들 때 그 수가 전체와 같다는 것을 대조하지 않아 "작동" 으로 판정했다.

| 질의 | 건수 | 판정 |
| :-- | --: | :-- |
| `overallStartDate GE 1990-01-01T00:00:00` | 28592 | |
| `overallStartDate GE 2020-01-01T00:00:00` | 28592 | |
| `overallStartDate GE 2050-01-01T00:00:00` | **28592** | 미래 시작일이 전부일 리 없다 |
| `lastEdited GE 2050-01-01T00:00:00` | 0 | 대조군 — 이쪽은 진짜로 좁힌다 |
| `overallEndDate GE 2050-01-01T00:00:00` | 10 | 대조군 |

결정적 증거는 접속사다:

| 질의 | 건수 |
| :-- | --: |
| `condition:diabetes` | 1118 |
| `condition:diabetes AND overallStartDate GE 2020-01-01T00:00:00` | **1118** |

**깨진 날짜 절은 조용히 버려진다.** 질의 전체가 0 이 되는 것도, 오류가 나는 것도 아니고,
그 절만 사라진 채 나머지가 정상 결과처럼 돌아온다. `recruitmentStart`·`trialStartDate`·
`startDate`·`overallStart` 도 전부 같다.

**이 실패 양식이 0 보다 위험하다.** 0 은 최소한 "뭔가 이상하다" 로 보이지만, 이쪽은
사용자가 요청한 필터가 사라진 **더 넓은** 결과를 필터된 것처럼 배달한다. "2024년 이후
시작한 시험" 을 물으면 1990년 시험이 섞여 나온다.

작동하는 날짜 필드는 셋이다: `lastEdited`(갱신), `overallEndDate`(종료), `dateApplied`(등록 신청).

→ 이 발견 때문에 `Capability.search.dateRange` 를 `updatedRange`/`startRange`/`completionRange`
셋으로 쪼갰다(커밋 `37d3466`). 하나로는 "일부 날짜만 되는" 레지스트리를 표현할 수 없다.

## 정정 3 — 모르는 필드명이 항상 0 을 돌려주는 것은 아니다 (2026-08-23)

위 「결정적 실험」 에 이렇게 적었다: **"모르는 필드명은 자유 텍스트로 떨어지지 않고 0 을
돌려준다."** 값이 **한 단어일 때만** 참이다.

| 질의 | 건수 |
| :-- | --: |
| `zzzznonsense:"London"` | 0 |
| `zzzznonsense:"lung cancer"` | **378** |
| `location:"lung cancer"` | **378** (같다) |
| `location:"Birmingham"` | 0 |

여러 단어를 인용해 넣으면 **모르는 필드 접두사가 떨어져 나가고 그 구절이 자유 텍스트로
검색된다.** 두 줄이 정확히 같은 수인 것이 근거다.

실무적 의미 둘:
1. **죽은 필드가 살아 있는 것처럼 보인다.** `location:"lung cancer"` 가 378건을 내는 것을
   보고 "location 축이 되는구나" 라고 판단하면, 실제로는 장소와 아무 상관 없는 결과를
   장소 필터의 결과로 믿게 된다.
2. **필드 생사를 판정하는 프로브는 한 단어여야 한다.** `scripts/isrctn-field-test.ts` 의
   `DEAD_FIELD_PROBE` 가 이 규칙을 지키고, 0 도 전체도 아닌 수가 나오면 "되살아남" 이
   아니라 **불확정** 으로 기록한다 — 자유 텍스트 누수와 구별할 수 없기 때문이다.

## `who` 포맷 — 조사에서 열어보지 않았다 (2026-08-23)

이 조사는 `default` 포맷만 열었다. 어댑터 #2 를 쓰면서 `who` 포맷을 열어보고 알게 된 것:

| | `default` | `who` |
| :-- | :-- | :-- |
| `totalCount` | **있다** (`limit=0` 이면 80바이트) | 없다 |
| 상태 | **없다** (계산값이라 레코드에 없다) | **있다** (`recruitment_status`) |
| 시작일 | 없다 | **있다** (`date_enrolment`) |
| 종료일 | 있다 | 있다 |
| 장소 | **기관·도시 단위**(`trialCentres`, 최대 21곳 확인) | 국가 단위만 |
| 적격·결과지표·상호등록번호 | 있다(구조가 다름) | 있다 |

**두 포맷 다 반쪽이다.** 그래서 어댑터는 레코드를 `who` 에서, 총계를 `default` 의
`limit=0` 에서 가져온다 — 이유는 `src/adapters/isrctn/map.ts` 의 머리 주석에 적었다.
`ukctg` 포맷은 API 문서에 있으나 실제로는 HTML 오류 페이지를 낸다.
