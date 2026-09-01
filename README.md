# ctreg

전 세계 임상시험 레지스트리를 **하나의 명령어**로 찾는다.

ClinicalTrials.gov, ISRCTN, WHO ICTRP, CRIS(한국), EU CTIS — 다섯 곳은 필드 이름도,
상태 표기도, 검색 방법도 제각각이다. `ctreg` 는 그 차이를 흡수해 **같은 모양의 결과**로
돌려준다. 사람이 터미널에서 쓸 수도 있고, Claude Code 플러그인으로 붙여 AI 에게 시킬 수도 있다.

```bash
ctreg search --condition melanoma --status recruiting --page-size 3
```

> [!WARNING]
> **이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.**
>
> `ctreg` 는 레지스트리가 게시한 내용을 그대로 정규화해 보여줄 뿐이다. 어떤 필드가 비어 있는
> 것은 "그런 사실이 없다" 가 아니라 "이 레지스트리가 그 항목을 기재하지 않았다" 는 뜻일 수
> 있다. 환자를 특정 시험에 적격/부적격으로 판정하는 데 이 출력을 직접 쓰지 마라.

---

## 왜 만들었나

임상시험을 찾는 일은 대개 이렇게 흘러간다. ClinicalTrials.gov 에서 검색하고, 유럽 시험이
빠진 것 같아 CTIS 를 따로 열고, 국내 시험은 CRIS 에서 다시 찾는다. 세 화면의 결과를 손으로
맞춰 보는데 상태 표기가 서로 다르다 — 한쪽의 `Recruiting` 과 다른 쪽의 `모집중` 과 또 다른
쪽의 `Authorised` 가 같은 뜻인지부터 따져야 한다.

`ctreg` 가 푸는 것이 그 지점이다. 그리고 하나를 더 지킨다:

> **못 하는 것을 빈 결과로 위장하지 않는다.**

이게 핵심이다. 어떤 레지스트리는 상(phase)으로 못 거르고, 어떤 곳은 연구자 이름 칸이 아예
없다. 그런데 API 들이 **모르는 조건을 조용히 무시하고 전체를 돌려주는** 경우가 많다. 그러면
좁혀지지 않은 결과가 좁혀진 것처럼 보인다. `ctreg` 는 그럴 때 0건을 주지 않고 **exit 3 으로
"그렇게는 물어볼 수 없다" 고 말한다.** "그런 시험이 없다" 와 "그렇게 검색할 수 없다" 는
전혀 다른 말이기 때문이다.

이 문서의 모든 제약은 추측이 아니라 **실물 API 에 대조한 실측**이다. 레지스트리마다 필드
테스트가 있고 그 기록이 [`docs/`](docs/) 에 날짜와 함께 남아 있다.

---

## 설치

**Node.js 22 이상**이 필요하다.

```bash
npm i -g @kimmingul/ctreg
ctreg registries          # 확인 — 네트워크를 타지 않는다
```

패키지 이름에는 스코프가 붙지만 **명령어는 `ctreg`** 다. npm 이 `ctreg` 라는 이름을 기존
패키지와 너무 비슷하다고 거절해서 스코프로 옮겼다. 설치 줄만 길고 사용법은 그대로다.

<details>
<summary>소스에서 빌드하려면</summary>

```bash
git clone https://github.com/kimmingul/ctreg.git
cd ctreg
npm install
npm run build     # dist/ 를 만든다 — 이걸 안 하면 실행되지 않는다
npm link          # 전역에서 ctreg 로 쓴다
```

Node 없이 쓰려면 `npm run compile` 이 단독 실행파일 하나(`./ctreg`)를 만든다.
bun 이 필요하고 만든 컴퓨터의 플랫폼 전용이다.

</details>

### Claude Code 플러그인으로 쓰기

설치하면 Claude 가 임상시험 질문을 받았을 때 이 CLI 를 **스스로 몰아 쓴다.**

```
/plugin marketplace add kimmingul/ctreg
/plugin install ctreg@ctreg
```

