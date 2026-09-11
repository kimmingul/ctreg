---
name: condition-drug
when: 질환·약물·의뢰기관·상태·상 같은 조건으로 시험을 찾거나 셀 때 — "모집 중인 당뇨병 3상", "pembrolizumab 폐암", "화이자가 하는 시험"
---

# 조건으로 시험 찾기

## 절차

1. 어느 레지스트리가 그 축을 받는지 모르면 `list_registries_and_capabilities` 부터(공짜). 특히 CRIS
   는 condition·intervention·sponsor 축이 없고 **term**(자유검색) 하나다 — 질환·약물명을 term 에.
   EU CTIS 는 phase 축이 없다.
2. `search_trials_multi_registry`(목록) 또는 `count_trials`(건수만). registry 를 사용자가 말하지
   않았으면 `["ctgov","isrctn","ctis","cris"]`. 한국·국내면 `["cris"]`, 미국이면 `["ctgov"]`, 유럽이면
   `["ctis"]`, 영국이면 `["isrctn"]`.
3. 질환·약물명은 **영어로** condition·intervention 에(레지스트리가 영어를 받는다). CRIS 에는 term 에
   국문·영문 둘 다 시도해 볼 만하다(동시에).
4. 모집 중 → status `["recruiting"]`, 끝남 → `["completed"]`, 3상 → phase `["phase_3"]`.

## 답에 반드시 밝힐 것

- 레지스트리별 건수를 따로 — **더하지 마라**(같은 시험이 여러 곳에 등록된다).
- "그렇게 물어볼 수 없음"(unsupported) 인 레지스트리는 0건이 아니라 못 물은 것이다.
- 경고 `vocab_excludes_missing`·`locations_truncated` 등이 있으면 결과가 그만큼 좁거나 잘렸다.
