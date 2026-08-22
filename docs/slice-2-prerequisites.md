# 슬라이스 2 착수 전 선결 조건

- **일자:** 2026-08-22
- **성격:** 최종 전체 브랜치 리뷰가 남긴 항목 중, **두 번째 어댑터를 쓰기 전에** 처리해야 하는 것들.
  "언젠가" 목록이 아니다. 전부 하나의 어댑터로는 보이지 않고, 두 번째가 오는 순간 문다.

최종 리뷰는 `isrctn` 스텁 어댑터를 실제로 만들어 테제를 검증했다 — `src/cli/` 아래 어떤 파일도
고치지 않고 컴파일된다. 심은 진짜다. 아래는 그 위에 남은 세금이다.

## 반드시 먼저

### 1. `FetchOpts.caps` 가 캡 정책을 나르지 않는다 (최종 리뷰 I3)

`caps.outcomes` 는 아무도 읽지 않고, `caps.locations` 는 어댑터가 덮어쓴다. 문서화된 채널을
성실히 따르는 어댑터 #2 는 스펙 §5.2 를 양방향으로 어긴다. `CAPS.outcomes.default` 가 죽은
상수인 것(이연 #16)이 같은 문제의 증상이다 — 상수만 지우면 채널이 망가졌다는 증거가 사라지므로
둘을 함께 고친다.

관련: `src/cli/args.ts`(caps 조립), `src/adapters/ctgov/map.ts`(캡 적용), `src/core/query.ts`.

### 2. 선언되었으나 소비자가 없는 `limits` (최종 리뷰 I5)

`limits.maxPageSize`, `limits.ratePerSec`, `search.geoNeedsCoords` 는 capability 에 선언되지만
코드 어디에서도 읽히지 않는다. 특히 `ratePerSec` — 스펙 §6.2 는 레지스트리마다 예산이 다르다고
하는데 런타임은 전역 요청률 하나를 쓴다. 어댑터 #2 가 다른 예산을 선언해도 무시된다.

### 3. `Record<RegistryKey, RegistryAdapter>` 의 전체성 (최종 리뷰 I7)

다섯 커맨드 시그니처가 전체 `Record` 를 요구해서, 스펙이 계획한 "심만 비워 둔다"(키는 등록하되
어댑터는 아직 없음)를 타입이 금지한다. 측정된 비용은 테스트 호출 지점 10곳. 코드의 네 군데
`adapters[key]!` 가 그 증상이다.

### 4. 계약 스위트의 두 공백 (최종 수정 웨이브 재리뷰)

스위트는 이제 네 메서드를 stub 전송으로 구동하고 여섯 가지 사보타주를 잡는다. 남은 것:

- **경고를 전부 버리는 어댑터가 통과한다.** 스위트가 경고의 *모양* 은 검사하지만 *존재* 는
  검사하지 않아, 조용히 절단하는 어댑터가 적합 판정을 받는다.
- **`--raw` 의 `source` 가 좁혀진 어댑터가 통과한다.** *없는* source 만 잡는다.
  하네스의 `respond(url)` 이 이미 업스트림 본문을 쥐고 있으므로, `rec.source` 가 해당 스터디와
  깊은 동등인지 요구하면 닫힌다.

## 알아두고 결정할 것

### `count` 가 겹치는 레지스트리의 총계를 합산한다 (최종 리뷰 I6)

`count.ts:45` 의 `total += r.data`. 레지스트리가 둘 이상이고 같은 시험이 양쪽에 등록돼 있으면
합계는 무엇의 개수도 아니다. 교차 등록은 흔하다(`crossIds` 가 존재하는 이유). 레지스트리별
개수만 내고 합계를 내지 않는 것도 정당한 선택이다.

### `filter.ids` 배치 상한

실측 결과 CT.gov 는 최소 500개를 받는다(`docs/field-test-2026-08-22.md`). 그러나 `maxBatchIds`
를 올리려면 **`get` 이 배치 내부 페이지네이션을 먼저 구현해야 한다** — `buildIdsParams` 가
`pageSize` 를 `CAPS.pageSize.max`(200)로 두고 `get` 은 한 페이지만 읽으므로, 500개 청크는
500개를 묻고 200개를 받아 그것이 전부인 양 반환한다. 계약 스위트가 이 불변식을 강제한다.

### `AREA[HasResults]true`

문법은 필드 테스트로 확인됨(79,794건). 슬라이스 1 에서는 **결정에 의해** 미노출 —
동작하지 않아서가 아니다.

## 두 번째 어댑터 후보

**ISRCTN** 이 1순위다. 인증 없는 공개 REST API 이고, 조사에서 `studyType`·`hasResults`·`crossIds`
를 포함한 core 필드 대부분이 확인됐다(`docs/registry-field-survey-2026-08-22.md`).
EU CTIS 와 jRCT 는 공개 API 를 찾지 못했다(화면만).

## 조사에 남은 미확인 질문

- **ICTRP 의 "final sample size" 가 실제로 채워지는가.** TRDS 항목 17 의 명칭이
  "Target & final sample size" 라 실제치도 담을 수 있으나 미확인. 확인 방법은 조사 문서에 기록됨.
- **CTIS 의 `Last update` 가 레코드별인가 회원국별인가.** 같은 "Member State" 블록 안에 있으나
  정의문에 회원국별 문구가 없다. `status` 와 같은 구조적 문제일 수 있다.

## 이연된 사소한 항목

- `count.ts` 의 미지원 봉투가 `data: {total: 0}` 을 남긴다(`results.ts` 는 `data: null`) —
  상태를 안 보는 호출자가 0 을 본다.
- `tests/runtime/http.test.ts` 의 헬퍼 기본 인자가 `CacheMode` 유니온을 인라인으로 반복한다.
- `--raw` 로 전체 문서를 받을 때 페이로드 경고가 없다(`results --full` 은 `results_full` 을 낸다).
- `sponsor` 가드가 한 분기에서 `lead: ""` 를 낼 수 있다(반대 방향은 수정됨).
