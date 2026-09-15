---
name: ranking
when: 순위·비교·상위·"우수한"·"등수"·"가장 많이" 를 물을 때 — "한국에서 등수", "당뇨 관련 우수한 연구자 5명", "가장 많이 하는 기관·의뢰사"
---

# 순위·비교를 물었을 때

레지스트리는 우수성을 판정하지 않는다 — 답할 수 있는 것은 **등록 건수**다. **답은 순위부터** 시작하고, 이 선
긋기는 **마지막에 「한계」 문단**으로 둔다.

## 절차 — kctis 도구가 있을 때: SQL 한 번

`kctis_describe_schema` 를 읽고 `kctis_query_sql` **한 번**. 세는 법은 스키마 문서에 있다 — 의뢰사·기관은
**표준명 뷰**(`v_cris_sponsor`·`v_cris_site`·`v_mfds_trials.sponsor`·`v_mfds_sites.site`), 시험은
`COUNT(DISTINCT trial_id)`, 이름은 국문 정확 일치. 예:
- 주제 안 연구자: `SELECT pi_name_kr, MIN(pi_affiliation_kr) aff, COUNT(*) n FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%' GROUP BY pi_name_kr ORDER BY n DESC LIMIT 10`
- 기관 안 연구자: `... WHERE pi_affiliation_kr LIKE '%전북대학교병원%' GROUP BY pi_name_kr ...` (실시기관 기준이면 `v_cris_site` 와 JOIN)
- 의뢰사: `SELECT s.sponsor, COUNT(DISTINCT s.trial_id) n FROM v_cris_sponsor s JOIN v_cris_unified t ON t.trial_id=s.trial_id WHERE ... GROUP BY s.sponsor ORDER BY n DESC`
- 세계(ClinicalTrials.gov): source `aact` — `SELECT s.source, COUNT(DISTINCT s.nct_id) n FROM studies s JOIN conditions c ON c.nct_id=s.nct_id WHERE c.downcase_name LIKE '%diabetes%' GROUP BY s.source ORDER BY n DESC`
모수(WHERE 에 걸린 시험 수)도 같은 턴에 세어 함께 내라. 상위 몇의 대표 시험이 필요하면 다음 턴에 한 번.

## 절차 — kctis 도구가 없을 때: ctreg `aggregate_trials`
by 에 축, term 에 국문·영문 쉼표, registry cris(사본이 있어야 함) 또는 ctgov(1,000건 상한). 목록을 읽고
후보를 뽑아 하나씩 세지 마라.

## 한 사람의 "등수"
비교 대상이 없으면 등수는 성립하지 않는다 — 그렇다고 말하라. 그 사람의 건수·표기 분포와, 그 사람의 주된
주제 하나로 순위 SQL **한 번** — 거기서 몇 번째인지. 주제를 바꿔 가며 돌리지 마라.

## 마지막 「한계」 문단에
- "우수함은 판정하지 않는다 — 등록 건수다". 모수와 검색어. 동명이인·기관 표기 미분리(표준명 매핑 비율).
- 사본 수집 시각 / AACT 갱신일. 다른 레지스트리는 안 셌음.
