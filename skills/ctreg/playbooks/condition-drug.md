---
name: condition-drug
when: 질환·약물·의뢰기관·상태·상 같은 조건으로 시험을 찾거나 셀 때 — "모집 중인 당뇨병 3상", "pembrolizumab 폐암", "화이자가 하는 시험"
---

# 조건으로 시험 찾기

## 절차 — 어디에 묻나
- **국내(CRIS·식약처)**: kctis 가 있으면 `v_cris_unified`(status_en·phase·제목 LIKE·has_results) / `v_mfds_trials`(승인일·상·대상질환).
  없으면 ctreg `search`(registry cris, term).
- **ClinicalTrials.gov**: kctis 가 있으면 aact — `studies`(overall_status·phase) + `conditions`/`interventions` JOIN, 미국은
  `calculated_values.has_us_facility`. 없으면 ctreg `search`(registry ctgov, condition·intervention·status·phase).
- **ISRCTN·EU CTIS**: ctreg `search` — 능력이 다르다(CTIS 는 phase 축 없음, ISRCTN 은 status 없음). "그렇게 물어볼 수
  없음" 이 오면 그것이 답이다 — 능력 목록을 다시 부르거나 축을 빼고 다시 묻지 마라.
- 질환·약물명은 영어로(레지스트리가 영어를 받는다), CRIS 는 국문·영문 둘 다.

## 한 턴에 끝내라
국내 SQL + aact SQL + ctreg(isrctn·ctis) 를 **같은 턴에** 불러라. 건수는 결과에 있다 — count 를 따로 부르지 마라.

## 답에 반드시 밝힐 것
- 레지스트리별 건수를 따로 — **더하지 마라**(같은 시험이 여러 곳에 등록된다).
- 못 물은 레지스트리는 0건이 아니다. 사본 시각·AACT 갱신일. 경고(vocab_excludes_missing 등)는 결과가 좁다는 뜻.
