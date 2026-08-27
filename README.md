# ctreg

`ctreg` 는 전 세계 임상시험 레지스트리를 하나의 정규화된 스키마로 조회하는 CLI 도구다. 레지스트리마다 다른 상태값, 단계, 연구 유형 표기를 폐쇄 어휘(closed vocabulary)로 정규화해 일관된 필터링과 조회를 제공한다. 사람이 직접 쓸 수도 있고, 에이전트/스킬이 stdout 을 파싱해 조립하는 파이프라인 부품으로 쓸 수도 있게 설계했다.

> **이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.**
>
> `ctreg` 는 레지스트리가 게시한 내용을 그대로 정규화해 보여줄 뿐이다. 어떤 필드가 비어 있는 것은 "그런 사실이 없다"가 아니라 "이 레지스트리가 그 항목을 기재하지 않았다"는 뜻일 수 있다 — 이 둘을 구분하기 위해 이 도구는 실패와 미지원을 빈 결과와 절대 섞지 않는다(아래 exit code 참고). 환자를 특정 시험에 적격/부적격으로 판정하는 데 이 출력을 직접 쓰지 마라.

## 이 슬라이스의 범위

- **지원 레지스트리는 셋이다 — ClinicalTrials.gov(`ctgov`), ISRCTN(`isrctn`), WHO ICTRP(`ictrp`).** `ctreg registries` 를 실행하면 각 어댑터가 스스로 신고하는 capability — 어떤 검색 축·상세 섹션·결과 데이터를 지원하는지, 페이지 크기/요청률/배치 상한이 얼마인지 — 를 그대로 볼 수 있다. **셋의 능력은 같지 않다**(바로 아래 참고). `--registry` 를 주지 않으면 `ctgov` 하나만 조회한다 — 어댑터가 늘어도 기존 호출의 동작이 조용히 바뀌지 않도록 기본값은 이름 붙인 하나로 고정돼 있다.
- **`--near` 는 좌표(`위도,경도`)만 받는다. 지명은 받지 않는다.** 이 슬라이스에는 지오코더가 없다. "서울 근처"를 찾고 싶으면 위도/경도를 직접 구해서 넣어야 한다(예: `--near 37.5665,126.978`). 좌표를 제공하는 레지스트리는 ctgov 뿐이라 `--near` 는 ctgov 전용이다.

### ISRCTN 으로는 할 수 없는 것

ISRCTN 은 ctgov 가 하는 것을 전부 하지 못한다. **못 하는 것을 물으면 빈 결과가 아니라 exit 3 이 나온다** — "그런 시험이 없다" 와 "그렇게 검색할 수 없다" 는 다른 말이기 때문이다.

| 못 하는 것 | 왜 |
| :-- | :-- |
| `--status` | ISRCTN API 의 `trialStatus`·`recruitmentStatus` 는 문서에 값 목록까지 있지만 **모든 값이 0건** 이다. 레코드에는 상태가 실려 나오므로, 받아 보고 거르는 것은 된다. |
| `--start-after` / `--start-before` | `overallStartDate` 필터가 **조용히 무시된다** — `GE 2050` 도 레지스트리 전체를 낸다. 갱신일(`--updated-since`)과 종료일(`--completion-after`)은 정상 동작한다. |
| `--location` / `--near` | 자유 문자열 장소로 검색할 축이 없고 좌표도 없다. 레코드의 장소는 **모집 국가** 단위로 실려 나온다. |
| `--id` / `--patient` / `--lead` | 해당하는 검색 축이 없다. 시험 하나를 ID 로 가져오는 것은 `ctreg get ISRCTN:ISRCTN12345678` 로 된다. |
| `ctreg results` | ISRCTN 의 결과는 논문 링크와 첨부 PDF 이지 구조화된 평가변수·이상반응 데이터가 아니다. `ctreg get --raw` 로 원문을 볼 수 있다. |

같은 축이라도 **받는 값이 다르다.** ISRCTN 의 phase 어휘에는 `early_phase_1` 자리가
없고 studyType 에는 `expanded_access` 가 없다. `ctreg registries` 의 `search.<축>.values`
가 레지스트리별 목록을 그대로 낸다 — 부딪혀서 알 필요가 없다.

