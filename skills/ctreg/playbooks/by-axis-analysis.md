---
name: by-axis-analysis
when: "○○별 현황·분포·추이" 를 물을 때 — "당뇨 시험의 연도별 추이", "국내 항암 시험 의뢰사 분포", "어떤 약이 많이 쓰이나", "실시기관은 어디가 많나", "질환별로 보면", "결과가 공개된 비율"
---

# 축별 현황·분포·추이

순위가 아니라 **분포·추이**를 물은 것이다. 절차는 순위와 같고 답의 모양이 다르다.

## kctis 도구가 있을 때
1. 주제(검색어)를 정하라 — 국문·영문 같이(`title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%'`). 주제가 없으면
   모수가 전체(12,585 / 식약처 14,000여 / AACT 60만)라는 것을 밝혀라.
2. **축마다 SQL 하나, 여러 축이면 한 턴에 동시에.** 연도 `SUBSTR(date_registration,1,4)`, 의뢰사 `v_cris_sponsor.sponsor`,
   실시기관 `v_cris_site.site`, 중재종류 `intervention_type`, 결과 공개 `has_results`, 식약처는 `v_mfds_trials`
   (승인일·의뢰사 표준명·상·대상질환 텍스트), 세계는 aact(`conditions`·`interventions`·`sponsors`·`facilities`).
3. 약물·질환은 자유 텍스트 — LIKE 로 찾고 "문자열 매칭" 이라고 밝혀라(AACT 는 `interventions.name`·`conditions.downcase_name`).
4. 한 시험이 여러 의뢰사·기관·약물에 속한다 — `COUNT(DISTINCT trial_id)`, 축 안의 합은 모수보다 클 수 있다.

## kctis 도구가 없을 때
ctreg `aggregate_trials`(by 축, term, registry) — 축마다 한 번, 한 턴에.

## 답의 모양
- 첫 줄: 모수와 결과 — 면책·주의로 시작하지 마라. 축마다 문단 하나(상위 항목과 수, 눈에 띄는 것 하나). 추이는 연도순으로.
- 마지막 「한계」: 출처(source_note)·문자열 매칭·표준명 매핑 비율·"CRIS/식약처만" 또는 "AACT 갱신일". 표를 길게 나열하지 마라.
