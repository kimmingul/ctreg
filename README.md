# ctreg

`ctreg` 는 전 세계 임상시험 레지스트리를 하나의 정규화된 스키마로 조회하는 CLI 도구다. 레지스트리마다 다른 상태값, 단계, 연구 유형 표기를 폐쇄 어휘(closed vocabulary)로 정규화해 일관된 필터링과 조회를 제공한다. 사람이 직접 쓸 수도 있고, 에이전트/스킬이 stdout 을 파싱해 조립하는 파이프라인 부품으로 쓸 수도 있게 설계했다.

> **이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.**
>
> `ctreg` 는 레지스트리가 게시한 내용을 그대로 정규화해 보여줄 뿐이다. 어떤 필드가 비어 있는 것은 "그런 사실이 없다"가 아니라 "이 레지스트리가 그 항목을 기재하지 않았다"는 뜻일 수 있다 — 이 둘을 구분하기 위해 이 도구는 실패와 미지원을 빈 결과와 절대 섞지 않는다(아래 exit code 참고). 환자를 특정 시험에 적격/부적격으로 판정하는 데 이 출력을 직접 쓰지 마라.

## 이 슬라이스의 범위

- **지원 레지스트리는 ClinicalTrials.gov(`ctgov`) 하나뿐이다.** `ctreg registries` 를 실행하면 각 어댑터(지금은 ctgov 하나)가 스스로 신고하는 capability — 어떤 검색 축·상세 섹션·결과 데이터를 지원하는지, 페이지 크기/요청률/배치 상한이 얼마인지 — 를 그대로 볼 수 있다. 두 번째 레지스트리가 붙어도 이 커맨드로 능력 차이를 알 수 있게 설계했다.
- **`--near` 는 좌표(`위도,경도`)만 받는다. 지명은 받지 않는다.** 이 슬라이스에는 지오코더가 없다. "서울 근처"를 찾고 싶으면 위도/경도를 직접 구해서 넣어야 한다(예: `--near 37.5665,126.978`).

## 설치

npm 배포판은 아직 없다. 소스에서 빌드해서 쓴다 (Node.js ≥ 22 필요):

```bash
git clone <repo-url> ctreg
cd ctreg
bun install   # 또는 npm install
bun run build # dist/ 를 만든다
node dist/cli/bin.js registries   # 동작 확인
```

전역에서 `ctreg` 로 쓰고 싶으면:

```bash
npm link   # package.json 의 bin.ctreg 가 dist/cli/bin.js 를 가리킨다
ctreg registries
```

이 문서의 예시는 전역 설치를 가정해 `ctreg ...` 로 적는다. 소스에서 바로 실행할 때는 `node dist/cli/bin.js ...` 로 바꿔 읽으면 된다.

## 빠른 시작

```bash
# 이 CLI 가 다룰 수 있는 레지스트리와 그 능력을 확인한다 (네트워크를 전혀 타지 않는다)
ctreg registries

# 모집 중인 비소세포폐암 3상 시험을 3건 찾는다
ctreg search --condition "non-small cell lung cancer" --status recruiting --phase phase_3 --page-size 3

# 특정 시험을 ID 로 바로 가져온다
ctreg get CTGOV:NCT04280705

# 그 시험의 결과 데이터(1차/2차 평가변수)를 가져온다
ctreg results CTGOV:NCT04280705 --section outcomes

# 조건에 맞는 시험 개수만 필요할 때
ctreg count --condition melanoma --status recruiting
```

## 커맨드

모든 커맨드는 JSON 봉투(envelope)를 stdout 에 낸다. 형식은 `{ query, registries, warnings, data, error? }` 이고, 실패해도 이 형태는 깨지지 않는다 — 파싱 자체가 실패하는 경우는 없다(아래 "출력 형식" 참고).

### `ctreg search` — 조건에 맞는 시험을 찾는다

