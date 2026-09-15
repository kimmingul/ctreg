---
name: export-list
when: 목록을 파일로 원할 때 — "csv 로 다운로드", "엑셀로", "목록을 받고 싶다", "리스트를 파일로"
---

# 목록을 파일로 (CSV)

**파일은 네가 만들지 않는다.** 페이지가 SQL 결과 표마다 [CSV] 버튼을 두고, 200행을 넘으면 서버가 같은 SQL 을 상한
없이 다시 돌려 내려준다. 너의 일은 **한 행이 시험 하나인 목록 SQL 을 한 번 실행하는 것**이다.

## 절차 (kctis 도구가 있을 때)
1. 대상을 정하라 — 연구자면 `pi_name_kr = '홍길동'`, 기관이면 `pi_affiliation_kr LIKE '%○○병원%'`(소속) 또는
   `v_cris_site` JOIN(실시기관), 주제면 제목 LIKE. 어느 기준인지 답에 적어라.
2. **목록 SQL 한 번** — 열은 이 순서로: `trial_id, title_kr, status_kr, phase, study_type, date_registration, pi_name_kr,
   pi_affiliation_kr, has_results` (`v_cris_unified`), 의뢰사가 필요하면 `v_cris_sponsor` 를 JOIN 해 `sponsor`.
   `ORDER BY date_registration DESC`. LIMIT 을 쓰지 마라 — 상한은 도구가 알아서 걸고 CSV 는 전부를 낸다.
   세계(AACT)면 `studies` 에서 `nct_id, brief_title, overall_status, phase, start_date, source` + `overall_officials` JOIN.
3. 같은 턴에 모수 COUNT 를 하나 더 세도 좋다.

## 절차 (ctreg 도구만 있을 때)
`search_trials_multi_registry` 로 page-size 200 까지 — 페이지가 근거 레코드에 [CSV] 를 둔다. 200건을 넘으면 넘는다고 말하라.

## 답
- 건수와 기준("전북대학교병원 **소속** 연구책임자 시험 228건"), 그리고 **"아래 표의 CSV 버튼으로 내려받을 수 있다"** 한 줄.
- 표를 답에 나열하지 마라 — 페이지가 보여주고 파일로 낸다.
- 마지막 「한계」: 사본 수집 시각, 소속/실시기관 기준의 차이, 동명이인.
