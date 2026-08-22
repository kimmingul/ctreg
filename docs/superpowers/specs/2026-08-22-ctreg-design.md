# ctreg — 임상시험 레지스트리 CLI 설계

- **일자:** 2026-08-22
- **상태:** 설계 확정. 구현 계획은 별도 문서.
- **입력 문서:** `docs/advancement-review-2026-08-21.md` (갭 분석), 참조 구현 `clinicaltrialsgov-mcp-server` v2.9.1
- **선택한 방안:** C — 페더레이션 코어. (A 충실한 어댑터 / B 워크플로 CLI 는 기각)

---

## 1. 테제

> 에이전트가 **하나의 스키마**로 세계 각국 임상시험 레지스트리를 조회한다. CLI는 레지스트리 간 차이를 흡수하고, 무엇을 못 하는지 명시하며, 페이로드와 요청률을 강제로 묶는다.

슬라이스 1에서 구현하는 어댑터는 **ClinicalTrials.gov 하나뿐**이다. 나머지는 자리만 비운다. 계약과 어댑터 심을 1일차에 고정하는 것이 이 설계의 전부이고, 그 값은 두 번째 어댑터를 붙이는 날 회수된다.

### 1.1 왜 CLI인가

검토 문서 §11이 "스킬-only(P0)에서 잃는 것"으로 지목한 항목 — 요청률 큐, 페이로드 바운딩, enum 정규화, 400 회복 힌트 — 은 전부 **프로세스 경계 안의 계약**이지 MCP 프로토콜의 속성이 아니다. CLI가 그 가드를 그대로 들고 있으면 손실 없이 호스트 종속(Claude / Codex / Cursor마다 다시 깨지는 HTTP·스키마)을 제거할 수 있다.

### 1.2 비목표

- 범용 7툴 미러 — 업스트림 MCP와 같은 물건이 된다
- `match` / `compare` / `landscape` 같은 합성 워크플로 커맨드 — **플러그인 스킬의 몫**
- 교차시험 효과 합성(메타분석), 등록 가능/불가 확정 분류
- FHIR / RIS / CSV 를 기본 출력으로
- 로컬 전량 미러 (별개 데이터 제품)
- 프로토콜 PDF·SAP 파싱
- 업스트림 저장소에 기능 머지

---

## 2. 계약 (1) — `TrialRecord`

### 2.1 원칙

**신원과 검색 축만 정규화하고, 임상 본문은 정규화하지 않는다.**

레지스트리 간에 질환명이나 outcome measure를 통일하려는 시도는 메타분석이지 조회 계층이 아니다(검토 문서 §6). 정규화하는 폐쇄 어휘는 `status` · `phase` · `studyType` 세 개뿐이고, 나머지는 원문을 그대로 옮긴다.

**손실적 매핑은 반드시 원문을 동반한다.** 정규화 값 옆에 항상 `*Raw`가 붙는다. 없는 사실을 만들지 않는다.

**교차 검증 결과(`docs/registry-field-survey-2026-08-22.md`).** WHO ICTRP·ISRCTN·EU CTIS·CRIS(한국)·jRCT(일본) 다섯 레지스트리를 CT.gov와 대조한 결과, §2.2 의 core 필드 13개 전부가 CT.gov 외 최소 세 곳 이상에서 채워질 수 있음을 확인했다 — core에서 이동한 필드는 없다. 다만 향후 두 번째 어댑터를 만들 때 반드시 알아야 할 구조적 함정 두 가지가 드러났다:

1. **CTIS는 상태를 레코드당 1개가 아니라 회원국(EU/EEA)별로 따로 매긴다.** 출처: [CTIS public portal: summary](https://www.ema.europa.eu/en/documents/other/clinical-trial-information-system-ctis-public-portal-summary_en.pdf)(EMA/441149/2024, 2024-09-20) 4/6쪽 "Member State" 섹션의 "Current status" 필드 — "The present stage of the clinical trial **in each member state**"라고 명시하고 10개 상태값(Authorised, recruitment pending / Authorised, recruiting / Ongoing, recruiting / Ongoing, recruitment ended / Temporarily halted / Suspended / Ended / Revoked / Not authorised / Expired)을 회원국 단위로 매긴다. `status`가 단일 값이라는 이 스펙의 전제와 구조적으로 다르다 — 대표값을 고르는 기준은 CTIS 어댑터가 정하고, 국가별 전체 값은 `--raw`의 `source`로 보존한다. **같은 문서, 같은 "Member State" 표 블록에 `dates.lastUpdated`에 대응하는 "Last update" 필드도 있다** — "The most recent date when information about the clinical trial was updated." "Current status"·"Start date"("in a Member State")·"End (or early termination)"("in the relevant Member State")처럼 명시적으로 회원국별이라고 적힌 항목들과 같은 블록 안에 새 섹션 헤더 없이 이어져 있어 이 필드도 회원국별일 가능성이 높지만, "Last update" 자신의 정의 문장에는 그 문구가 없어 단정하지는 않는다 — CTIS 어댑터를 실제로 만들 때 실물 trial 페이지에서 "Last update"가 트라이얼당 1개인지 회원국당 1개인지 먼저 확인해야 하고, 회원국별로 밝혀지면 위 status와 같은 방식(대표값 + `--raw` 보존)으로 다뤄야 한다.
2. **ISRCTN·CRIS·jRCT 세 곳은 목표(target) 등록 인원만 제공하고 실제(actual) 인원을 구분하지 않는다는 것이 확인됐다.** 이 세 곳을 위한 어댑터는 `enrollment.basis === 'actual'`을 채울 수 없다고 가정해야 한다. **ICTRP는 다르게 취급한다 — target-only로 단정할 근거가 없다.** WHO TRDS 항목 17의 공식 명칭이 "Sample Size"가 아니라 "Target & final sample size"라, 목표치뿐 아니라 실제(최종)치도 함께 담을 수 있는 필드로 보인다 — 다만 개별 레코드에서 그 값이 실제로 채워지는지는 검증하지 못했다(미확인, `docs/registry-field-survey-2026-08-22.md`의 "확인 못한 항목 요약" 참고). CTIS도 표본크기 필드 자체를 두 공식 문서(Full trial information, summary) 어디서도 찾지 못해 미확정이다.

### 2.2 레코드

```ts
type TrialRecord = {
  // ---- 신원 ----
  id: string                     // "CTGOV:NCT01234567"
  registry: RegistryKey          // "ctgov"
  registryId: string             // "NCT01234567"
  crossIds?: { registry?: string; id: string; domain?: string }[]
  // 보조 식별자. 다른 레지스트리 번호일 수도, 그랜트·프로토콜 번호일 수도 있다.
  // registry 는 우리 RegistryKey 가 아니라 업스트림이 붙인 원문 라벨이다 — type 이 없으면 registry 도 생략한다.
  // domain 은 업스트림이 같은 id 를 여러 기관에서 재사용할 때 구분하는 근거다(예: CT.gov 의 동일 id·다른 domain).
  url: string

  // ---- core: 항상 채움 (없으면 필드를 생략, 추측 금지) ----
  title: string
  officialTitle?: string
  status: TrialStatus            // 폐쇄 어휘
  statusRaw?: string             // 업스트림 원문
  phase?: TrialPhase[]           // 폐쇄 어휘, 배열
  phaseRaw?: string[]
  studyType?: StudyType
  studyTypeRaw?: string
  conditions: string[]           // 원문 그대로
  interventions?: { type?: string; name: string }[]   // type도 원문
  sponsor?: { lead?: string; collaborators?: string[] }
  enrollment?: { count?: number; basis?: 'actual' | 'estimated' | 'unknown' }
  dates?: {                      // ISO 8601, 부분 날짜 허용 ("2025-03")
    start?: string; primaryCompletion?: string; completion?: string
    firstPosted?: string; lastUpdated?: string
  }
  locations?: TrialLocation[]    // 캡 적용
  locationsTotal?: number        // 캡 적용 이전 총 개수
  hasResults?: boolean

  // ---- detail: --include 로 옵트인 ----
  eligibility?: {
    minAge?: string; maxAge?: string           // 원문 ("18 Years")
    sex?: 'all' | 'female' | 'male' | 'unknown'
    healthyVolunteers?: boolean
    criteriaText?: string                       // 캡 적용
    criteriaTruncated?: boolean
  }
  outcomes?: { type: 'primary' | 'secondary' | 'other'
               measure: string; timeFrame?: string; description?: string }[]
  contacts?: { name?: string; role?: string; email?: string; phone?: string }[]

  // ---- 출처 ----
  fetchedAt: string              // ISO, 캐시 히트면 캐시 저장 시각
  source?: unknown               // --raw 일 때만
}

type TrialLocation = {
  facility?: string; city?: string; state?: string; country?: string
  status?: TrialStatus; statusRaw?: string
  geo?: { lat: number; lon: number }
  distanceKm?: number            // --near 가 활성일 때만
}
```

### 2.3 폐쇄 어휘

```
TrialStatus = recruiting | not_yet_recruiting | enrolling_by_invitation
            | active_not_recruiting | suspended | terminated | completed
            | withdrawn | unknown | other

TrialPhase  = early_phase_1 | phase_1 | phase_2 | phase_3 | phase_4 | na | other

StudyType   = interventional | observational | expanded_access | other
```

`unknown` 과 `other` 는 다르다.

| 값 | 의미 |
| :-- | :-- |
| `unknown` | 레지스트리가 "모른다"고 말했거나 필드가 비어 있다 |
| `other` | 값은 있으나 공통 어휘에 대응이 없다 — `*Raw` 를 봐야 한다 |

`phase_1_2` 같은 결합 값은 어휘에 두지 않는다. CT.gov가 `["PHASE1","PHASE2"]`로 주므로 배열 `["phase_1","phase_2"]`로 무손실 보존한다.

### 2.4 ID

- 정규형: `<REGISTRY>:<원문 ID>` — `CTGOV:NCT01234567`
- 입력에서는 맨 `NCT01234567` 도 받는다. 접두사가 없으면 패턴으로 레지스트리를 추론하고, 추론 불가면 exit 2.
- 레지스트리 접두사는 대문자, 원문 ID는 업스트림 표기 그대로.

---

## 3. 계약 (2) — `RegistryAdapter` + Capability

### 3.1 심

```ts
interface RegistryAdapter {
  readonly key: RegistryKey
  capability(): Capability
  search(q: NormalizedQuery, opts: FetchOpts): Promise<AdapterResult<TrialRecord[]> & { total?: number }>
  get(ids: string[], opts: FetchOpts): Promise<AdapterResult<TrialRecord[]>>      // 배치
  results(id: string, opts: ResultsOpts): Promise<AdapterResult<TrialResults>>
  count(q: NormalizedQuery, o: FetchOpts): Promise<AdapterResult<number>>
}

type AdapterResult<T> = { data: T; warnings: Warning[] }
type Warning = { code: string; message: string; id?: string; at?: number }
```

어댑터는 **치명적 실패만 throw** 하고(`CtregError` → exit 2/3/4), 비치명적 사실 — 찾지 못한 ID, 절단, 락 타임아웃 — 은 `warnings[]` 로 돌려준다. 그래야 배치 `get` 에서 ID 하나가 없다고 전체가 실패하지 않는다. CLI 층이 이 배열을 봉투의 `warnings` 로 합친다.

보조 타입은 어댑터가 아니라 CLI 층이 채운다. `NormalizedQuery` 는 §4.1 의 검색 축·필터를 레지스트리 중립 형태로 담은 것이고, `FetchOpts` 는 `{ include, caps, cache, signal }`, `ResultsOpts` 는 `{ sections, outcomeFilter, aeOrganFilter, aeTermFilter, full }` 이다. 어댑터는 이들을 자기 업스트림 문법으로 번역하기만 한다.

**두 번째 레지스트리를 붙이는 작업은 `src/adapters/<key>/` 하나를 추가하는 것으로 끝나야 한다.** CLI 커맨드·출력 봉투·스킬이 함께 바뀐다면 계약 설계가 틀린 것이다. 이것이 이 설계의 성공 판정 기준이다.

### 3.2 Capability 선언

```jsonc
{
  "key": "ctgov",
  "name": "ClinicalTrials.gov",
  "region": "US / global",
  "search": {
    "condition": true, "intervention": true, "term": true, "title": true,
    "sponsor": true, "lead": true, "location": true, "id": true, "patient": true,
    "geo": true, "geoNeedsCoords": true,
    "status": true, "phase": true, "studyType": true, "dateRange": true
  },
  "detail":  { "eligibilityText": true, "outcomes": true, "contacts": true },
  "results": true,
  "count":   true,
  "limits":  { "maxPageSize": 200, "ratePerSec": 1, "maxBatchIds": 50 }
}
```

### 3.3 미지원은 빈 결과가 아니라 에러

이 설계에서 가장 중요한 규칙이다.

> 지원하지 않는 축으로 요청하면 **exit 3 + 에러 봉투**를 낸다. 빈 결과를 반환하지 않는다.

빈 결과를 반환하면 에이전트가 "해당 시험 없음"과 "이 레지스트리는 그렇게 검색할 수 없음"을 구분하지 못하고, 그 구분 실패는 사용자에게 임상적으로 틀린 결론으로 전달된다. 레지스트리 품질 편차가 극심하기 때문에(CT.gov만 결과 섹션이 구조화되어 있다) capability 선언이 없으면 페더레이션은 성립하지 않는다.

`ctreg registries` 는 이 선언을 그대로 덤프한다. 스킬은 요청을 조립하기 전에 이걸 읽는다.

---

## 4. 커맨드 표면

다섯 개. 합성 워크플로 커맨드는 두지 않는다.

### 4.1 `ctreg search`

```
ctreg search [검색 축] [필터] [출력]

검색 축   --condition <q>      질환/상태
          --intervention <q>   중재
          --term <q>           범용 자유어
          --title <q>          제목
          --sponsor <q>        스폰서(전체)
          --lead <q>           대표 스폰서
          --location <q>       장소 문자열
          --id <q>             ID 검색
          --patient <q>        환자 지향 검색 축
          --outcome-query <q>  결과 지표 텍스트

필터      --status <v>...      폐쇄 어휘. other/unknown 은 입력 불가 → exit 2
          --phase <v>...       폐쇄 어휘
          --study-type <v>
          --near <lat,lon>     좌표 필수. 지명은 받지 않는다
          --radius <N>km|mi    --near 없이 쓰면 exit 2
          --updated-since / --updated-before   YYYY-MM-DD
          --start-after / --start-before
          --completion-after / --completion-before

출력      --registry <key>...  기본 ctgov. 미등록 키는 exit 2
          --include <section>... core(기본) | eligibility | outcomes | contacts | locations | all
          --page-size <N>      기본 20, 최대 200
          --page-token <t>     불투명 커서. 봉투의 nextPageToken 을 그대로 넘긴다
          --sort <field>       슬라이스 1 은 업스트림이 그대로 받는 필드만 통과시킨다
          --eligibility-chars <N>   기본 8000, 최대 40000. --include eligibility 없이 쓰면 exit 2
          --raw                source 원문 동봉
          --format json(기본) | ndjson | text
          --no-cache / --refresh
```

### 4.2 `ctreg get`

```
ctreg get CTGOV:NCT01234567 [ID...]   # 배치. 검토 문서 §4 병목 3
         --include ... --raw --format ...
```

한 어댑터로 가는 ID들은 **한 번의 업스트림 호출로 묶는다**(CT.gov는 `filter.ids`). 배치 상한 초과 시 여러 호출로 쪼개되 요청률 예산을 지킨다. 존재하지 않는 ID는 전체를 실패시키지 않고 `warnings[]`에 `not_found` 로 남긴다.

### 4.3 `ctreg results`

```
ctreg results CTGOV:NCT01234567
         --section outcomes|adverse|flow|baseline   (반복 가능, 기본 전체 요약)
         --outcome <substr>       제목 부분일치로 해당 지표만 전개
         --ae-organ <substr>      기관계
         --ae-term <substr>       유해사례 용어
         --full                   필터 없이 전체 (경고 동반)
```

기본은 **요약**이다: 지표 제목 목록 + AE 기관계 롤업 + 각 섹션의 개수. 필터에 걸린 항목만 전체 상세로 전개한다. 검토 문서 §4 병목 2("all-or-nothing")를 여기서 해소한다.

```ts
type TrialResults = {
  id: string
  registry: RegistryKey
  hasResults: boolean
  sections: {                              // 각 섹션은 항상 개수를 먼저 낸다
    outcomes?:  { total: number; expanded: number; items: OutcomeResult[] }
    adverse?:   { total: number; expanded: number
                  byOrgan: { organ: string; events: number; expanded: boolean }[]
                  items: AdverseEvent[] }
    flow?:      { total: number; items: unknown[] }      // 레지스트리 원문 구조
    baseline?:  { total: number; items: unknown[] }
  }
  fetchedAt: string
}
```

`expanded` 는 필터에 걸려 전체 상세로 펼쳐진 항목 수다. `total > expanded` 이면 나머지는 제목/집계만 있다는 뜻이며, 이 사실은 `warnings[]` 에도 남는다. `flow` 와 `baseline` 은 레지스트리마다 구조가 너무 달라 **정규화하지 않고 원문 구조를 그대로 통과시킨다** — 정규화하지 않는다는 사실 자체를 계약으로 못박는다.

### 4.4 `ctreg count`

`search` 와 **동일한 필터 문법**을 받고 개수만 낸다. 페이로드를 받지 않는다. 랜드스케이프 작업의 첫 단계로 스킬이 먼저 부르도록 설계된 커맨드다.

### 4.5 `ctreg registries`

capability 선언 덤프. 네트워크를 치지 않는다. `--registry <key>` 로 하나만.

---

## 5. 출력 봉투 · 바운딩 · exit code

### 5.1 봉투

어댑터가 하나뿐이어도 **처음부터 다중 레지스트리 모양**이다. 나중에 형태가 바뀌면 스킬이 깨진다.

```jsonc
{
  "query":   { /* 정규화된 입력 에코 */ },
  "registries": [
    { "registry": "ctgov", "status": "ok", "total": 412, "returned": 20,
      "nextPageToken": "NF0g5JGCM…" }
  ],
  "warnings": [
    { "code": "eligibility_truncated", "id": "CTGOV:NCT01234567", "at": 8000 }
  ],
  "data": [ /* 커맨드별 페이로드 */ ]
}
```

`data` 의 모양은 커맨드마다 다르다. 봉투의 나머지 필드는 모든 커맨드가 공유한다.

| 커맨드 | `data` |
| :-- | :-- |
| `search` · `get` | `TrialRecord[]` |
| `results` | `TrialResults` (§4.3) |
| `count` | `{ total: number }` |
| `registries` | `Capability[]` |

페이로드 필드를 `results` 가 아니라 `data` 로 두는 이유는 `ctreg results` 커맨드 및 capability 의 `results` 플래그와 이름이 겹치지 않게 하기 위함이다.

- `registries[].status` — `ok` | `error` | `unsupported`. 어댑터별로 독립. 하나가 실패해도 나머지 결과는 낸다.
- `registries[].nextPageToken` — 페이지네이션은 **번호가 아니라 불투명 커서**다. CT.gov 가 `pageToken` 을 쓰고 다른 레지스트리도 커서형이 흔하므로, 페이지 번호를 계약에 넣지 않는다. 다음 페이지가 없으면 필드를 생략한다.
- **stdout 은 기계용, stderr 는 사람용.** 로그·진행상황·타이밍은 어떤 경우에도 stdout 을 오염시키지 않는다. `--format json`(기본)과 `ndjson` 은 stdout 에 JSON 만 낸다. `--format text` 는 사람이 직접 실행할 때만 쓰는 모드이며, 스킬은 쓰지 않는다.

### 5.2 바운딩

| 대상 | 기본 캡 | 확장 |
| :-- | :-- | :-- |
| `data[]` (search/get) | page-size 20 | 최대 200 |
| `locations[]` | 10 (+ `locationsTotal`) | `--include locations` → 200 |
| `eligibility.criteriaText` | 8,000자 | `--eligibility-chars N`, 최대 40,000 |
| `outcomes[]` | 20 | `--include outcomes` → 200 |
| `results` 커맨드 응답 | 요약 | `--full` (경고 동반) |

**조용한 절단은 금지한다.** 잘라낸 모든 지점은 `warnings[]` 항목 하나와 레코드 안의 `*Truncated` 플래그를 남긴다. 조용한 절단은 에이전트를 가장 확실하게 속이는 실패 모드다.

### 5.3 Exit code

플러그인 스킬이 분기할 계약이다.

| 코드 | 의미 | 스킬이 할 일 |
| :-- | :-- | :-- |
| `0` | 정상 (결과 0건 포함 — 0건은 에러가 아니다) | 결과 사용 |
| `2` | 사용법/검증 오류 — 잘못된 플래그, 파싱 불가 ID, `--radius` 단독 | 요청을 고쳐 재시도 |
| `3` | 미지원 capability | 다른 축으로 바꾸거나 사용자에게 한계를 알림 |
| `4` | 업스트림 실패 — 429 소진, 5xx, 타임아웃 | 백오프 후 재시도 또는 포기 |
| `5` | 부분 실패 — 일부 레지스트리만 성공 | 결과는 쓰되 결손을 밝힘 |

에러 시 stdout 에는 같은 봉투에 `error: { code, message, hint }` 를 담는다. `hint` 는 업스트림의 400 응답을 회복 가능한 문장으로 번역한 것이다(업스트림 `recovery-hints.ts` 패턴 계승).

---

## 6. 런타임 — CLI 고유 작업

업스트림의 스로틀은 `throttleQueue: Promise<void>` 프로미스 체인이고 `MIN_INTERVAL_MS = 1000` 이다. **프로세스와 함께 죽는다.** 에이전트가 `ctreg get` 을 10번 병렬로 실행하면 요청률 제한이 전혀 작동하지 않는다. 단명 프로세스가 공유 상태를 갖는 유일한 방법은 디스크다.

### 6.1 위치

`$CTREG_CACHE_DIR` → `$XDG_CACHE_HOME/ctreg` → `~/.cache/ctreg`

### 6.2 토큰버킷

- 레지스트리별 파일 `bucket-<registry>.json`. 레지스트리마다 예산이 다르므로 분리한다.
- 원자적 갱신을 락파일로 직렬화(획득 → 읽기 → 소비 → 쓰기 → 해제).
- **백오프 상태도 공유한다.** 한 프로세스가 받은 429는 나머지 프로세스가 즉시 알아야 한다. 버킷 파일에 `blockedUntil` 을 둔다.
- 락 획득 실패 시 fail-open 하지 않는다. 보수적으로 최소 간격만큼 대기한 뒤 단독 진행하고 `warnings[]` 에 `throttle_lock_timeout` 을 남긴다.

### 6.3 응답 캐시

- 키: `sha256(registry | endpoint | 정규화된 파라미터)`
- 기본 TTL 3,600초. `--no-cache`(읽기·쓰기 모두 생략), `--refresh`(무시하고 다시 받아 덮어씀).
- 캐시 히트여도 `fetchedAt` 은 **원 응답 시각**을 낸다. 신선도를 숨기지 않는다.
- 반복 `get` 의 1초 지연이 사라지는 것이 실사용상 가장 큰 체감 이득이다.

### 6.4 HTTP

업스트림 로직을 그대로 옮긴다: `RETRYABLE_STATUS = {429, 500, 502, 503, 504}`, 지수 백오프 + 지터, 재시도 3회, 타임아웃 30초. `mcp-ts-core` 의 에러 팩토리는 로컬 등가물로 교체한다.

### 6.5 환경 변수

| 변수 | 기본값 |
| :-- | :-- |
| `CTREG_CACHE_DIR` | `~/.cache/ctreg` |
| `CTREG_CACHE_TTL_SEC` | `3600` |
| `CTREG_TIMEOUT_MS` | `30000` |
| `CTREG_MAX_RETRIES` | `3` |
| `CTREG_RATE_PER_SEC` | `1` |
| `CTREG_CTGOV_BASE_URL` | `https://clinicaltrials.gov/api/v2` |

---

## 7. `ctgov` 어댑터

### 7.1 검색 축 매핑

| ctreg 플래그 | CT.gov |
| :-- | :-- |
| `--condition` | `query.cond` |
| `--intervention` | `query.intr` |
| `--term` | `query.term` |
| `--title` | `query.titles` |
| `--location` | `query.locn` |
| `--outcome-query` | `query.outc` |
| `--sponsor` | `query.spons` |
| `--lead` | `query.lead` ★ 업스트림 미사용 |
| `--id` | `query.id` ★ 업스트림 미사용 |
| `--patient` | `query.patient` ★ 업스트림 미사용 |
| `--status` | `filter.overallStatus` (폐쇄 어휘 역매핑) |
| `--phase` | `filter.advanced` `AREA[Phase]` |
| `--study-type` | `filter.advanced` `AREA[StudyType]` |
| `--near`/`--radius` | `filter.geo=distance(lat,lon,Nkm)` |
| 날짜 범위 | `filter.advanced` `AREA[…]RANGE[…]` |
| `get` 배치 | `filter.ids` |
| `--page-token` | `pageToken` |
| `count` | `pageSize=0` + `countTotal=true` |

**리스트 파라미터는 `|` 로 잇는다** (`filter.overallStatus`, `filter.ids`, `fields`). `filter.advanced` 에 표현식이 둘 이상이면 각각 괄호로 싸고 ` AND ` 로 잇는다. 참조 구현 `buildSearchQuery()` 에서 확인한 실제 동작이다.

**날짜 필터는 조용히 좁힌다.** `AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX]` 는 해당 필드를 **게시한 시험만** 매칭한다. 날짜를 기재하지 않은 시험은 결과에서 사라진다. 날짜 필터가 걸린 요청은 반드시 `warnings[]` 에 `date_filter_excludes_missing` 을 남긴다.

★ 표시는 검토 문서 §3이 "API에는 있으나 업스트림 코드에 없다"고 지목한 항목이다. 슬라이스 1에서 채운다.

### 7.2 상태 어휘 매핑

| CT.gov | ctreg |
| :-- | :-- |
| `RECRUITING` | `recruiting` |
| `NOT_YET_RECRUITING` | `not_yet_recruiting` |
| `ENROLLING_BY_INVITATION` | `enrolling_by_invitation` |
| `ACTIVE_NOT_RECRUITING` | `active_not_recruiting` |
| `SUSPENDED` | `suspended` |
| `TERMINATED` | `terminated` |
| `COMPLETED` | `completed` |
| `WITHDRAWN` | `withdrawn` |
| `UNKNOWN`, 필드 없음 | `unknown` |
| 확대접근 계열(`AVAILABLE` 등) 및 그 외 | `other` + `statusRaw` |

### 7.3 지오

**지오코딩을 하지 않는다.** 참조 구현에도 없고, 새 네트워크 의존성을 들이지 않는다. `--near` 는 좌표를 요구하고, 지명을 주면 exit 2 + "좌표를 먼저 조회하라"는 힌트를 낸다.

업스트림 `geo-helpers.ts` 의 하버사인은 그대로 쓰되 마일 결과를 km로 변환해 `distanceKm` 으로 낸다. `--radius` 는 `km`/`mi` 접미사를 받고, 접미사가 없으면 CT.gov가 미터로 읽으므로 **접미사를 필수로 강제한다**(exit 2).

### 7.4 필드 테스트에서 검증할 것

아래는 문서·코드 근거는 있으나 **실제 응답으로 확인하기 전에는 확정하지 않는다.** 슬라이스 1의 게이트다.

1. `query.lead` / `query.id` / `query.patient` 의 실제 동작과 매칭 범위
2. `AREA[LastUpdatePostDate]RANGE[2025-01-01,MAX]` 형태의 정확한 Essie 문법
3. `filter.ids` 의 배치 상한 (`maxBatchIds: 50` 은 잠정값) 및 URL 길이 한계
4. `--phase` / `--study-type` 을 `filter.advanced` 로 거는 것과 `query.term` 에 섞는 것 중 어느 쪽이 정확한가
5. `hasResults` 필터 문법 — 확인 전까지 **필터로 노출하지 않는다**. 레코드 필드로만 낸다.

---

## 8. 저장소 구조 · 포팅 범위

```
ctreg/
  src/
    cli/
      index.ts                 진입점, 인자 파싱, 커맨드 디스패치
      commands/{search,get,results,count,registries}.ts
      output.ts                봉투 조립, 포맷, 절단 플래그
      exit-codes.ts
    core/
      record.ts                TrialRecord Zod 스키마  ← 계약
      capability.ts            RegistryAdapter 인터페이스 + Capability 스키마
      registry.ts              어댑터 레지스트리, ID 파싱/정규화
      vocab.ts                 status/phase/studyType 폐쇄 어휘 + 양방향 매핑
      query.ts                 NormalizedQuery 타입
    adapters/
      ctgov/
        adapter.ts             RegistryAdapter 구현
        client.ts              ← 업스트림 clinical-trials-service.ts 포팅
        field-search.ts        ← 업스트림 포팅
        map.ts                 CT.gov JSON → TrialRecord
        query.ts               NormalizedQuery → Essie/query.*
        vocab.ts               CT.gov enum ↔ 공통 어휘
    runtime/
      throttle.ts              온디스크 토큰버킷 + 락
      cache.ts                 온디스크 응답 캐시
      http.ts                  fetch + 재시도/백오프
      errors.ts                mcp-ts-core 에러 팩토리 대체
  tests/
    fixtures/                  실제 CT.gov 응답 기록본
  NOTICE
  LICENSE                      Apache-2.0
```

### 8.1 포팅 대상

| 업스트림 | 줄수 | 처리 |
| :-- | --: | :-- |
| `services/clinical-trials/clinical-trials-service.ts` | 892 | `adapters/ctgov/client.ts` 로 포팅. 스로틀만 `runtime/throttle.ts` 로 교체 |
| `services/clinical-trials/field-search.ts` | 198 | 거의 그대로 |
| `services/clinical-trials/types.ts` | 319 | CT.gov 원문 타입으로 유지 (`TrialRecord` 와 별개) |
| `tools/utils/geo-helpers.ts` | 46 | 그대로 + km 변환 |
| `tools/utils/recovery-hints.ts` | 31 | 힌트 문구 계승 |
| `tools/definitions/*.tool.ts` | 4,062 | **전체 이식 금지.** 바운딩·요약 로직만 발췌 |

프레임워크 결합은 얕다. 서비스층이 `@cyanheads/mcp-ts-core` 에서 쓰는 것은 `Context` 타입, 에러 팩토리 6개, `httpErrorFromResponse`, `parseEnvConfig` 뿐이다. 로컬 등가물로 교체하는 기계적 작업이며 재작성이 아니다.

### 8.2 런타임·의존성

- 개발은 Bun, 빌드는 **Node 호환 ESM** (업스트림과 동일). `npx ctreg` 가 동작해야 플러그인 배포가 편하다.
- 인자 파싱은 Node 내장 `util.parseArgs` + Zod 검증. commander/yargs 를 들이지 않는다.
- 런타임 의존성 목표: `zod` + 락파일 라이브러리 하나.

### 8.3 라이선스·귀속

업스트림은 Apache-2.0(Casey Hand / cyanheads)이므로:

- 포팅한 파일에 원저작권 헤더를 보존하고 유래를 주석으로 남긴다
- `LICENSE`(Apache-2.0)와 `NOTICE`(cyanheads 고지)를 배포물에 포함한다
- 패키지명·바이너리명·플러그인 id 에 ClinicalTrials.gov / NLM 상표를 쓰지 않는다
- README 에 업스트림 귀속과 **"이 도구의 출력은 임상시험 적격 판정이 아니다"** 를 명시한다
- 업스트림에 이슈/PR을 올릴 의무는 없다. 올린다면 범용 갭(`query.lead` 등)만.

---

## 9. 테스트 전략

| 층 | 내용 |
| :-- | :-- |
| 단위 | 어휘 양방향 매핑, ID 파싱/정규화, `NormalizedQuery` → Essie 조립 |
| 매핑 | **기록된 실제 CT.gov 응답**으로 `map.ts` 검증. 반드시 포함: 스폰서·날짜·장소가 빠진 희소 응답, 결과 섹션이 있는 응답, `other` 로 떨어지는 상태값 |
| 계약 | 모든 어댑터가 통과해야 하는 공통 스위트. 핵심은 **capability 진실성** — `results: false` 인 어댑터에 `results` 를 부르면 빈 값이 아니라 exit 3 이 나야 한다 |
| 런타임 | 스텁 서버에 N개 프로세스를 동시에 붙여 요청 간격이 실제로 ≥1초인지 검증. 락 타임아웃 경로도 포함 |
| E2E | 실제 CT.gov 스모크. 환경변수 옵트인, CI 기본 실행에서 제외 |

희소 응답 테스트는 필수다. 참조 구현의 체크리스트가 같은 항목을 요구하며, 정규화 계층은 없는 값을 그럴듯하게 채우는 순간 임상적으로 위험해진다.

---

## 10. 슬라이스 1 범위

**포함**

1. `core/record.ts` · `core/capability.ts` · `core/vocab.ts` — 계약 확정
2. `runtime/` 전체 — 온디스크 버킷, 캐시, HTTP
3. `adapters/ctgov/` — 클라이언트 포팅 + 매핑 + 쿼리 조립
4. 커맨드 다섯: `search` `get` `results` `count` `registries`
5. 검토 문서 §9의 2주 항목: `query.lead|id|patient`, 날짜 RANGE, 적격 기준문 옵트인(캡 적용, 판정 라벨 없음), 결과 outcome/AE 필터
6. §7.4 항목에 대한 실제 CT.gov 필드 테스트 + 결과 기록

**제외 (슬라이스 2 이후)**

- 다른 레지스트리 어댑터 — 심만 비워 둔다
- `GET /studies/enums` 캐시 기반 값 정규화
- `hasResults` 필터, 정규화된 정렬 키(`--sort` 는 슬라이스 1 에서 업스트림 필드명 통과만), `ctreg cache` 관리 커맨드
- 플러그인 패키징(스킬 + 슬래시 커맨드)
- 지오코딩

---

## 11. 위험

| 위험 | 완화 |
| :-- | :-- |
| **계약을 CT.gov만 보고 설계해 결국 A로 회귀한다.** 이 설계 전체의 값이 걸려 있다 | 구현 착수 전에 ICTRP / CRIS / jRCT 의 공개 필드 목록을 최소 1회 대조하고, `TrialRecord` 의 각 core 필드가 최소 두 레지스트리에서 채워질 수 있는지 확인한다 |
| Essie RANGE·`query.patient` 등 미검증 문법 | §7.4 를 슬라이스 1 게이트로 둔다. 확인 전에는 플래그로 노출하지 않는다 |
| 네트워크 홈 디렉터리에서 락파일이 불안정 | 락 실패 시 fail-open 금지. 보수적 대기 후 단독 진행 + `warnings[]` |
| 캐시가 모집 상태의 신선도를 가린다 | TTL 1시간, `fetchedAt` 항상 노출, `--refresh` 제공 |
| 정규화가 없는 값을 채워 임상적으로 잘못된 확신을 준다 | 희소 응답 테스트 필수. 값이 없으면 필드를 생략하고, 손실 매핑은 항상 `*Raw` 동반 |

---

## 12. 다음 단계

이 문서는 설계다. 다음은 구현 계획(작업 분할, 순서, 수용 기준)이며 별도 문서로 작성한다.
