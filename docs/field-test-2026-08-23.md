# ctreg 필드 테스트 — ClinicalTrials.gov

실행: 2026-08-23T06:04:20.444Z
대상: https://clinicaltrials.gov/api/v2

스펙 `docs/superpowers/specs/2026-08-22-ctreg-design.md` §7.4 의 미검증 문법을 실제 API 로 확인한 결과.
판정은 "요청이 던지지 않았다"가 아니라 각 행의 기대(expect)를 응답과 대조해서 낸다.
`filter.ids` 배치 검사는 `query.cond=cancer` 검색으로 모은 실제 NCT ID 600개를 사용했다(이전 판은 합성 ID라 상한을 시험하지 못했다).

집계: ✅ 통과 13 · ❌ 실패 0 · ⚠️ 불확정 1

| 검사 | 기대 | 판정 | 실제 |
| :-- | :-- | :-- | :-- |
| query.lead | 200 + totalCount > 0 | ✅ 통과 | totalCount=2172 (>0 확인) |
| query.id | 200 + 해당 NCT 매칭 (nctId === NCT04280705) | ✅ 통과 | nctId 일치 확인, totalCount=1 |
| AREA[…]RANGE 날짜 | 200 + totalCount > 0 | ✅ 통과 | totalCount=170926 (>0 확인) |
| AREA[Phase] 값 | 200 + totalCount > 0 | ✅ 통과 | totalCount=49704 (>0 확인) |
| AREA[StudyType] 값 | 200 + totalCount > 0 | ✅ 통과 | totalCount=457756 (>0 확인) |
| HasResults 필터 후보 A | 문법 확인 — 통과해도 슬라이스 2 까지는 CLI 에 노출하지 않음(불확실해서가 아니라 결정으로) | ✅ 통과 | totalCount=79794 — AREA[HasResults]true 문법 유효 확인. 노출은 슬라이스 2 로 의도적으로 미룸. |
| pageToken 왕복 | nextPageToken 존재 확인 | ✅ 통과 | nextPageToken 있음, totalCount=14461 |
| query.patient (원 문구) | 200 + totalCount > 0 | ⚠️ 불확정 | totalCount=0 — 이 구체적 문구가 안 맞은 것인지 파라미터 자체가 동작하지 않는지 단일 요청으론 판별 불가. 다음 행('query.patient (단순 문구 재확인)') 참고. |
| query.patient (단순 문구 재확인) | 단순 문구로 재확인 — totalCount > 0 이면 파라미터 자체는 동작 | ✅ 통과 | totalCount=20183 — 단순 문구는 매칭됨. query.patient 파라미터 자체는 동작한다. 위 원문구의 totalCount=0 은 파라미터 고장이 아니라 그 구체적 문장·인구통계 조합이 텍스트로 매칭되는 시험이 없었던 것으로 해석 가능(확정은 아님 — 매칭 알고리즘 자체는 미공개). |
| filter.ids 50개 (실제 ID) | 50개 전부 매칭 (totalCount=50) | ✅ 통과 | totalCount=50 — 50개 전부 매칭, 상한 아직 안 걸림 |
| filter.ids 100개 (실제 ID) | 100개 전부 매칭 (totalCount=100) | ✅ 통과 | totalCount=100 — 100개 전부 매칭, 상한 아직 안 걸림 |
| filter.ids 200개 (실제 ID) | 200개 전부 매칭 (totalCount=200) | ✅ 통과 | totalCount=200 — 200개 전부 매칭, 상한 아직 안 걸림 |
| filter.ids 300개 (실제 ID) | 300개 전부 매칭 (totalCount=300) | ✅ 통과 | totalCount=300 — 300개 전부 매칭, 상한 아직 안 걸림 |
| filter.ids 500개 (실제 ID) | 500개 전부 매칭 (totalCount=500) | ✅ 통과 | totalCount=500 — 500개 전부 매칭, 상한 아직 안 걸림 |

## 닫힌 어휘가 데이터를 덮는가

값별 건수의 합이 전체 총계에 못 미치면 그 축의 어휘로는 데이터를 다 덮지 못한다는 뜻이다.
모자란 부분이 F8 이 이름 붙이지 못했던 그것이고, capability 의 `exhaustive: false` 가 그 이름이다.

| 축 | 값 개수 | 값별 합 | 전체 총계 | exhaustive | 어느 값에도 안 걸리는 수 |
| :-- | --: | --: | --: | :-- | --: |
| status | 8 | 502098 | 599765 | `false` | 97667 |
| phase | 6 | 482211 | 599765 | `false` | 117554 |
| studyType | 3 | 598784 | 599765 | `false` | 981 |

## 해석

- **query.patient**: 원 문구(totalCount=0)만으로는 파라미터 고장인지 문구가 안 맞은 것인지 판별할 수 없어 불확정으로 남겼다. 단순 문구("lung cancer") 재확인 결과가 그 판단 근거다 — 위 표에서 확인.
- **filter.ids**: 합성 ID가 아니라 실제 검색 결과에서 모은 ID로 사이즈를 늘려가며 `countTotal`이 요청한 개수와 정확히 일치하는지 봤다. 실패(❌)가 나온 최소 사이즈가 있다면 그것이 실측 상한 후보다. 전부 통과했다면 최대로 시도한 사이즈까지는 상한에 걸리지 않았다는 뜻이지, "상한이 없다"는 뜻은 아니다.
- **HasResults**: 통과는 문법이 유효하다는 뜻일 뿐이다. CLI 필터로 노출하지 않는 것은 이 판정과 무관하게 슬라이스 범위 결정이다.

## 조치

- ❌ 항목은 어댑터에서 해당 플래그를 노출하지 않거나, 확인된 문법으로 고친다.
- ⚠️ 항목은 확정이 아니다 — 추가 검사 없이 플래그를 새로 열지 않는다.
- `filter.ids` 실측 상한이 잠정값 50 미만으로 확인되면 `CTGOV_CAPABILITY.limits.maxBatchIds` 를 낮춘다.
- **`filter.ids` 실측 상한이 잠정값(50)보다 훨씬 위(이 실행에서는 500까지 확인)라고 해서 `maxBatchIds` 를 그만큼 올리면 안 된다.** `get()` 은 배치당 요청을 한 번만 보내고 응답을 페이지네이션하지 않는다 — `buildIdsParams` 가 `pageSize` 를 `CAPS.pageSize.max`(200)로 캡핑하므로, `maxBatchIds` 가 200을 넘으면 그 초과분은 요청은 되지만 응답엔 실리지 않고 조용히 사라진다(경고도 안 남는다 — `get()` 입장에선 아무것도 실패하지 않았기 때문). 이 불변식은 이제 계약 스위트(`tests/contract/adapter-contract.ts`)가 `maxBatchIds ≤ CAPS.pageSize.max` 로 강제한다. 올리려면 먼저 `get()` 에 배치 내부 페이지네이션을 구현하거나, 페이지네이션 없이 안전한 상한인 `CAPS.pageSize.max`(200)에서 멈춰야 한다 — 이는 슬라이스 2 결정이다.
- HasResults 문법이 유효해도 슬라이스 2 까지는 필터로 노출하지 않는다. 레코드 필드로만 낸다.
