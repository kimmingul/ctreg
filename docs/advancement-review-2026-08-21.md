# ClinicalTrials.gov MCP 고도화 검토 및 독자 MCP 방향

- **일자:** 2026-08-21
- **대상:** `clinicaltrialsgov-mcp-server` v2.9.1 (`9a18c4d`, Apache-2.0)
- **목적:** 타인 개발 MCP를 읽고, 독자 MCP를 만들기 위한 갭·우선순위·비목표·다음 단계를 고정한다.
- **성격:** 스파이크 결과. 이 문서는 구현 스펙이 아니다. 구현은 별도 승인 후 새 저장소에서 한다.

교차 검토: xllm blind panel `260821052629-oegp`. **codex**·**antigravity** 합의(approve). **ollama:glm5.2:cloud**는 `model 'glm5.2' not found`로 기권.

---

## 1. 전제

이 저장소는 Casey Hand / cyanheads의 프로덕션 MCP다.

- 공개 읽기 전용 ClinicalTrials.gov REST API v2 래퍼.
- 프레임워크: `@cyanheads/mcp-ts-core`.
- 라이선스: Apache-2.0 — 포크·재배포 가능, NOTICE/저작권 유지, 특허 조항 준수.
- 독자 MCP를 만들 때 **이 레포에 기능을 쌓지 않는다.** 여기 코드는 참고 구현이다.

가정 (틀리면 경로가 바뀐다):

1. 목표는 “더 많은 REST 파라미터”가 아니라 **에이전트 워크플로를 더 잘 끝내는 서버**.
2. 쓰기 API는 없다. CT.gov는 읽기 전용.
3. 임상 적격 판정은 레지스트리 문장만으로 확정하지 않는다.

---

## 2. 현재 표면 (이미 잘 된 것)

### Tools (7)

| 이름 | 역할 |
| :--- | :--- |
| `clinicaltrials_search_studies` | 검색. 기본은 compact index, `fields`면 지정 leaf |
| `clinicaltrials_get_study_record` | NCT 단건. 결과 섹션은 카운트로 바운딩 |
| `clinicaltrials_get_study_results` | 완료 시험 결과 추출. `summary` vs full |
| `clinicaltrials_get_field_values` | 필드 값 분포 (`/stats/field/values`) |
| `clinicaltrials_get_field_definitions` | 데이터 모델 트리 (`/studies/metadata`) |
| `clinicaltrials_get_study_count` | `pageSize=0` + `countTotal` |
| `clinicaltrials_find_eligible` | 나이/성별/질환/장소 → recruiting 후보 |

### Resource / Prompt

- `clinicaltrials://{nctId}` — 바운디드 프로토콜 레코드
- `analyze_trial_landscape` — count/search를 여러 번 돌리라는 **프롬프트**, 집계 툴 아님

### 서비스가 실제로 치는 엔드포인트

`src/services/clinical-trials/clinical-trials-service.ts`

- `GET /studies`
- `GET /studies/{nctId}` (JSON만)
- `GET /studies/metadata`
- `GET /stats/field/values`

스로틀 ~1 req/s, 429/5xx 재시도, piece 이름 `normalizeFields`/`normalizeSort`.

설계 문서: `docs/design.md`. API: `docs/api-reference.md` (스펙 시점 2026-03, API 2.0.5).

---

## 3. API v2에 있으나 코드에 없는 것

`src/` grep 기준 미사용:

| 갭 | 종류 |
| :--- | :--- |
| `query.lead`, `query.id`, `query.patient` | 검색 에어리어 |
| `geoDecay` | 거리 감쇠 스코어링 |
| `GET /studies/enums` | 권위 있는 enum + 레거시 매핑 |
| `GET /studies/search-areas` | 에어리어별 필드 가중치·동의어 |
| `GET /version` | `apiVersion`, `dataTimestamp` |
| `GET /stats/size`, `/stats/field/sizes` | 페이로드/배열 크기 분포 |
| `postFilter.*`, `aggFilters`, `filter.synonyms` | 웹 UI 파셋 |
| `format=fhir.json\|ris\|csv\|json.zip` | 단건 내보내기 |
| `includeHistoricOnly` | **메타데이터 필드** 플래그. 과거 프로토콜 버전이 아님 |