**설치 없이도 동작한다.** 스킬은 `ctreg` 가 PATH 에 있으면 그것을 쓰고, 없으면
`npx -y @kimmingul/ctreg` 로 부른다 — 첫 호출에 몇 초 걸리고 그다음은 캐시된다.
터미널에서도 쓰거나 매번 빠르게 돌리고 싶으면 위의 `npm i -g @kimmingul/ctreg` 를 해 두면 된다.

**번들이나 바이너리를 저장소에 넣지 않은 것은 의도다.** 빌드 산출물을 커밋하면 누가 소스를
고치고 재빌드를 잊었을 때 **플러그인만 옛 코드를 조용히 실행한다** — npm 에는 새 코드가
있는데 플러그인이 뒤처지는, 이 저장소가 계속 잡아 온 실패 모양이다. npx 는 npm 이 가진
그 한 벌을 그대로 쓰므로 갈릴 것이 없다.

설치하면 **슬래시 커맨드 여섯**이 함께 붙는다:

| 커맨드 | |
| :-- | :-- |
| `/ctreg:all` | 다섯 레지스트리 전부 |
| `/ctreg:ctgov` · `/ctreg:isrctn` · `/ctreg:ctis` · `/ctreg:cris` · `/ctreg:ictrp` | 그곳만 |

`/ctreg:all` 은 **일부가 실패하는 것이 정상이다** — ICTRP 는 꺼져 있고 CRIS 는 키가 필요해서
그 둘은 신고되고 전체는 부분 성공으로 끝난다. 빼지 않는 것이 의도다: 빼면 사용자는 자기가
유럽이나 국내를 못 봤다는 것을 모른다.

터미널에서도 같은 것이 된다 — `ctreg search --registry all …`.

스킬이 얇은 것은 의도다. CLI 가 스스로 말할 수 있는 것(플래그, 커맨드 이름, 종료 코드)은
스킬에 적지 않고 `--help` 에게 미룬다 — 두 곳에 적으면 한쪽만 갱신되기 때문이다. 스킬에
담은 것은 **CLI 가 말하지 못하는 것**뿐이다: 종료 코드로 분기하라, 경고를 반드시 읽어라,
시험 상태와 병원 상태는 다르다, 범주별 건수를 더하지 마라.

---

## 5분 안에

### 무엇을 할 수 있는지부터

```bash
ctreg registries
```

다섯 레지스트리가 각각 어떤 축으로 검색되고 무엇을 못 하는지 그대로 낸다.
**네트워크를 타지 않으므로 공짜다.** 막히면 여기부터 본다.

### 조건으로 찾기

```bash
ctreg search --condition melanoma --status recruiting --page-size 3 --format text
```

```
[ctgov] ok — 총 482건, 표시 3건

CTGOV:NCT06398418  recruiting  phase_1  interventional
  R-5780-01 In Combination With PD-1 Checkpoint Inhibitors in Patients With Solid Tumors
  조건: Solid Tumor, Adult, Melanoma, Basal Cell Cancer, …
  중재: R-5780
  의뢰: Rise Therapeutics LLC · 등록 33명(estimated)
  기간: 2025-08-01 ~ 2027-12-31
  기관 2/2: Sarah Cannon Research Institute / Denver / United States, …
  https://clinicaltrials.gov/study/NCT06398418
```

### 연구자 이름으로 찾기

**해외 — ClinicalTrials.gov**

```bash
ctreg search --registry ctgov --investigator "Antoni Ribas" --page-size 2 --format text
```

```
[ctgov] ok — 총 18건, 표시 2건

CTGOV:NCT01902173  completed  phase_1, phase_2  interventional
  Uprosertib, Dabrafenib, and Trametinib in Treating Patients With Stage IIIC-IV Cancer
  의뢰: National Cancer Institute (NCI) · 등록 27명(actual)
  기간: 2013-10-08 ~ 2023-12-23
```

연구책임자와 책임당사자 연구자만 본다 — **연락담당으로만 올라간 사람은 걸리지 않는다.**

**국내 — CRIS**