```bash
ctreg search --condition "non-small cell lung cancer" --status recruiting --page-size 3
```

```json
{
  "query": { "condition": "non-small cell lung cancer", "status": ["recruiting"], "pageSize": 3 },
  "registries": [
    { "registry": "ctgov", "status": "ok", "returned": 3, "total": 1304,
      "nextPageToken": "ZVt07cGHkvI2wRk2CJf6_LLtipDWMc8od7KrgP4TnjmQtA" }
  ],
  "warnings": [
    { "code": "locations_truncated", "message": "장소 86곳 중 10곳만 담았습니다.", "id": "CTGOV:NCT06300177", "at": 10 }
  ],
  "data": [ { "id": "CTGOV:NCT06999187", "registry": "ctgov", "registryId": "NCT06999187", "title": "…", "status": "recruiting", "…": "…" } ]
}
```

다음 페이지는 `--page-token`(`nextPageToken` 값)으로 이어 받는다. 검색 축(`--condition`, `--intervention`, `--term`, `--title`, `--location`, `--outcome-query`, `--sponsor`, `--lead`, `--id`, `--patient`)은 하나 이상 조합해서 쓸 수 있고, 필터(`--status`, `--phase`, `--study-type`, 날짜 범위, `--near`/`--radius`)는 그 위에 덧씌운다.

**`--near` 는 시험을 거르지, 사이트를 거르지 않는다.** `--near`(+ 기본/지정 `--radius`)는 "반경 안에 사이트가 하나라도 있는 시험"을 매칭 조건으로 쓴다. 매칭에 성공한 시험이라도 레코드에 실리는 `locations` 배열은 그 시험의 전체 사이트 목록(상한까지 자르고 `locationsTotal` 로 진짜 개수를 남긴다)이지, 반경 안의 사이트만 남긴 목록이 아니다 — 예를 들어 서울 근처로 검색해도 그 시험이 해외에서도 모집 중이면 대만·미국·스페인 사이트가 함께 나온다. 각 사이트는 `distanceKm` 을 갖고 가까운 순으로 정렬되므로, 목록 맨 위가 검색 반경에 실제로 걸린 사이트다 — "이 근처에서 모집하는 시험이 있다"와 "이 시험은 이 근처에서만 모집한다"는 다른 사실이니 혼동하지 마라.

**`--location`(장소 이름으로 시험을 거르는 축)도 같은 원리다.** `locations` 배열은 일치하는 사이트가 먼저 오도록 정렬된다 — 이 정렬은 **상한을 넘어 잘릴 때만이 아니라 `--location` 을 쓰면 항상 일어난다**(장소가 10곳 이하라도 마찬가지다). 자르는 건 그 다음 별개 단계다: 정렬된 목록에서 상한까지만 남기고 나머지는 `locations_truncated` 경고로 알린다. `--near` 와 `--location` 을 같이 주면 둘 다 결과를 좁힌 근거이므로 일치하는 사이트를 앞에, 그 안에서 가까운 순으로 둔다.

일치 판정은 **도시명만 보지 않는다** — 시설명·도시·주(州)·국가를 전부 부분 문자열로 대조한다. 그래서 `--location Seoul` 은 시설명에 "Seoul" 이 들어간 사이트도 끌어올린다. 실제로 **성남시 소재** "Seoul National University Bundang Hospital" 이 이렇게 걸린다 — 버그가 아니라 의도된 동작이다(필터에 걸린 근거를 앞에 두는 것이 목적이고, 시설명 일치도 그 근거 중 하나다). 결과를 도시 단위로 정확히 좁히고 싶다면 매칭된 사이트의 `city`/`state` 필드를 직접 확인하라.

### `ctreg get` — ID 로 시험 레코드를 바로 가져온다

```bash
ctreg get CTGOV:NCT04280705
# 여러 개를 한 번에
ctreg get CTGOV:NCT04280705 CTGOV:NCT02434107 --include eligibility
```