`SearchParams` / `buildSearchQuery`는 `query.cond|intr|locn|outc|spons|term|titles`만 매핑.

---

## 4. 코드에서 확인한 에이전트 병목

1. **적격 텍스트 누락.** `find-eligible.tool.ts` `ELIGIBLE_FIELDS`에 `EligibilityCriteria` 없음. 나이/성별/장소만. 바이오마커·선행치료 확인은 NCT마다 `get_study_record` (1초×N).
2. **결과 all-or-nothing.** `get_study_results`의 `summary`는 앞쪽 measure/AE만 자르고, full은 수백 KB. endpoint 이름 필터 없음.
3. **배치 비교 없음.** `get_study_record`는 단건. `getStudiesBatch`는 ResultsSection 고정.
4. **랜드스케이프는 LLM 루프.** 프롬프트가 count를 여러 번 시키지만 스로틀 때문에 느리고, 호출 사이 데이터 시각이 어긋날 수 있음.
5. **enum 값은 정규화 안 함.** 필드명은 고치고 `"Phase 3"` / `"Recruiting"`은 400.

---

## 5. 우선순위 (패널 + 호스트)

호스트 기준. Codex는 landscape 집계를 1순위로 봤고, Antigravity는 결과 필터·적격 텍스트·enums를 앞에 뒀다. 스로틀 때문에 **페이지를 긁는 집계는 뒤로**.

| # | 제안 | MCP 변화 | CT.gov | 노력 | 비고 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 검색 모드 완성 | `leadSponsorQuery`→`query.lead`, `idQuery`→`query.id`, `patientQuery`→`query.patient`; 날짜 `updatedSince` 등 → `AREA[…]RANGE` | 네이티브 query + Essie RANGE | S | 양쪽 합의 |
| 2 | 적격 기준문 옵트인 | `find_eligible`에 `EligibilityCriteria` (캡). **분류기 없음** | `eligibilityModule` | S | AG; Codex는 분류기면 L·안전 이슈 |
| 3 | 결과 서브필터 | outcome 제목 / AE organ·term | `resultsSection` 클라이언트 필터 | S | AG 최우선 |
| 4 | enums 캐시 | `GET /studies/enums` + 값 정규화 | enums | M | 필드 normalize와 대칭 |
| 5 | 시험 비교 툴 | 2–10 NCT, `filter.ids` 1회, focus별 fields | `/studies` | M | 양쪽 |
| 6 | 투명성 뷰 | 결과 게시, 문서 매니페스트, IPD, annotation. **점수 금지** | protocol/document/annotation | M | Codex |
| 7 | 검색 언어 레퍼런스 | field_definitions 모드 또는 전용 툴: search-areas, enums | `/studies/search-areas`, `/enums` | M | Codex |
| 8 | 토픽/MeSH 확장 | browse meshes/ancestors + 검색식 제안 | `derivedSection.*BrowseModule` | M | Codex |

**뒤로 미룸:** 예산 없는 `analyze_landscape` 전체 코호트 크롤. 필요하면 `page`/`count` 예산 + `/version` `dataTimestamp`가 전제.

---

## 6. 만들지 말 것

- `postFilter.*`, `aggFilters`, `filter.synonyms`를 LLM에 그대로 노출. 파셋 ID.
- `/stats/size`를 단독 툴로. (스냅샷에 묶을 수는 있음. 임상 가치 낮음.)
- FHIR/RIS/CSV를 **기본 툴 출력**으로. LLM 컨텍스트에 적대적. (Antigravity는 FHIR 리소스를 제안 → **채택하지 않음.**)
- 교차시험 효과 합성(메타분석). 측정 정의가 다름.
- “등록 가능/불가능” 확정 분류. 레지스트리 ≠ 스크리닝.
- `includeHistoricOnly`로 과거 스터디 버전을 읽는다고 착각.
- 577K 로컬 미러를 1 req/s 회피용으로. 별 제품.
- 프로토콜 PDF/SAP 파싱을 MCP 프로세스 안에서.
- 이 업스트림 레포에 독자 기능을 머지.