CRIS 는 공식 API 에 사람 이름으로 거는 칸이 없다. 그래서 `--term` 으로 후보를 좁힌 뒤
**한 건씩 상세를 열어 연구책임자를 대조한다.** 그래서 `--term` 이 반드시 함께 있어야 한다.

```bash
ctreg search --registry cris --term "전북대학교병원" --investigator "김민걸" \
  --page-size 3 --format text
```

```
[cris] ok — 총 178건, 표시 11건

CRIS:KCT0012487  completed  interventional
  건강한 성인 자원자에서 비타민 C의 투여용량에 따른 약동학적 특성 및 안전성을 비교하기
  위한 무작위배정, 공개, 단회 투여, 평행 임상시험
  의뢰: 전북대학교병원 · 등록 18명(actual)
  기간: 2015-08-24 ~ 2025-10-26
  기관 1/1: 전북대학교병원 / Korea, Republic of
  연락처: 김민걸(연구책임자), Min-Gul Kim(연구책임자), 김민걸(연구실무담당자)
```

#### 한국어 이름을 영문 표기로 — CRIS 를 대조표로 쓴다

**로마자 표기는 하나가 아니고, 레지스트리는 등록된 표기 하나로만 걸린다.** 같은 사람인데
철자를 달리하면 결과가 이만큼 갈린다(실측):

| ctgov `--investigator` | 결과 |
| :-- | --: |
| `Sung-Bae Kim` | 9건 |
| `Sung Bae Kim` | 9건 |
| `Sungbae Kim` | **1건** |

추측한 철자로 나온 0건은 "그런 연구가 없다" 로 읽히지만 실제로는 **철자가 틀린 것**이다.

**CRIS 가 그 대조표다.** 국문과 영문을 나란히 싣기 때문에, 한국어로 한 번 물어서 **본인이
등록한 영문 표기**를 읽어 올 수 있다 — 사람 이름만이 아니라 기관·제목·중재까지:

```bash
ctreg get CRIS:KCT0012487 --raw --format json | jq '.data[0].source
  | {scientific_name_kr, scientific_name_en, scientific_title_en, i_freetext_en}'
```

```json
{
  "scientific_name_kr": "김민걸",
  "scientific_name_en": "Min-Gul Kim",
  "scientific_title_en": "A Randomized, Open-label, Single-dose, Parallel Clinical Trial…",
  "i_freetext_en": "Participants will be randomized 1:1:1 to three dose groups…"
}
```

정규화된 레코드에도 이미 담겨 있다 — `officialTitle` 이 영문 제목이고, `contacts` 에는
국문·영문 이름이 **둘 다** 실린다. 플러그인의 스킬과 커맨드가 이 순서를 규율로 갖고 있어서,
한국어로 물으면 알아서 이 경로를 탄다.

> **전수가 아니다.** 후보가 **검색어가 닿는 범위에 갇힌다** — 검색어 하나로는 크게 놓칠 수
> 있다(실측: 기관명 하나로 40건 중 12건, 검색어 여덟 개로 넓혀서야 40건). 여러 말로 나눠
> 조회하고 합쳐야 한다. 몇 건을 열어 봤는지는 경고로 말한다.

### 여러 레지스트리를 함께

```bash
ctreg search --registry ctgov --registry isrctn --registry ctis \
  --condition melanoma --page-size 1 --format text
```

```
[ctgov]  ok — 총 3748건
[isrctn] ok — 총 59건
[ctis]   ok — 총 178건
```

**`--registry all` 이 선언된 전부로 풀린다** — 다섯을 손으로 나열하지 않아도 된다.
어댑터가 늘면 자동으로 따라온다.

`--registry` 를 주지 않으면 **`ctgov` 하나만** 조회한다. 레지스트리가 늘어도 기존 호출의
동작이 조용히 바뀌지 않도록 기본값을 이름 붙인 하나로 고정해 뒀다.

### 시험 하나를 ID 로

```bash
ctreg get CTGOV:NCT06398418
ctreg get CRIS:KCT0012487 CTIS:2022-501417-31-00   # 여러 개 한 번에
```

**접두사가 필요하다.** `ICTRP:NCT07749586` 과 `CTGOV:NCT07749586` 은 같은 시험의 서로 다른
사본이고 이 도구는 둘을 합치지 않는다.