또 하나, **ISRCTN API 에는 페이지 넘김이 없다.** 매칭이 받은 것보다 많으면 `no_pagination` 경고가 붙는다 — `--page-size` 를 올리거나(최대 200) 기간을 쪼개 여러 번 조회하는 것 말고 이어받을 방법이 없다.

이 표는 추측이 아니라 실측이다. `bun run isrctn-field-test` 를 돌리면 신고한 축 전부를 실물 레지스트리에 대조해 `docs/isrctn-field-test-<날짜>.md` 로 남긴다.

### WHO ICTRP 로는 할 수 없는 것

`ictrp` 는 ctgov·ISRCTN 처럼 자기 데이터를 원본으로 갖는 레지스트리가 아니라, WHO 가 약 20개국의 등록기관(ctgov·ISRCTN·CTRI·DRKS·JPRN 등)을 모아 한곳에서 찾을 수 있게 수확해 둔 **집계 사본**이다. 그래서 다른 두 어댑터로는 존재조차 알 수 없는 시험까지 검색에 걸린다는 것이 강점이고, 그 대가로 아래는 못 한다 — 역시 exit 3 이다.

| 못 하는 것 | 왜 |
| :-- | :-- |
| `ctreg results` | ICTRP 는 구조화된 결과 데이터(평가변수·이상반응 표)를 애초에 신지 않는다. 결과 유무와 요약 링크만 있어 열지 않았다. |
| `ctreg get` 의 비용 | 배치 창구가 없어 **ID 하나당 요청 하나** 이고 요청률이 초당 1이라, 10개를 조회하면 10초쯤 걸린다. |
| `ctreg get` 이 못 찾는 것 | 레코드 화면이 **비어 있는 시험이 있다** — 200 을 내면서 내용이 하나도 없다. 표본 11건 중 2건이 그랬다. 이때는 레코드를 지어내지 않고 `not_found` 경고를 낸다. |
| `--location` | **나라 단위로만** 걸린다(도시·기관은 없다). 그리고 **포털이 가진 표기만** 받는다 — `Korea, Republic of` 는 되고 `South Korea` 는 exit 3 으로 거절되며 정확한 표기를 힌트로 알려준다. 관대하게 두지 않는 이유는 비표준 표기가 오류도 0건도 아니라 **조용히 좁혀진 수**를 내기 때문이다(실측: `South Korea` 94건 vs `Korea, Republic of` 713건). 나라를 쓰면 요청이 하나 는다 — 값을 검색에 반영하려면 `butAdd` 왕복이 필요하다. |
| `--status` 의 대부분의 값 | 포털은 "모집중만" 과 "전부" 둘만 구분한다. 그래서 걸리는 값은 `recruiting` 하나뿐이고, 그 밖의 상태(`completed`, `terminated` 등)로는 거를 수 없다 — 레코드 자체의 상태도 `recruiting` 아니면 `other` 로 뭉뚱그려 나오고(원문은 `statusRaw` 에 남는다), 그 값으로 필터를 걸면 exit 3 이다. |

페이지도 다르게 움직인다. **페이지 크기는 10으로 고정이고 검색 시점에 바꿀 수 없다** — 이 CLI 의 기본 페이지 크기는 20이라 아무 옵션 없이 `ctreg search --registry ictrp` 를 돌리면 `page_size_clamped` 경고가 늘 붙는다. 10보다 작게 달라고 해도 요청이 거절되지는 않는다 — WHO ICTRP 는 페이지 단위로만 결과를 내놓기 때문에(부분 페이지를 돌려줄 수 없다) 요청보다 **더 많이** 돌아온다: `--page-size 3` 을 줘도 `returned: 10` 이 오고, exit 0 에 `page_size_floor` 경고가 "3건을 요청했는데 10건이 돌아왔다"고 두 숫자를 함께 말해 준다. 그리고 ICTRP 는 커서를 주지 않기 때문에, **N 페이지째를 받으려면 검색을 처음부터 다시 몰아 N+1 번 요청한다** — `limits.ratePerSec` 를 1로 신고한 이유다.

