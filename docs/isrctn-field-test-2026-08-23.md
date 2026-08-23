# ISRCTN capability 실물 대조 — 2026-08-23

- 레지스트리 전체 건수: **28592** (아래 "필터 무시" 판정의 기준선)
- 통과 16 · 실패 0 · 불확정 0

이 표가 확인하는 것은 "요청이 성공했다" 가 아니라 **"우리가 신고한 대로 레지스트리가
실제로 동작한다"** 이다. ISRCTN 은 틀린 질의에 오류를 내지 않으므로, 실물에 쳐 보는
것 말고는 capability 선언이 참인지 확인할 방법이 없다.

## 1. true 로 신고한 축 — 실제로 좁히는가

0건이면 필드명이나 값 어휘가 틀린 것이고, 전체 건수가 나오면 필터가 무시되는 것이다.
둘 다 exit 0 으로 나가므로 여기서 잡지 못하면 아무도 못 잡는다.

| 축 | 프로브 | 판정 | 결과 |
| :-- | :-- | :-- | :-- |
| condition | `{"condition":"diabetes"}` | ✅ 통과 | 1118건 |
| intervention | `{"intervention":"aspirin"}` | ✅ 통과 | 145건 |
| term | `{"term":"covid"}` | ✅ 통과 | 1220건 |
| title | `{"title":"covid"}` | ✅ 통과 | 325건 |
| sponsor | `{"sponsor":"University of Oxford"}` | ✅ 통과 | 659건 |
| outcomeQuery | `{"outcomeQuery":"mortality"}` | ✅ 통과 | 1633건 |
| phase | `{"phase":["phase_3"]}` | ✅ 통과 | 911건 |
| studyType | `{"studyType":"interventional"}` | ✅ 통과 | 24741건 |
| updatedRange | `{"updatedSince":"2024-01-01"}` | ✅ 통과 | 8855건 (경고 1건) |
| completionRange | `{"completionAfter":"2020-01-01"}` | ✅ 통과 | 11429건 (경고 1건) |

## 2. false 로 신고한 축 — 아직도 죽어 있는가

꺼 둔 축이 살아나면 사용자에게 근거 없이 exit 3 을 주고 있는 것이다. 여기서 ❌ 가
나오면 그 축을 켤 수 있다는 뜻이고, 이 표가 그 근거가 된다.

| 축 | 원문 질의 | 결과 | 판정 | 비고 |
| :-- | :-- | :-- | :-- | :-- |
| status | `trialStatus:"Ongoing"` | 0건 | ✅ 통과 | 문서 3.2.1.1 이 값 목록까지 주지만 전부 0건 |
| status | `recruitmentStatus:"Recruiting"` | 0건 | ✅ 통과 | 문서 3.2.1.13, 역시 0건 |
| startRange | `overallStartDate GE 2050-01-01T00:00:00` | 전체 — 필터 무시 | ✅ 통과 | 문서 3.2.1.14, 필터가 무시되어 전체가 온다 |
| location | `location:"Birmingham"` | 0건 | ✅ 통과 | 문서의 23개 constraint 에 없는 이름 — 자유 문자열 장소를 받을 자리가 없다 |
| id | `isrctn:96189403` | 0건 | ✅ 통과 | 자기 번호조차 전용 축이 없다 |
| id | `clinicalTrialsGovNumber:"NCT03831932"` | 0건 | ✅ 통과 | 상호등록번호로도 못 찾는다 |