### 개수만, 결과 데이터만

```bash
ctreg count --condition "pancreatic cancer" --status recruiting
ctreg results CTGOV:NCT01902173          # 1차·2차 평가변수, 이상반응, 등록 흐름
```

---

## 레지스트리마다 할 수 있는 것이 다르다

| | 검색 축 | 설정 | 결과 데이터 |
| :-- | --: | :-- | :-- |
| **ctgov** ClinicalTrials.gov | 18 | 없음 | ✅ |
| **isrctn** ISRCTN | 10 | 없음 | ❌ 논문·PDF 뿐 |
| **ctis** EU CTIS | 5 | 없음 | ❌ 요약 PDF 뿐 |
| **cris** CRIS (한국) | 2 | 인증키 | ❌ |
| **ictrp** WHO ICTRP | 8 | **기본 꺼짐** | ❌ |

**셋은 아무 설정 없이 바로 된다.** 능력이 같지 않다는 것을 표가 그대로 보여준다 —
`ctreg registries` 가 축마다 받는 값 목록까지 낸다. 부딪혀서 알 필요가 없다.

<details>
<summary><b>ISRCTN</b> — 상태로 못 거르고, 페이지 넘김이 없다</summary>

| 못 하는 것 | 왜 |
| :-- | :-- |
| `--status` | API 문서에 값 목록이 있는데 **모든 값이 0건** 이다. 레코드에는 상태가 실려 나오므로 받아 보고 거르는 것은 된다 |
| `--start-after` / `--start-before` | 시작일 필터가 **조용히 무시된다**(`GE 2050` 도 전체를 낸다). 갱신일·종료일은 정상 동작한다 |
| `--location` / `--near` | 장소 검색 축이 없다. 레코드의 장소는 **모집 국가** 단위다 |
| `--id` / `--patient` / `--lead` | 해당 축이 없다. ID 조회는 `ctreg get ISRCTN:ISRCTN12345678` 로 된다 |
| `ctreg results` | 결과가 논문 링크와 첨부 PDF 다. `ctreg get --raw` 로 원문을 볼 수 있다 |

같은 축이라도 **받는 값이 다르다.** phase 어휘에 `early_phase_1` 자리가 없고 studyType 에
`expanded_access` 가 없다.

**페이지 넘김이 없다.** 매칭이 받은 것보다 많으면 `no_pagination` 경고가 붙는다 —
`--page-size` 를 올리거나(최대 200) 기간을 쪼개는 것 말고 이어받을 방법이 없다.

`npm run isrctn-field-test` 로 대조할 수 있다.
</details>

<details>
<summary><b>EU CTIS</b> — 조건이 하나 이상 필요하다</summary>

유럽 등재 **12,300여 건**. 인증도 비용도 없다. EMA 법적 고지가 상업·비상업 재생산을 모두
허용하고 조건은 **출처 표시 하나**라, 이 레지스트리의 레코드에는 `attribution` 필드가 붙는다
— 약관이 *"included in **each copy**"* 를 요구해서 봉투가 아니라 **레코드마다** 싣는다.

**이 API 는 모르는 검색 키를 조용히 버린다.** 있지도 않은 키를 보내도 전체 건수가 그대로
온다. 그래서 실제로 거르는 것만 신고했다.

| 되는 것 | 못 하는 것 |
| :-- | :-- |
| `--term` `--title` `--condition` `--sponsor` `--location` | `--phase` `--status` `--intervention` `--id` · 날짜 축 · `ctreg results` |

- **`--location` 은 EU·EEA 회원국 이름만 받는다**(28개국). 이 API 는 나라를 ISO 숫자 코드로
  받고 이름이나 알파벳 코드에는 0건을 내주므로, 코드표를 기억으로 적지 않고 코드마다 보내 본
  뒤 돌아온 나라로 확정했다. 표에 없는 이름은 exit 3 으로 막고 아는 이름을 제안한다.