---

## 7. 패널이 갈린 지점

| 주제 | Codex | Antigravity | 채택 |
| :--- | :--- | :--- | :--- |
| 2주 1순위 | landscape 집계 + compare + query.* | 날짜/lead/id + 적격 텍스트 + 결과 필터 + enums | **AG 쪽 슬라이스.** 집계는 L·스로틀 |
| FHIR/RIS | 넣지 말 것 | 리소스 `?format=` | **넣지 않음** |
| 적격 | 증거 레이어는 별도 안전 리뷰 | 텍스트만 넣으면 S | **텍스트 옵트인만** |
| `/stats/*` | 스냅샷으로 통합 가능 | 툴로 만들지 말 것 | **단독 툴 금지** |

---

## 8. 독자 MCP를 어떻게 만들 것인가

이 레포를 “더 고도화”하지 말고 **제품 테제를 정한 뒤 새 저장소**를 연다.

### 8.1 라이선스

Apache-2.0이므로:

- 포크하거나 코드를 가져갈 수 있다.
- 원저작권·NOTICE·Apache 고지를 유지한다.
- 바이너리/소스 재배포 시 LICENSE를 포함한다.
- 상표(ClinicalTrials.gov, NLM)를 자기 제품명처럼 쓰지 않는다.

클린룸(API 문서만 보고 재구현)은 더 비싸다. 실무적으로는 **포크 + 표면 재설계 + 브랜딩/패키지명 변경**이 합리적이다.

### 8.2 세 갈래 (하나 고를 것)

**A. 워크플로 MCP (추천)**  
환자 매칭 / 경쟁 정보 / 결과 합성 **중 하나**를 1인칭으로. 기존 7툴을 복제하지 않고, 그 워크플로에 필요한 합성 툴만 둔다. 조회는 내부 서비스.

**B. 더 충실한 API 미러**  
빠진 query.*·enums·version만 얹은 cyanheads 호환 서버. 차별화가 약하다.

**C. 로컬 미러/분석 엔진**  
대량 다운로드 + SQLite. 스로틀·신선도·디스크. MCP가 아니라 데이터 제품.

추천: **A**. 이 문서의 1–5번이 A의 뼈대다.

### 8.3 권장 순서

1. **테제 한 문장.** 예: “에이전트가 환자 프로필로 recruiting 시험을 찾고, 기준문 근거를 붙여 사이트에 물을 질문을 만든다.” 또는 “스폰서/적응증 랜드스케이프를 한 호출로 분포+표본 NCT를 준다.”
2. **새 저장소.** 이름·npm scope·MCP 서버 id를 이 패키지와 겹치지 않게.
3. **스펙.** 툴 이름, 입출력, 바운딩, 에러, 비목표. (이 파일은 입력이고 스펙이 아니다.)
4. **프레임워크.** `@cyanheads/mcp-ts-core`를 쓸지, 다른 MCP SDK를 쓸지. 전자면 이 코드 패턴을 재사용하기 쉽다.
5. **슬라이스 1 (2주 분량, 테제가 A-환자면):** query.lead/id/patient + 날짜; 적격 텍스트 캡; 결과 필터. compare는 슬라이스 2.
6. **필드 테스트.** 실제 CT.gov + 실제 에이전트 세션. 페이로드·400·스로틀을 숫자로.
7. **출시.** README에 업스트림 고지, Apache-2.0, “적격 확정이 아님”.

### 8.4 이 레포와의 관계

- 여기 `docs/`, `src/mcp-server/tools`, `clinical-trials-service.ts`는 **읽는 참고**.
- 이슈/PR을 업스트림에 올릴 필요는 없다. 올릴 거면 범용 갭만 (query.lead 등), 독자 브랜딩 툴은 올리지 않는다.
- `docs/design.md`의 바운딩·format/structuredContent 패리티·핸들러 throw 패턴은 가져갈 가치가 있다.

---

## 9. 2주 슬라이스 (테제 미정일 때의 기본)

