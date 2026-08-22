# ctreg 필드 테스트 — ClinicalTrials.gov

실행: 2026-08-22T02:09:50.772Z
대상: https://clinicaltrials.gov/api/v2

스펙 `docs/superpowers/specs/2026-08-22-ctreg-design.md` §7.4 의 미검증 문법을 실제 API 로 확인한 결과.

| 검사 | 기대 | 판정 | 실제 |
| :-- | :-- | :-- | :-- |
| query.lead | 200 + totalCount > 0 | ✅ 통과 | totalCount=2172, studies=1, nextPageToken=있음 |
| query.id | 200 + 해당 NCT 매칭 | ✅ 통과 | totalCount=1, studies=1, nextPageToken=있음 |
| query.patient | 200 + totalCount > 0 | ✅ 통과 | totalCount=0, studies=0, nextPageToken=없음 |
| AREA[…]RANGE 날짜 | 200 + totalCount > 0 | ✅ 통과 | totalCount=170926, studies=1, nextPageToken=있음 |
| AREA[Phase] 값 | 200 + totalCount > 0 | ✅ 통과 | totalCount=49704, studies=1, nextPageToken=있음 |
| AREA[StudyType] 값 | 200 + totalCount > 0 | ✅ 통과 | totalCount=457756, studies=1, nextPageToken=있음 |
| filter.ids 50개 | 200 (URL 길이 포함) | ✅ 통과 | totalCount=-, studies=4, nextPageToken=없음 |
| filter.ids 200개 | 상한 확인 — 실패해도 정보 | ✅ 통과 | totalCount=-, studies=16, nextPageToken=없음 |
| HasResults 필터 후보 A | 문법 확인 — 실패해도 정보 | ✅ 통과 | totalCount=79794, studies=1, nextPageToken=있음 |
| pageToken 왕복 | nextPageToken 존재 확인 | ✅ 통과 | totalCount=14461, studies=1, nextPageToken=있음 |

## 조치

- ❌ 항목은 어댑터에서 해당 플래그를 노출하지 않거나, 확인된 문법으로 고친다.
- `filter.ids` 상한이 50 미만으로 확인되면 `CTGOV_CAPABILITY.limits.maxBatchIds` 를 실제 값으로 낮춘다.
- HasResults 문법이 확인되지 않으면 슬라이스 2 로 미룬다. 레코드 필드로만 계속 낸다.
