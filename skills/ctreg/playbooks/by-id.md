---
name: by-id
when: 등록번호로 시험 하나를 볼 때 — "NCT01778257", "KCT0012487 결과", "ISRCTN18353234 는 무슨 시험"
---

# 등록번호로 한 건

## 절차

1. 접두사를 붙여 `get_trial_by_id` — `CTGOV:NCT…`, `CRIS:KCT…`, `ISRCTN:ISRCTN…`, `CTIS:2022-5…`.
   여러 개면 ids 에 한꺼번에.
2. 결과 데이터(평가변수·이상반응)를 물었으면 `get_trial_results` — ClinicalTrials.gov 만 낸다. 다른
   레지스트리는 "결과 데이터를 내주지 않는다" 고 답하라(CRIS·CTIS 는 `hasResults` 만).
3. `not_found` 경고는 "그런 번호가 없다" 다 — 오류가 아니다.

## 답

- 제목·상태·상·종류·의뢰·등록 인원·기간·장소 수·결과 공개 여부. 없는 필드는 없다고.
- 적격 판정을 하지 마라.