테제를 아직 안 골랐으면 아래는 **조회 인프라**라서 어떤 A든 이득이다.

1. `leadSponsorQuery` / `idQuery` / `patientQuery` + 날짜 RANGE를 search·count에.
2. `find_eligible` 기준문 옵트인 (확정 라벨 없음).
3. `get_study_results` outcome/AE 필터.
4. 남으면 `GET /studies/enums` 정규화.

하지 않음: landscape 크롤러, FHIR, 메타분석, 적격 분류기.

---

## 10. 다음 결정 (막히면 여기)

구현 전에 하나만 정하면 된다.

- 독자 MCP의 **1인칭 사용자**가 누구인가: 환자 에이전트 / 연구 랜드스케이프 / 결과·안전성 비교.
- 그 한 줄이 정해지면 스펙 파일(`docs/superpowers/specs/` 또는 새 레포 `docs/`)을 쓰고 구현한다.

원문 패널: `.xllm/artifacts/xllm/panel-you-are-reviewing-cyanheads-clinicaltrialsgov-mcp-server-v2--260821052629-oegp.md`

Completed: 2026-08-21

---

## 11. MCP가 아니라 플러그인으로 만들 것인가 (2026-08-21)

질문: 독자 제품을 MCP 서버가 아니라 ClinicalTrials.gov **플러그인**으로 새로 만들면 어떤가.

이 업스트림 레포는 이미 플러그인 껍데기를 갖고 있다. `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`은 **MCP 서버를 npx로 띄우는 설치 단위**일 뿐, 툴 프로토콜을 대체하지 않는다. MCPB(`manifest.json`)도 같다.

### 플러그인이 실제로 가리키는 세 가지

| | 무엇인가 | 조회는 누가 하나 |
| :--- | :--- | :--- |
| **P0. 스킬-only 플러그인** | SKILL.md, 슬래시 커맨드, 프롬프트. 에이전트가 CT.gov REST를 직접 `fetch` | 모델 + 호스트 |
| **P1. 플러그인 = MCP 배포** | 마켓플레이스 패키지가 stdio MCP를  Bundling (이 레포와 동일) | MCP 프로세스 |
| **P2. 하이브리드 (추천)** | 플러그인이 **스킬(언제/어떻게)** + **얇은 MCP(무엇을/얼마나)** 를 같이 실음 | MCP가 바운딩·스로틀, 스킬이 워크플로 |

### P0를 고르면 잃는 것

검토에서 가치 있던 것은 거의 전부 **서버 쪽 계약**이다.

- 1 req/s 큐, 429 백오프
- compact index vs full record, 결과 섹션 캡, 사이트 리스트 캡
- piece 이름/enum 정규화, AREA 문법 에러를 회복 힌트로
- `format()` / `structuredContent` 패리티

스킬만 있으면 모델이 70KB 스터디를 그대로 컨텍스트에 넣고, 페이지를 병렬로 때려 CT.gov를 막을 수 있다. 호스트마다( Claude / Codex / Cursor / Orca ) HTTP·스키마가 다시 깨진다.

스킬이 잘하는 것: “랜드스케이프는 count 먼저”, “적격은 확정이 아니다”, “compare는 2–10 NCT”. 그건 MCP 툴 7개를 복제하는 일이 아니다.

### 권고

**MCP를 버리지 말고, 제품을 플러그인으로 포장하라 (P2).**

- 배포 단위: `clinicaltrials` 플러그인 (이름·id는 cyanheads 패키지와 분리).
- 런타임: 워크플로 2–4개 툴만 있는 작은 MCP (검색 모드 완성, 적격 텍스트 캡, 결과 필터, 비교). 범용 7툴 미러 금지.
- 에이전트 면: 스킬 + 커맨드가 테제를 가르친다. 프롬프트만 있던 `analyze_trial_landscape`를 여기로 옮긴다.

P0는 프로토타입·개인 전용일 때만. 남에게 설치하게 할 거면 MCP가 가드다.

P1만 하면 cyanheads와 같은 종류의 물건이 된다. 차별화는 P2의 스킬/테제 쪽이다.