**`total` 과 페이지가 세는 단위가 다르다.** ICTRP 결과 화면은 `40635 records for 36264 trials` 처럼 두 수를 함께 낸다 — 같은 시험이 여러 등록기관에 올라와 있으면 **레코드**는 여러 개, **시험**은 하나다. 봉투의 `total` 은 뒤쪽(시험 수)이고, 페이지는 앞쪽(레코드) 위를 걷는다. 그래서 `nextPageToken` 이 끊길 때까지 각 페이지의 건수를 더하면 `total` 보다 **많아진다**(위 실측 기준 약 12%). 둘 중 어느 쪽도 틀린 수가 아니라 세는 대상이 다른 것이고, ICTRP 가 그 둘을 합쳐 주지 않으므로 이 도구도 합치지 않는다.

**페이지에는 갈 수 있는 깊이가 있다.** 결과 화면의 페이저는 전체 목록이 아니라 링크 몇 개짜리 창이라, 그 너머로는 순차 postback 으로 갈 수 없다. 남은 레코드가 있어도 다음 페이지 링크가 없으면 `nextPageToken` 을 만들지 않고 `pagination_depth_limit` 경고로 왜 멈췄는지 말한다(exit 0). 창 밖의 페이지를 `--page-token` 으로 직접 요청하면 **exit 4** 로 멈춘다 — 예전에는 요청한 것과 다른 페이지(마지막 페이지이거나 20행짜리)가 경고 없이 나왔다. 깊이 파야 하는 질의는 조건·단계 필터로 나눠 조회한다.

**약관과 최신성.** WHO ICTRP 데이터는 비상업 용도로만 쓸 수 있고, 인용할 때는 출처를 WHO ICTRP 로 표기해야 한다. 또 이것은 실시간 원본이 아니라 **수확된 사본**이다 — 표본 2건으로 잰 결과 원본보다 약 7일 뒤처져 있었다.

**`search` 로 온 레코드와 `get` 으로 온 레코드는 충실도가 다르다.** 검색 결과 화면이 싣는 것은 모집상태·ID·제목·등록일 넷뿐이고, 레코드 화면(`get`)은 WHO TRDS 24항목을 싣는다. 가장 눈에 띄는 차이가 **상태**다 — 검색 경로에서는 화면이 `Recruiting`/`Not Recruiting` 둘로만 말하므로 그 밖은 전부 `other`(원문은 `statusRaw`)이지만, `get` 에서는 레지스트리가 신고한 값 그대로(`Completed`·`Pending`·`Not yet recruiting`…)가 온다. 같은 시험을 두 경로로 받으면 `status` 가 다를 수 있고, 그것은 도구의 오류가 아니라 화면이 싣는 정보의 차이다.

**ICTRP 가 사본을 수확한 날은 `sourceRefreshedAt` 에 담긴다** — `get` 경로에서만 채워진다(검색 화면에는 그 값이 없다). 이것은 **시험이 갱신된 날이 아니라** ICTRP 가 원 레지스트리에서 거둬 온 날이고, WHO ICTRP 이용 약관이 요구하는 "데이터를 처리한 날짜" 가 이 값이다.

**검색 결과 레코드가 얇다.** 검색 결과 화면이 애초에 싣는 것은 모집상태·ID·제목·등록일뿐이라, 좌표(`locations`)·조건(`conditions`)·등록 인원(`enrollment`) 같은 필드는 **언제나 비어 있다** — 이 레지스트리가 가끔 빠뜨리는 것이 아니라 그 정보를 실어 나르는 화면 자체가 없고, 어댑터도 그것을 지어내지 않는다.

**같은 시험이 두 ctreg id 를 가질 수 있다.** `CTGOV:NCT07749586` 과 `ICTRP:NCT07749586` 은 같은 시험을 각자의 어댑터로 가져온 서로 다른 사본이고, 이 도구는 둘을 묶거나 중복 제거하지 않는다 — ICTRP 로 찾은 시험의 ID 는 그 시험이 원본으로 등록된 레지스트리와 무관하게 언제나 `ICTRP:` 접두사를 붙여야 한다(접두사 없이는 추론되지 않는다).

이 절도 실측이다. `bun run ictrp-field-test` 를 돌리면 `docs/ictrp-field-test-<날짜>.md` 로 대조 결과를 남긴다.

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

# 두 레지스트리를 함께 조회한다 (한쪽이 못 하는 축이면 그쪽만 exit 3 으로 신고되고 exit 5 가 된다)
ctreg search --registry ctgov --registry isrctn --condition melanoma --page-size 2