ID 는 `<레지스트리>:<원문 ID>` 형태다(`CTGOV:NCT01234567`). 여러 레지스트리의 ID 를 섞어 넣으면 각자 자기 어댑터로 라우팅되고, 알아보지 못하는 접두사는 그 ID 만 `id_unroutable` 경고로 남고 나머지는 정상 처리된다.

### `ctreg results` — 결과 데이터(1차/2차 평가변수, 이상반응, 등록 흐름, 기저치)

```bash
ctreg results CTGOV:NCT04280705 --section outcomes
# 특정 평가변수만 펼쳐서 보고 싶을 때
ctreg results CTGOV:NCT04280705 --section outcomes --outcome "overall survival" --full
```

`--section` 을 생략하면 `outcomes`, `adverse`, `flow`, `baseline` 네 섹션 전부를 요약으로 낸다. 기본은 요약(개수만)이고, `--outcome`/`--ae-organ`/`--ae-term` 으로 좁히거나 `--full` 로 전체를 펼칠 수 있다. 레지스트리가 애초에 결과 데이터를 신지 않으면 빈 결과가 아니라 exit 3(미지원)을 낸다 — "이 시험은 이상반응이 없었다"와 "이 레지스트리는 이상반응 데이터를 아예 신지 않는다"는 다른 사실이기 때문이다.

### `ctreg count` — 개수만 필요할 때

```bash
ctreg count --condition melanoma --status recruiting
```

```json
{ "query": { "condition": "melanoma", "status": ["recruiting"] },
  "registries": [ { "registry": "ctgov", "status": "ok", "total": 482 } ],
  "warnings": [], "data": { "total": 482 } }
```

`search` 와 같은 검색 축·필터를 받지만 레코드를 내려받지 않아 빠르다.

### `ctreg registries` — 이 CLI 가 다룰 수 있는 레지스트리와 능력

```bash
ctreg registries
```

```json
{ "query": { "registries": ["ctgov"] },
  "registries": [ { "registry": "ctgov", "status": "ok" } ],
  "warnings": [],
  "data": [ {
    "key": "ctgov", "name": "ClinicalTrials.gov", "region": "US / global",
    "search": { "condition": true, "intervention": true, "…": "…", "geo": true },
    "detail": { "eligibilityText": true, "outcomes": true, "contacts": true },
    "results": true, "count": true,
    "limits": { "maxPageSize": 200, "ratePerSec": 1, "maxBatchIds": 50 }
  } ]
}
```

**네트워크를 전혀 타지 않는다.** 어댑터가 스스로 신고하는 정적 capability 를 그대로 반환하므로, 검색을 조립하기 전에 먼저 호출해 어떤 축을 쓸 수 있는지 확인하는 용도로 안전하게 쓸 수 있다.

## 출력 형식

`--format json`(기본) · `ndjson` · `text` 세 가지를 지원한다.

- **json**: 봉투 전체를 예쁘게 출력한 JSON 한 덩어리.
- **ndjson**: 데이터 레코드를 한 줄에 하나씩 낸 뒤, **항상 마지막 줄에 `{"_meta": true, "query", "registries", "warnings", "error"?}` 한 줄을 붙인다.** 경고가 하나도 없어도 이 메타 줄은 빠지지 않는다 — 소비자는 "마지막 줄은 언제나 메타"라는 규칙 하나만 알면 된다.
- **text**: 사람이 읽기 위한 요약(레지스트리 상태, 레코드 제목/상태, 경고 메시지).

**stdout 은 성공이든 실패든 항상 파싱 가능한 봉투를 낸다.** 사용법 오류나 커맨드 인식 실패도 예외가 아니다 — `error` 필드가 채워진 같은 형태의 봉투가 나온다. 사용법 오류는 사람이 읽도록 stderr 로도 한 번 더 낸다.

## Exit code

플러그인/스킬이 분기할 계약이다. `src/cli/exit-codes.ts` 에 고정되어 있다.

