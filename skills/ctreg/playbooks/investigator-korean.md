---
name: investigator-korean
when: 한국어 사람 이름으로 그 연구자의 임상시험을 찾을 때 — "김민걸 교수 연구", "○○○ 교수의 임상시험 리스트"
---

# 한국어 연구자 이름으로 시험 찾기

**왜 절차가 필요한가.** 로마자 표기가 결과를 가른다 — 실측: `Min-Gul Kim` 45건, `Mingul Kim` 17건,
겹치지 않는 두 집합. 한 표기로만 찾으면 절반을 놓친 채 자신 있게 답한다. CRIS 는 국문·영문을 나란히
싣는 대조표다.

## kctis 도구가 있을 때 (공개 웹·kctis MCP 를 붙인 Claude)

1. `kctis_describe_schema(kctis)` 를 아직 안 읽었으면 먼저.
2. **CRIS 는 한국어 이름 그대로, 정확 일치** —
   `SELECT trial_id, title_kr, status_kr, date_registration, pi_name_en, pi_affiliation_kr, has_results FROM v_cris_unified WHERE pi_name_kr = '김민걸' ORDER BY date_registration DESC`
   같은 턴에 등록된 영문 표기도: `SELECT pi_name_en, COUNT(*) n FROM v_cris_unified WHERE pi_name_kr='김민걸' GROUP BY pi_name_en`
3. **ClinicalTrials.gov 는 AACT 로, 등록된 표기 전부를 OR** —
   `SELECT DISTINCT s.nct_id, s.brief_title, s.overall_status, s.phase, s.start_date, o.name FROM studies s JOIN overall_officials o ON o.nct_id = s.nct_id WHERE o.name ILIKE 'min-gul kim%' OR o.name ILIKE 'mingul kim%' OR o.name ILIKE 'min gul kim%'`
   (이름 뒤에 학위가 붙는다 — 앞부분 매칭.) 식약처 승인현황의 책임자는 `v_mfds_sites.investigator = '김민걸'`.
4. ISRCTN 은 ctreg `search_trials_multi_registry`(registry isrctn, term 에 영문 표기) — 본문 검색이라 밝혀라. EU CTIS 는 이름으로 못 묻는다.

## kctis 도구가 없을 때 (ctreg 만)

1. `resolve_korean_investigator_name` — korean_name 그대로, `ctgov: true`.
2. 한 턴에: CRIS `search`(investigator 한국어 그대로) + ctgov `search`(건수 있는 표기마다 따로) + ISRCTN `search`(term 영문).
3. 등록번호로 합쳐 중복을 빼라.

## 답에 반드시 밝힐 것
- 어느 표기로 물었고 표기별 몇 건인지; 이 밖의 표기는 빠질 수 있다.
- ISRCTN 은 본문 검색이라 연구책임자가 아닐 수 있다.
- 사본이면 수집 시각(source_note / cris_mirror_copy). 레코드를 표로 나열하지 마라 — 규모·경향·한계와 근거 번호.