# 특정 시험을 ID 로 바로 가져온다
ctreg get CTGOV:NCT04280705

# 그 시험의 결과 데이터(1차/2차 평가변수)를 가져온다
ctreg results CTGOV:NCT04280705 --section outcomes

# 조건에 맞는 시험 개수만 필요할 때
ctreg count --condition melanoma --status recruiting
```

## 커맨드

모든 커맨드는 JSON 봉투(envelope)를 stdout 에 낸다. 형식은 `{ query, registries, warnings, data, error? }` 이고, 실패해도 이 형태는 깨지지 않는다 — 파싱 자체가 실패하는 경우는 없다(아래 "출력 형식" 참고).

**`ctreg <커맨드> --help` 는 그 커맨드가 받는 것만 낸다.** `ctreg --help` 는 전체 사용법이다. 커맨드가 쓰지 않는 플래그를 주면 조용히 무시하는 대신 **exit 2** 로 멈추고, 그 커맨드가 받는 것을 함께 알려준다 — `get` 은 배치 조회라 `--page-size`·`--sort` 가 성립하지 않는 식이다.

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

> **`--full` 과 필터는 서로 다른 질문에 답한다.** `--full` 은 *요약하지 말라*, `--outcome`/
> `--ae-organ`/`--ae-term` 은 *무엇을 고를지* 를 정한다. 둘을 같이 주면 **필터가 이긴다** —
> `--full --ae-organ Cardiac` 은 심장 관련 이상반응만, 전부 전개해서 낸다. (예전에는
> `--full` 이 필터를 삼켜 전체를 냈고, 요청이 무시됐다는 신호가 없었다.)

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

**레지스트리를 둘 이상 세면 합계를 내지 않는다.** 한 시험이 여러 레지스트리에 등록될 수 있어(`crossIds` 가 존재하는 이유) 레지스트리별 총계를 더한 값은 시험 수가 아니기 때문이다. 그 자리는 `null` 이 되고 `totals_not_summable` 경고가 이유와 상한을 말한다 — 레지스트리별 수는 `registries[]` 에 그대로 있으므로, 합이 필요하면 무엇을 더하는지 알고 더하면 된다.

```json
{ "registries": [ { "registry": "ctgov", "status": "ok", "total": 24273 },
                  { "registry": "isrctn", "status": "ok", "total": 1118 } ],
  "warnings": [ { "code": "totals_not_summable", "message": "… 그 합 25391 은 합집합의 상한입니다 …" } ],
  "data": { "total": null } }