| exit | 이름 | 의미 |
| :-- | :-- | :-- |
| `0` | OK | 정상 완료. **결과 0건도 0이다** — "그런 시험이 없다"는 정상 응답이지 오류가 아니다. |
| `2` | USAGE | 인자 자체가 잘못됐다(모르는 플래그, 잘못된 값, 서로 배타적인 옵션 조합 등). |
| `3` | UNSUPPORTED | 요청한 레지스트리가 그 검색 축/섹션/결과 데이터를 애초에 지원하지 않는다. 빈 결과와 구분해야 한다. |
| `4` | UPSTREAM | 업스트림 API 호출이 실패했다(네트워크, 5xx, 타임아웃 등). |
| `5` | PARTIAL | 여러 레지스트리를 조회했는데 일부는 성공하고 일부는 실패/미지원이다. |

여러 레지스트리를 동시에 조회할 때(`--registry` 반복)는 레지스트리별 상태를 모아 하나의 종료 코드로 접는다: 전부 `ok` 면 0, 하나라도 `ok` 면 5, 전부 `unsupported` 면 3, 그 외(하나라도 `error`)는 4.

## 환경변수

| 변수 | 기본값 | 의미 |
| :-- | :-- | :-- |
| `CTREG_CACHE_DIR` | `$XDG_CACHE_HOME/ctreg` (없으면 `~/.cache/ctreg`) | 온디스크 캐시와 프로세스 간 요청률 제한 버킷이 사는 위치. 여러 프로세스가 동시에 떠도 이 디렉터리를 공유하면 요청률이 함께 지켜진다. |
| `CTREG_CACHE_TTL_SEC` | `3600` | 캐시 항목의 유효 시간(초). |
| `CTREG_TIMEOUT_MS` | `30000` | 업스트림 HTTP 요청 타임아웃(밀리초). |
| `CTREG_MAX_RETRIES` | `3` | 업스트림 요청 실패 시 재시도 횟수. |
| `CTREG_RATE_PER_SEC` | (미설정) | 전역 오버라이드. **미설정이면 각 레지스트리가 스스로 신고한 요청률**(`ctreg registries` 의 `limits.ratePerSec`, ctgov 는 1 req/s)**을 쓴다** — 레지스트리마다 예산이 다를 수 있어서다. 이 값을 주면 모든 레지스트리에 그 값 하나를 강제한다(공유 네트워크에서 다같이 늦추거나, 특별 허가로 다같이 올리거나). 올리기 전에 업스트림의 실제 정책을 확인하라. |
| `CTREG_CTGOV_BASE_URL` | `https://clinicaltrials.gov/api/v2` | ctgov 어댑터가 호출할 API 베이스 URL. 테스트나 미러 대상 전환에 쓴다. |

캐시/요청률 제한을 끄거나 우회하고 싶을 때는 환경변수 대신 커맨드 플래그를 쓴다: `--no-cache` (이번 호출은 캐시를 아예 쓰지 않는다), `--refresh` (캐시를 갱신하며 조회한다). 둘은 함께 쓸 수 없다.

## 업스트림 출처와 라이선스

`ctreg` 는 Apache-2.0 으로 배포된다. `src/adapters/ctgov/` 와 `src/runtime/http.ts` 의 일부는 [`clinicaltrialsgov-mcp-server`](https://github.com/cyanheads/clinicaltrialsgov-mcp-server)(Copyright Casey Hand / cyanheads, Apache-2.0)에서 유래했다 — 이식한 파일에는 출처를 남긴 주석이 있다. 패키지에는 `LICENSE`(Apache License 2.0 전문)와 `NOTICE`(귀속 고지)가 함께 실린다. ClinicalTrials.gov 는 미국 국립의학도서관(NLM)이 운영하는 레지스트리이며, 이 프로젝트는 NLM/NIH 와 제휴하거나 그 후원을 받지 않는다.
