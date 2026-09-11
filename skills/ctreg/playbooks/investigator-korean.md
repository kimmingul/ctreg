---
name: investigator-korean
when: 한국어 사람 이름으로 그 연구자의 임상시험을 찾을 때 — "김민걸 교수 연구", "○○○ 교수의 임상시험 리스트"
---

# 한국어 연구자 이름으로 시험 찾기

**왜 절차가 필요한가.** 로마자 표기가 결과를 가른다 — 실측: `Min-Gul Kim` 45건, `Mingul Kim` 17건,
겹치지 않는 두 집합. 한 표기로만 찾으면 절반을 놓친 채 자신 있게 답하게 된다. CRIS 는 국문·영문을
나란히 싣는 대조표다.

## 절차

1. `resolve_korean_investigator_name` — korean_name 에 한국어 이름 그대로, `ctgov: true`. **term 은 넣지
   마라**(CRIS 사본에서는 이름이 축이라 필요 없고, 넣으면 잃기만 한다). 돌아오는 것: CRIS 에 등록된
   영문 표기 목록과 표기별 CRIS·ctgov 건수.
2. 다음 셋을 **한 턴에 동시에** 불러라:
   - `search_trials_multi_registry` — registry `["cris"]`, investigator 에 **한국어 이름 그대로**
     (등록된 영문 표기 전부가 한 번에 걸린다).
   - `search_trials_multi_registry` — registry `["ctgov"]`, investigator 에 1단계에서 **ctgov 건수가 0 이
     아닌 표기 하나씩** 따로. ctgov 는 하이픈과 띄어쓰기를 같게 보지만 붙임(`Mingul`)은 다르게 본다 —
     같은 집합이 두 번 오면 하나로 합쳐라.
   - `search_trials_multi_registry` — registry `["isrctn"]`, **term** 에 가장 흔한 영문 표기(ISRCTN 은
     이름 축이 없어 본문 자유검색이다).
3. 받은 레코드를 등록번호로 합쳐 중복을 빼라. 같은 시험이 CRIS 와 ctgov 양쪽에 있을 수 있다.
4. EU CTIS 는 이름으로 물을 수 없다 — 시도하지 말고 답에 그렇게 적어라.

## 답에 반드시 밝힐 것

- 어느 표기로 ctgov 를 물었고 표기별 몇 건인지. 이 밖의 표기로 등록된 시험은 빠질 수 있다.
- ISRCTN 건은 본문 검색이라 **연구책임자가 아닐 수 있다** — 레코드를 열어 확인하라고.
- CRIS 가 사본이면(경고 `cris_mirror_copy`) 수집 시각과 "그 뒤 등록분은 없다".
- 레코드를 표로 나열하지 마라 — 페이지가 아래에 보여준다. 규모·경향·한계와 근거 번호 몇 개만.