```

`data: { "total": null }`(더할 수 없다)과 `data: null`(아무 레지스트리도 세지 못했다)은 다른 사실이다.

### `ctreg registries` — 이 CLI 가 다룰 수 있는 레지스트리와 능력

```bash
ctreg registries
```

```json
{ "query": { "registries": ["ctgov", "isrctn", "ictrp"] },
  "registries": [ { "registry": "ctgov", "status": "ok" }, { "registry": "isrctn", "status": "ok" },
                  { "registry": "ictrp", "status": "ok" } ],
  "warnings": [],
  "data": [ {
    "key": "ctgov", "name": "ClinicalTrials.gov", "region": "US / global",
    "search": { "…": "…",
      "term": { "supported": true, "values": null, "exhaustive": null,
        "scope": "제목·조건·중재·요약을 아우르는 본문 전반의 자유 텍스트" },
      "status": { "supported": true,
        "values": ["recruiting", "not_yet_recruiting", "enrolling_by_invitation",
          "active_not_recruiting", "suspended", "terminated", "completed", "withdrawn"],
        "exhaustive": false,
        "scope": "시험 전체의 대표 상태 하나 — 사이트별 모집 상태가 아니다" },
      "phase": { "supported": true,
        "values": ["early_phase_1", "phase_1", "phase_2", "phase_3", "phase_4", "na"],
        "exhaustive": false,
        "scope": "시험이 신고한 단계. 여러 단계를 신고한 시험은 그 전부에 걸린다" },
      "…": "…" },
    "detail": {
      "eligibilityText": { "supported": true,
        "scope": "적격 기준 원문. --include eligibility 로 켠다" },
      "outcomes": { "supported": true,
        "scope": "평가변수 목록(측정 항목·시점). 결과 수치가 아니다" },
      "contacts": { "supported": true,
        "scope": "중앙 연락처. 사이트별 연락처는 locations 에 있다" } },
    "results": { "supported": true,
      "scope": "results 서브커맨드를 지원한다 — 결과 유무로 검색하는 것이 아니다" },
    "count": { "supported": true,
      "scope": "같은 필터로 건수만 받는다. 페이로드를 받지 않는다" },
    "limits": { "maxPageSize": 200, "ratePerSec": 1, "maxBatchIds": 50 }
  }, {
    "key": "isrctn", "name": "ISRCTN", "region": "UK / global",
    "search": { "…": "…",
      "term": { "supported": true, "values": null, "exhaustive": null,
        "scope": "본문 전반의 자유 텍스트" },
      "status": { "supported": false, "values": [], "exhaustive": null,
        "scope": "trialStatus·recruitmentStatus 가 문서에 값 목록까지 있으나 실측에서 전부 0건이다. 상태는 레코드에는 실려 나온다 — 받아 보고 거르는 것은 된다" },
      "phase": { "supported": true,
        "values": ["phase_1", "phase_2", "phase_3", "phase_4", "na"],
        "exhaustive": false,
        "scope": "ISRCTN 이 신고한 단계. early_phase_1 에 해당하는 값이 어휘에 없다" },
      "…": "…" },
    "detail": {
      "eligibilityText": { "supported": true,
        "scope": "포함·제외 기준을 하나의 본문으로 합쳐 낸다" },
      "outcomes": { "supported": true,
        "scope": "1차·2차 평가변수 문구. 결과 수치가 아니다" },
      "contacts": { "supported": true,
        "scope": "공개·과학 연락처" } },
    "results": { "supported": false,
      "scope": "ISRCTN 의 결과는 논문 링크와 첨부 PDF 다 — TrialResults 가 요구하는 구조화된 평가변수·이상반응·참가자 흐름·기저 특성이 아니다" },
    "count": { "supported": true,
      "scope": "default 포맷의 limit=0 응답에서 총계만 읽는다" },
    "limits": { "maxPageSize": 200, "ratePerSec": 1, "maxBatchIds": 10 }
  }, {
    "key": "ictrp", "name": "WHO ICTRP", "region": "global (집계)",
    "search": { "…": "…",
      "location": { "supported": false, "values": null, "exhaustive": null,
        "scope": "폼에 국가 입력칸(txtFreeCountry)이 있지만 실측 결과 죽어 있다 — 서로 다른 나라를 걸어도 무필터 기준선과 같은 수가 나왔다" },
      "status": { "supported": true, "values": ["recruiting"], "exhaustive": false,
        "scope": "모집중인지 아닌지 둘뿐이다 — 완료·중단·모집종료를 가려낼 수 없다" },
      "phase": { "supported": true,
        "values": ["early_phase_1", "phase_1", "phase_2", "phase_3", "phase_4"],
        "exhaustive": false,
        "scope": "Phase 0~4. na 자리가 없어 단계를 신고하지 않은 시험은 어디에도 안 걸린다" },
      "…": "…" },
    "detail": {
      "eligibilityText": { "supported": false, "scope": "검색 결과 화면에 없다" },
      "outcomes": { "supported": false, "scope": "검색 결과 화면에 없다" },
      "contacts": { "supported": false, "scope": "검색 결과 화면에 없다" } },
    "results": { "supported": false,
      "scope": "구조화된 결과 데이터를 싣지 않는다" },
    "count": { "supported": true,
      "scope": "결과 화면이 내는 시험 수(같은 시험의 여러 등록을 묶은 뒤의 수)" },
    "limits": { "maxPageSize": 10, "ratePerSec": 1, "maxBatchIds": 10 }
  } ]
}
```

`false` 를 읽는 것이 이 커맨드의 요점이지만, 이제 `true` 도 내용을 말한다 —
`values` 는 그 축이 받는 값 목록(자유 텍스트 축은 `null`), `exhaustive` 는 그 값들이
데이터를 다 덮는지, `scope` 는 그 축이 실제로 무엇을 보는지다. `results` 의 `scope` 가
"결과 유무로 검색하는 것이 아니다" 라고 적는 이유는 실제로 그렇게 오독됐기 때문이다.

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

**축이 아니라 그 축의 *값* 이 미지원인 경우도 exit 3 이다.** `capability` 가 받는 값 목록(`values`)을 신고한 축 — `--status`, `--phase`, `--study-type` — 에 그 목록 밖의 값을 주면 조회를 보내기 **전에** 멈춘다. 사용자에게는 축 미지원과 같은 사실이기 때문이다: 결과가 없는 게 아니라 그렇게 물어볼 수 없다.

이것은 ICTRP 를 붙이면서 생긴 변화이고 **기존 어댑터의 동작도 바꿨다.** `ctreg search --registry isrctn --phase early_phase_1` 은 예전에는 어댑터 안쪽(질의 조립)에서 `usage` 오류로 났고, 그것이 레지스트리별 봉투에 `status: "error"` 로 실려 exit 4(업스트림)로 접혔다 — 인자를 잘못 쓴 것이 업스트림 실패로 보고되던 셈이다. 지금은 가드가 먼저 잡아 `status: "unsupported"` 와 exit 3 으로 나가고, 어느 값을 이 레지스트리가 받는지를 힌트에 함께 적는다.

## 환경변수

| 변수 | 기본값 | 의미 |
| :-- | :-- | :-- |
| `CTREG_CACHE_DIR` | `$XDG_CACHE_HOME/ctreg` (없으면 `~/.cache/ctreg`) | 온디스크 캐시와 프로세스 간 요청률 제한 버킷이 사는 위치. 여러 프로세스가 동시에 떠도 이 디렉터리를 공유하면 요청률이 함께 지켜진다. |
| `CTREG_CACHE_TTL_SEC` | `3600` | 캐시 항목의 유효 시간(초). |
| `CTREG_TIMEOUT_MS` | `30000` | 업스트림 HTTP 요청 타임아웃(밀리초). |
| `CTREG_MAX_RETRIES` | `3` | 업스트림 요청 실패 시 재시도 횟수. |
| `CTREG_RATE_PER_SEC` | (미설정) | 전역 오버라이드. **미설정이면 각 레지스트리가 스스로 신고한 요청률**(`ctreg registries` 의 `limits.ratePerSec`, ctgov 는 1 req/s)**을 쓴다** — 레지스트리마다 예산이 다를 수 있어서다. 이 값을 주면 모든 레지스트리에 그 값 하나를 강제한다(공유 네트워크에서 다같이 늦추거나, 특별 허가로 다같이 올리거나). 올리기 전에 업스트림의 실제 정책을 확인하라. |
| `CTREG_CTGOV_BASE_URL` | `https://clinicaltrials.gov/api/v2` | ctgov 어댑터가 호출할 API 베이스 URL. 테스트나 미러 대상 전환에 쓴다. |
| `CTREG_ISRCTN_BASE_URL` | `https://www.isrctn.com` | isrctn 어댑터가 호출할 베이스 URL. ctgov 와 달리 경로에 버전이 없어 호스트까지만 담는다. |

캐시/요청률 제한을 끄거나 우회하고 싶을 때는 환경변수 대신 커맨드 플래그를 쓴다: `--no-cache` (이번 호출은 캐시를 아예 쓰지 않는다), `--refresh` (캐시를 갱신하며 조회한다). 둘은 함께 쓸 수 없다.

## 업스트림 출처와 라이선스

`ctreg` 는 Apache-2.0 으로 배포된다. `src/adapters/ctgov/` 와 `src/runtime/http.ts` 의 일부는 [`clinicaltrialsgov-mcp-server`](https://github.com/cyanheads/clinicaltrialsgov-mcp-server)(Copyright Casey Hand / cyanheads, Apache-2.0)에서 유래했다 — 이식한 파일에는 출처를 남긴 주석이 있다. 패키지에는 `LICENSE`(Apache License 2.0 전문)와 `NOTICE`(귀속 고지)가 함께 실린다. ClinicalTrials.gov 는 미국 국립의학도서관(NLM)이 운영하는 레지스트리이며, 이 프로젝트는 NLM/NIH 와 제휴하거나 그 후원을 받지 않는다.