- **조건 없이 검색하면 exit 3 이다.** 전체 첫 쪽이 돌아오면 사용자는 자기 질의가 통한 줄 안다.
- **상태는 대부분 `unknown` 이다.** 숫자 코드 중 둘만 뜻을 확정했다(`Ended`, `Not authorised`).
  나머지 넷은 API 의 어느 자리에서도 전부 `Authorised` 로 나와 갈리지 않는다 — 짐작해서 접으면
  모집 전인 시험이 모집 중으로 읽힌다.
- **`ctreg results` 는 안 되지만 결과 유무는 알려준다.** 결과가 제출 요약 PDF 라 구조화할 수
  없다. 대신 레코드의 `hasResults` 로 유무가 온다(실측 500건 중 10.8% 보유, 전부 종료된 시험).

`npm run ctis-field-test` 로 대조할 수 있다.
</details>

<details>
<summary><b>CRIS(한국)</b> — 인증키가 필요하다</summary>

질병관리청 임상연구정보서비스. 국내 등재 **12,500여 건**.

자동 조회로 허락된 문은 **공공데이터포털의 공식 OpenAPI 하나**뿐이다.
[질병관리청_임상연구 DB](https://www.data.go.kr/data/3033869/openapi.do) 에서 활용신청
(자동승인·무료)하고 받은 **Decoding 키**를 `CTREG_CRIS_SERVICE_KEY` 에 넣는다
(`.env` 로 줘도 된다 — `.env.example` 참고). Encoding 키를 넣으면 두 번 인코딩돼 인증이
실패한다. 키가 없으면 이 레지스트리만 exit 4 로 말하고 나머지는 그대로 동작한다.

**이 어댑터의 신고는 거의 전부 `false` 다. 그것이 정직한 모습이다.** 공식 API 가 받는 검색
입력은 자유 텍스트 하나뿐이고 목록이 내주는 항목은 16개다. CRIS 화면에는 질환·중재·연구책임자
칸이 다 있지만 **그 화면 뒤의 엔드포인트는 `robots.txt` 가 막는다** — 여기 적힌 `false` 는
"CRIS 가 못 한다" 가 아니라 **"허락된 문으로는 못 묻는다"** 다.

| 못 하는 것 | 왜 |
| :-- | :-- |
| `--condition` · `--intervention` · `--sponsor` | 공식 API 에 그 필터가 없다. 그 말을 `--term` 에 담으면 제목·기관에 걸리는 만큼만 걸린다 |
| `--status` · `--phase` | 목록 16항목에 없다. `search` 가 낸 레코드의 status 는 `unknown` 이고 그것은 사실이다 |
| `ctreg results` | 연구결과가 CRIS 에 등록돼 있어도 **공개 API 가 내주지 않는다** — 오퍼레이션이 목록·상세 둘뿐이고 결과 항목이 없다 |

`ctreg get` 은 상세 조회를 쓰므로 `search` 보다 두껍다 — 진짜 모집현황, 목표대상자 수,
연구책임자(국문·영문)까지 온다.

`npm run cris-field-test` 로 대조할 수 있다.
</details>

<details>
<summary><b>WHO ICTRP</b> — 기본으로 꺼져 있다</summary>

**먼저 알아야 할 것은 능력이 아니라 접근 조건이다.** ICTRP 검색 화면은 `robots.txt` 가 자동
접근을 막고(`Disallow: /`), WHO 가 내놓은 두 서비스(Web Service, Crawling Service)는 **둘 다
사무국과의 합의와 비용을 요구한다** — 이용 조건이 "an **agreed partner** website" 라고 못박는다.

그래서 **기본값이 꺼짐**이고, 부르면 exit 3 과 함께 무엇을 해야 하는지(`ictrpinfo@who.int`,
켜는 법)를 말한다. 기능을 지우지는 않았다 — 합의가 있는 사용자에게서 뺏을 이유가 없다.
`CTREG_ICTRP_ACKNOWLEDGED` 에 아무 값이나 넣으면 동작한다.

켠 뒤에도 알아야 할 것:

- **집계 사본이다.** 약 20개국 등록기관을 수확해 모은 것이라 다른 어댑터로는 존재조차 알 수
  없는 시험이 걸린다. 대신 원본보다 **약 7일 뒤처진다**(표본 2건 실측).
- **`--location` 은 나라 단위이고 포털 표기만 받는다.** `Korea, Republic of` 는 되고
  `South Korea` 는 exit 3 이다 — 비표준 표기는 오류도 0건도 아니라 **조용히 좁혀진 수**를
  낸다(실측: 94건 vs 713건).
- **`--status` 는 `recruiting` 하나만 걸린다.** 포털이 "모집중만" 과 "전부" 둘만 구분한다.
- **페이지 크기가 10 으로 고정이다.** `--page-size 3` 을 줘도 10건이 오고 `page_size_floor`
  경고가 두 숫자를 함께 말한다.
- **`total` 과 페이지가 세는 단위가 다르다.** `40635 records for 36264 trials` — 봉투의
  `total` 은 시험 수, 페이지는 레코드 위를 걷는다. 페이지를 다 더하면 `total` 보다 약 12% 많다.
- **`search` 와 `get` 의 충실도가 다르다.** 검색 화면은 모집상태·ID·제목·등록일 넷만 싣고,
  레코드 화면은 WHO TRDS 24항목을 싣는다. 같은 시험을 두 경로로 받으면 `status` 가 다를 수
  있고 그것은 오류가 아니다.
- **비상업 용도로만** 쓸 수 있고 인용 시 출처를 WHO ICTRP 로 표기해야 한다. ICTRP 가 사본을
  수확한 날은 `sourceRefreshedAt` 에 담긴다(약관이 요구하는 "데이터를 처리한 날짜").

`npm run ictrp-field-test` 로 대조할 수 있다.
</details>

---

## 출력 읽는 법

### 형식

`--format json`(기본) · `ndjson` · `text`

- **json** — 봉투 전체를 담은 JSON 한 덩어리
- **ndjson** — 레코드를 한 줄에 하나씩 낸 뒤 **마지막 줄에 항상 `_meta`** 를 붙인다.
  경고가 없어도 빠지지 않는다 — 소비자는 "마지막 줄은 언제나 메타" 하나만 알면 된다
- **text** — 사람이 읽는 요약

**stdout 은 성공이든 실패든 항상 파싱 가능한 봉투를 낸다.** 사용법 오류도 예외가 아니다.
파이프로 쓸 때는 `2>/dev/null` 을 붙인다 — stderr 가 섞이면 JSON 이 깨진다.

```bash
ctreg search --condition melanoma --page-size 5 --format json 2>/dev/null | jq '.data[].title'
```

### 종료 코드 — 이걸로 분기한다

| exit | 뜻 |
| --: | :-- |
| `0` | 정상. **결과 0건도 0이다** — "그런 시험이 없다" 는 정상 응답이지 오류가 아니다 |
| `2` | 인자가 잘못됐다 (모르는 플래그, 잘못된 값, 배타적 조합) |
| `3` | **그 레지스트리가 그렇게 물어볼 수 없다.** 빈 결과와 구분해야 한다 |
| `4` | 업스트림 호출이 실패했다 (네트워크, 5xx, 타임아웃) |
| `5` | 여러 레지스트리 중 일부만 성공했다 |

여럿을 조회할 때는 레지스트리별 상태를 하나로 접는다: 전부 ok 면 0, 하나라도 ok 면 5,
전부 unsupported 면 3, 그 외는 4.

**축이 아니라 그 축의 *값*이 미지원인 경우도 exit 3 이다.** `--status`·`--phase`·`--study-type`
에 그 레지스트리가 안 받는 값을 주면 **조회를 보내기 전에** 멈춘다. 사용자에게는 같은 사실이기
때문이다 — 결과가 없는 게 아니라 그렇게 물어볼 수 없다.

### 경고를 반드시 읽어라

이 도구는 조용히 좁히거나 자르지 않는다. 대신 봉투에 경고를 남긴다 —
`locations_truncated`(장소가 잘렸다), `no_pagination`(더 있는데 이어받을 수 없다),
`page_size_clamped`, `zero_results_scope`(0건인데 그 축이 무엇을 보는지) 등.
**경고를 읽지 않으면 잘린 목록을 전체로, 좁혀진 검색을 완전한 검색으로 오독한다.**

---

## 환경변수

| 변수 | 기본값 | 뜻 |
| :-- | :-- | :-- |
| `CTREG_CRIS_SERVICE_KEY` | (없음) | **CRIS 인증키.** Decoding 키를 넣는다 |
| `CTREG_ICTRP_ACKNOWLEDGED` | (없음 = **꺼짐**) | **ICTRP 를 켠다.** 합의가 있을 때만 |
| `CTREG_CACHE_DIR` | `~/.cache/ctreg` | 캐시와 프로세스 간 요청률 버킷이 사는 곳 |
| `CTREG_CACHE_TTL_SEC` | `3600` | 캐시 유효 시간(초) |
| `CTREG_TIMEOUT_MS` | `30000` | 업스트림 타임아웃 |
| `CTREG_MAX_RETRIES` | `3` | 재시도 횟수 |
| `CTREG_RATE_PER_SEC` | (없음) | 전역 오버라이드. 미설정이면 **레지스트리가 스스로 신고한 요청률**을 쓴다 |
| `CTREG_*_BASE_URL` | 각 공식 주소 | 엔드포인트 교체(테스트·미러용) |

비밀값은 셸 환경변수 대신 **`.env` 파일**로 줄 수 있다. 두 자리를 보고, **가까운 것이 이긴다:**

| 순서 | 자리 | 쓰임 |
| --: | :-- | :-- |
| 1 | 셸 환경변수 | 그때그때의 개입 |
| 2 | `./.env` | 이 프로젝트에서만 |
| 3 | `~/.config/ctreg/.env` (또는 `$XDG_CONFIG_HOME/ctreg/.env`) | **한 번 넣으면 어디서든** |

전역으로 설치해 아무 폴더에서나 쓰는 도구라면 **3번에 넣어라.** 작업 디렉터리마다 `.env` 를
만들 필요가 없다. `.env.example` 을 복사해 채우면 된다.

```bash
mkdir -p ~/.config/ctreg && cp .env.example ~/.config/ctreg/.env
```

**이미 있는 환경변수는 덮지 않는다** — 다른 키로 한 번 돌려 보는 일이 설정 파일을 고쳤다
되돌리는 일이 되지 않게 하려는 것이다.

캐시를 끄거나 갱신할 때는 플래그를 쓴다: `--no-cache`, `--refresh`(둘은 함께 못 쓴다).

---

## 도움말

```bash
ctreg --help
ctreg search --help      # 커맨드마다 따로 있다
ctreg registries         # 무엇을 물어볼 수 있는지
ctreg --version          # 지금 도는 것이 어느 사본인지
```

**`--version` 은 문제가 생겼을 때 먼저 본다.** 전역 설치본과 `npx` 본, 소스 빌드본이
섞일 수 있어서 "무엇이 도는가" 가 실제 물음이 된다 — 셋 다 같은 값을 낸다.

---

## 라이선스와 출처

`ctreg` 는 **Apache-2.0** 으로 배포된다. `src/adapters/ctgov/` 와 `src/runtime/http.ts` 의
일부는 [`clinicaltrialsgov-mcp-server`](https://github.com/cyanheads/clinicaltrialsgov-mcp-server)
(Copyright Casey Hand / cyanheads, Apache-2.0)에서 유래했다 — 이식한 파일에 출처 주석이 있다.
패키지에 `LICENSE` 전문과 `NOTICE` 귀속 고지가 함께 실린다.

각 레지스트리의 데이터에는 그쪽의 조건이 따로 붙는다:

- **EU CTIS** — EMA 를 출처로 표기해야 한다. 레코드마다 `attribution` 필드로 실린다
- **WHO ICTRP** — 비상업 용도로만. 인용 시 WHO ICTRP 출처 표기
- **ClinicalTrials.gov** — 미국 국립의학도서관(NLM)이 운영한다.
  이 프로젝트는 NLM/NIH 와 제휴하거나 그 후원을 받지 않는다
