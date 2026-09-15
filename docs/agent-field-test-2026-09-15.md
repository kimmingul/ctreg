# 에이전트 필드 테스트 — 2026-09-15

모델 glm-5.3-flash · 사본 (없음)

## ✅ 연구자-리스트 — "김민걸 교수의 임상시험 리스트"

- 58초 · 도구 9회 · 플레이북 investigator-korean · 레코드 1
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(aact) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → search_trials_multi_registry
  ```sql
  SELECT trial_id, title_kr, status_kr, date_registration, pi_name_en, pi_affiliation_kr, has_results FROM v_cris_unified WHERE pi_name_kr = '김민걸' ORDER BY date_registration DESC
  ```
  ```sql
  SELECT pi_name_en, COUNT(*) n FROM v_cris_unified WHERE pi_name_kr='김민걸' GROUP BY pi_name_en
  ```
  ```sql
  SELECT DISTINCT s.nct_id, s.brief_title, s.overall_status, s.phase, s.start_date, o.name FROM studies s JOIN overall_officials o ON o.nct_id = s.nct_id WHERE o.name ILIKE 'min-gul kim%' OR o.name ILIKE 'mingul kim%' OR o.name ILIKE 'min gul kim%' OR o.name ILIKE 'kim min gul%' OR o.name ILIKE 'min-gul  kim%' ORDER BY s.nct_id
  ```
  ```sql
  SELECT t.trial_seq, t.title, t.approval_date, t.phase, t.sponsor, s.site, s.role FROM v_mfds_sites s JOIN v_mfds_trials t ON t.trial_seq = s.trial_seq WHERE s.investigator = '김민걸' ORDER BY t.approval_date DESC
  ```
  ```sql
  SELECT status_kr, COUNT(*) n FROM v_cris_unified WHERE pi_name_kr='김민걸' GROUP BY status_kr ORDER BY n DESC
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_seq) n FROM v_mfds_sites WHERE investigator='김민걸'
  ```

> **김민걸 교수(전북대학교병원 임상약리센터)의 임상시험은 국내 CRIS 43건, ClinicalTrials.gov 61건, 식약처 승인현황 55건이 확인됩니다.** 내용은 거의 전부 건강한 성인(남성) 대상 제1상 약동학(PK)·약물상호작용(DDI)·생물학적동등성 시험이고, 실시기관은 전북대학교병원입니다.
> **CRIS(국내 등록, 43건)** — 2011년 [CRIS:KCT0000145]부터 2026년 [CRIS:KCT0012487]까지 등록됐고, 2014–2016년에 25건(58%)으로 몰려 있습니다. 상태는 연구종결 29 · 모집추가없이 진행중 7 · 대상자 모집 전 4 · 모집 중 3이고, 결과가 공개된 시험은 5건입니다([CRIS:KCT0012487] 비타민 C 약동학, [CRIS:KCT0005826] 마이크로바이옴 제제, [CRIS:KCT0005339] GEN-001 단회 투여 등). 최근 5년에는 마이크로바이옴 제제(GEN-001, KD4002), 한약-항생제 상호작용([CRIS:KCT0006697]) 같은 주제가 눈에 띕니다.
> **ClinicalTrials.gov(61건)** — 2011–2024년 시작, 사실상 전부가 제1상이며 대부분 COMPLETED입니다. 유일한 2상은 비만 대상 마테 추출물 시험 [CTGOV:NCT01778257]입니다. 최근 것은 [CTGOV:NCT06623526](YHR2402/2402+2403 상호작용, 2024-10 시작)입니다. 식약처 승인현황 55건(2019–2025 승인)의 의뢰사는 종근당·대웅제약·한미약품·JW중외제약·유한양행·HK이노엔·셀트리온·동아에스티·SK케미칼 등 국내 제약사가 다수입니다.
> **ISRCTN(영국)** — 본문 검색으로 1건만 걸렸습니다([ISRCTN:ISRCTN18353234], 2008년 올메사르탄 생동성 시험). 본문 매칭이라 연구책임자가 김민걸 교수인지는 레코드에서 확인되지 않습니다.
> 「한계」 — CRIS 에서 영문 표기가 10가지(Min-Gul Kim 19건, Min Gul Kim 7건, Mingul Kim 4건 등)로 갈려 있어 국문 '김민걸' 정확 일치로 세웠고, ctgov 는 표기 변형을 OR 로 묶어 세웠으나 이 밖의 표기는 빠졌을 수 있습니다. 동명이인은 갈라내지 않았습니다(모두 전북대 소속으로 일치). CRIS 사본 수집 2026-09-10, AACT 갱신 2026-09-11 기준이며, 식약처 승인현황 상세는 2019년 이후 승인분이 충실합니다. 레지스트리 기재사항은 적격 판정을 대체하지 않습니다.

## ✅ 연구자-특징 — "김민걸 교수의 임상시험 특징 설명"

- 45초 · 도구 11회 · 플레이북 investigator-profile · 레코드 0
- 호출: load_playbook → load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(aact) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT trial_id, title_kr, study_type, phase, status_kr, date_registration, date_start, pi_name_en, pi_affiliation_kr, intervention_type, intervention_kr, has_results FROM v_cris_unified WHERE pi_name_kr = '김민걸' ORDER BY date_registration DESC
  ```
  ```sql
  SELECT pi_name_en, pi_affiliation_kr, COUNT(*) AS n FROM v_cris_unified WHERE pi_name_kr = '김민걸' GROUP BY pi_name_en, pi_affiliation_kr ORDER BY n DESC
  ```
  ```sql
  SELECT DISTINCT s.nct_id, s.brief_title, s.overall_status, s.phase, s.start_date, o.name FROM studies s JOIN overall_officials o ON o.nct_id = s.nct_id WHERE o.name ILIKE 'min-gul kim%' OR o.name ILIKE 'mingul kim%' OR o.name ILIKE 'min gul kim%' ORDER BY s.nct_id
  ```
  ```sql
  SELECT study_type, phase, status_kr, has_results, COUNT(*) AS n FROM v_cris_unified WHERE pi_name_kr = '김민걸' GROUP BY study_type, phase, status_kr, has_results ORDER BY n DESC
  ```
  ```sql
  SELECT s.sponsor, COUNT(DISTINCT s.trial_id) AS trials FROM v_cris_sponsor s JOIN v_cris_unified u ON u.trial_id = s.trial_id WHERE u.pi_name_kr = '김민걸' GROUP BY s.sponsor ORDER BY trials DESC LIMIT 15
  ```
  ```sql
  SELECT SUBSTR(date_registration, 1, 4) AS year, COUNT(*) AS n FROM v_cris_unified WHERE pi_name_kr = '김민걸' GROUP BY year ORDER BY year
  ```
  ```sql
  SELECT intervention_type, COUNT(*) AS n FROM v_cris_unified WHERE pi_name_kr = '김민걸' GROUP BY intervention_type ORDER BY n DESC
  ```
  ```sql
  SELECT COUNT(DISTINCT t.trial_seq) AS trials FROM v_mfds_sites t WHERE t.investigator = '김민걸'
  ```

> 김민걸 교수(전북대학교병원)의 임상시험은 **국내 CRIS 43건, ClinicalTrials.gov 61건, 식약처 승인현황 기준 시험책임자 승인 55건**으로, 거의 전부가 건강한 자원자를 대상으로 한 제1상 약동학 시험입니다.
> **주된 유형과 대상.** CRIS 43건 중 42건이 중재연구이고 그 전부가 Phase 1이며, 대상은 제목 기준 "건강한 성인(남성) 자원자"입니다. 주제는 세 가지로 좁혀집니다 — ① 신약·복합제의 약동학·안전성(예: CKD-395 용량별·식이영향 시리즈 [CRIS:KCT0001627]·[CRIS:KCT0001783], DW2008S 단회·반복 증량 [CRIS:KCT0004125]), ② 약물상호작용(DDI) — DW1029M이 메트포르민·로사르탄·리나글립틴에 미치는 영향 [CRIS:KCT0001386]·[CRIS:KCT0001376]·[CRIS:KCT0001326], 한약(경방소청룡탕)과 항생제 3종의 병용 [CRIS:KCT0006697], 테그오프라잔과 NOAC 상호작용 [CTGOV:NCT05723510] 등, ③ 생동성·제제비교(미글리톨 [CRIS:KCT0000770], 실데나필 구강용해필름 [CRIS:KCT0000734], 프레가발린 서방정 [CRIS:KCT0002154] 등). 중재는 의약품이 40/43이고 식이보충제 2건(발효홍삼 [CRIS:KCT0000735], 마이크로바이옴 제제 [CRIS:KCT0005826])이며, 마이크로바이옴 제제 GEN-001 단회·반복 1상 2건과 대변 검체 채취·보관방법 비교 관찰연구 1건 [CRIS:KCT0005101]이 이 분야의 축을 이룹니다. ClinicalTrials.gov 61건 중 60건이 Phase 1이고, 유일한 Phase 2는 비만 대상 마테 추출물의 체지방 감소 유효성 시험 [CTGOV:NCT01778257]으로 — 환자 대상 유효성 시험은 이 한 건뿐입니다.
> **의뢰·기간·상태.** 의뢰사는 전북대학교병원 자체 11건, 동화약품 7건, 종근당 7건, 지엘팜텍 5건, 씨티씨바이오 3건 순으로 국내 제약사 의뢰가 중심입니다. 등록은 2013–2017년에 31건으로 집중되고 이후 연 2~3건 수준으로 줄었습니다. 상태는 연구종결 29건, 모집추가없이 진행 중 7건, 모집 전 4건, 모집 중 3건이며, 결과가 공개된 것은 4/43건입니다([CRIS:KCT0012487], [CRIS:KCT0005339] 등).
> **한계.** CRIS는 국문 '김민걸' 정확 일치로 세었으며, 등록된 영문 표기가 11가지로 갈려 있습니다(Min-Gul Kim 19, Min Gul Kim 7, MinGul Kim 4, Mingul Kim 4, MIN GUL KIM 3, Min gul Kim 2, 그 외 4) — 이 표기들로만 등록된 시험은 국문 검색에도 잡히지만, 다른 표기로만 기재된 레코드는 빠질 수 있습니다. ClinicalTrials.gov는 등록 표기 3종을 OR로 물어 61건입니다. ISRCTN(본문 검색이라 연구책임자가 아닐 수 있음)과 EU CTI

## ✅ 등수 — "김민걸 교수가 한국에서 등수"

- 18초 · 도구 3회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis)
  ```sql
  WITH ranked AS (
    SELECT pi_name_kr, MIN(pi_affiliation_kr) AS aff, COUNT(DISTINCT trial_id) AS n
    FROM v_cris_trials
    WHERE pi_name_kr IS NOT NULL AND TRIM(pi_name_kr) != ''
    GROUP BY pi_name_kr
  ),
  r AS (
    SELECT pi_name_kr, aff, n, ROW_NUMBER() OVER (ORDER BY n DESC, pi_name_kr) AS rk
    FROM ranked
  )
  SELECT rk, pi_name_kr, aff, n,
    (SELECT COUNT(*) FROM ranked) AS total_pis,
    (SELECT COUNT(DISTINCT trial_id) FROM v_cris_trials) AS total_trials
  FROM r
  WHERE rk <= 10 OR pi_name_kr = '김민걸'
  ORDER BY rk
  ```

> **김민걸 교수(전북대학교)는 CRIS 등록 기준 연구책임자 등록 건수 4위입니다 — 43건.**
> - 전체 모수: CRIS 등록 시험 12,585건, 연구책임자 4,263명
> - 상위 10명: 조휘영(가천대, 56) · 권오윤(연세대, 50) · 권오란(이화여대, 44) · **김민걸(전북대, 43)** · 배희준(분당서울대병원, 43) · 신준호(국립재활원, 42) · 김희수(서울대병원, 39) · 이지연(대전대 한방병원, 37) · 채수완(전북대, 37) · 전대원(한양대, 33)
> - 배희준 교수와 건수가 같아(43건) 사실상 공동 4위입니다. 같은 전북대학교 소속의 채수완 교수(37건)가 뒤를 잇습니다.
> **한계**
> - "우수함"을 판정한 것이 아니라 **CRIS 등록 건수** 순위입니다. 시험의 규모·질·결과는 반영하지 않습니다.
> - 연구책임자는 국문 이름 정확 일치(`pi_name_kr = '김민걸'`)로 세웠습니다. 동명이인은 갈라내지 않았으나 소속(전북대학교)으로 확인됩니다.
> - CRIS 공식 API 사본 기준(수집 2026-09-10)이며, 식약처 승인현황·해외 레지스트리(ClinicalTrials.gov 등)는 세지 않았습니다.

## ✅ 우수한-연구자 — "한국 임상시험에서 당뇨 관련된 우수한 연구자 5명 알려줘"

- 14초 · 도구 4회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT pi_name_kr, MIN(pi_affiliation_kr) AS affiliation, COUNT(DISTINCT trial_id) AS trials FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%' GROUP BY pi_name_kr ORDER BY trials DESC LIMIT 10
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_id) AS total FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%'
  ```

> 국내 레지스트리(CRIS)에 등록된 당뇨 관련 시험을 연구책임자별로 세면 상위 5명은 다음과 같습니다. 모수는 제목에 '당뇨' 또는 'diabetes'가 든 시험 268건입니다.
> 1. **김난희** — 고려대학교의과대학부속안산병원, 10건
> 2. **김재현** — 삼성서울병원, 7건
> 3. **이병완** — 연세대학교, 6건
> 4. **박철영** — 강북삼성병원, 6건
> 5. **차봉수** — 세브란스병원, 5건
> 5위는 동률입니다 — 이문규(삼성서울병원)와 이관우(아주대학교)도 5건으로 차봉수와 같아, 5위 자리는 세 명이 함께합니다. 그 아래로 이우제(서울아산병원)·김성래(가톨릭대 부천성모병원) 4건, 진흥용(전북대학교) 3건이 이어집니다.
> **한계**
> - "우수함"을 판정한 것이 아니라 **CRIS 등록 건수** 순위입니다. 시험의 질·규모·결과와는 무관합니다.
> - 검색어는 제목의 '당뇨'/'diabetes' 문자열 매칭이라, 제목에 이 단어가 없는 당뇨 시험은 빠졌을 수 있습니다.
> - 연구책임자는 국문 이름 기준으로 묶었으나 동명이인은 갈라내지 못했습니다(소속을 함께 두어 판단하십시오).
> - CRIS 사본 기준(수집 2026-09-10, 웹 수집분 보완)이며, ClinicalTrials.gov 등 다른 레지스트리에만 등록된 한국 연구자의 시험은 세지 않았습니다.

## ✅ 의뢰사-분포 — "국내 당뇨병 임상시험은 어느 의뢰사가 많이 하나"

- 20초 · 도구 4회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT s.sponsor, COUNT(DISTINCT s.trial_id) AS n FROM v_cris_sponsor s JOIN v_cris_unified t ON t.trial_id = s.trial_id WHERE t.title_kr LIKE '%당뇨%' OR t.title_en LIKE '%diabetes%' GROUP BY s.sponsor ORDER BY n DESC LIMIT 15
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_id) AS total FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%'
  ```

> 국내(CRIS)에서 제목에 '당뇨' 또는 'diabetes'가 든 시험은 총 268건이고, 이 중 의뢰기관 기준 상위는 다음과 같습니다 — 1위 **아산사회복지재단 서울아산병원(16건)**, 2위 **고려대학교의과대학부속안산병원(15건)**, 3위 **세브란스병원(14건)**, 그 뒤 서울대학교병원(9건), 삼성서울병원·경희대학교병원(각 8건), 강북삼성병원(7건) 순입니다.
> 전체 분포를 보면 상위권이 대부분 대학병원·의료기관입니다 — 한국한의학연구원, 가톨릭대 서울성모병원·성빈센트병원, 아주대학교병원, 분당서울대학교병원, 강동경희대병원이 각 6건, 서울대학교가 5건입니다. 제약회사로는 **한국릴리(5건)**가 15위 안에 드는 것이 눈에 띕니다. 즉 국내 당뇨병 시험은 제약사보다 대형 대학병원이 주관(의뢰)하는 구조입니다.
> **한계**
> - "많이 한다"는 우수성 판정이 아니라 **등록 건수** 기준입니다.
> - 검색어는 제목의 '당뇨'/'diabetes' 문자열 매칭이라, 제목에 이 단어가 없는 당뇨 관련 시험은 빠졌을 수 있습니다.
> - 한 시험에 의뢰기관이 여럿일 수 있어 기관별 건수의 합(268건 초과)이 모수보다 클 수 있습니다.
> - 의뢰사는 표준명 매핑 뷰로 묶었으나 매핑되지 않은 원문 표기는 분리되어 셀 수 있습니다.
> - CRIS 사본 기준(수집 2026-09-10)이며, 식약처 승인현황이나 해외 레지스트리는 세지 않았습니다.

## ✅ 연도-추이 — "한국 당뇨병 임상시험의 연도별 추이"

- 18초 · 도구 4회 · 플레이북 by-axis-analysis · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT SUBSTR(date_registration,1,4) AS year, COUNT(*) AS trials FROM v_cris_trials WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%' GROUP BY year ORDER BY year
  ```
  ```sql
  SELECT SUBSTR(approval_date,1,4) AS year, COUNT(*) AS approvals FROM v_mfds_trials WHERE target_disease LIKE '%당뇨%' GROUP BY year ORDER BY year
  ```

> 한국 당뇨병 임상시험은 2019년을 기점으로 뚜렷하게 늘었습니다. CRIS(질병관리청) 등록분은 제목 기준 총 268건, 식약처 승인분은 대상질환 기준 총 731건입니다.
> **CRIS 등록 추이(등록연도별, 268건)** — 2010~2018년은 연간 1~11건 수준이었으나, 2019년 27건으로 뛰어난 뒤 2020년 30건, 2022년 30건, 2024년 30건, 2025년 29건으로 연간 30건 안팎의 높은 수준을 유지하고 있습니다. 2021년(16건)·2023년(18건)에 일시적 꺾임이 있었지만 전반적으로는 2018년 이전(연간 10건 미만) 대비 3배 이상 증가한 추세입니다. 2026년에도 이미 23건이 등록돼 있습니다.
> **식약처 승인 추이(승인연도별, 731건)** — 2019년 89건, 2020년 90건에서 2021년 139건으로 정점을 찍었고, 이후 2022년 124건, 2023년 101건, 2024년 106건으로 연간 100건 안팎을 유지하다 2025년 40건, 2026년 42건으로 급감해 보입니다. 다만 최근 2년 수치는 사본 수집 시점 기준 미반영분이 있을 수 있습니다.
> **한계**
> - CRIS 수치는 제목에 '당뇨/diabetes'가 든 시험이고, 식약처 수치는 대상질환 텍스트에 '당뇨'가 든 승인 건입니다 — 둘 다 문자열 매칭이라 동의어(예: "제2형 당뇨병" 외 표현)나 요약에만 언급된 경우는 빠질 수 있습니다.
> - CRIS는 등록연도, 식약처는 승인연도 기준이라 두 축의 연도 의미가 같지 않습니다.
> - 식약처 상세는 2019년 이후만 있어 그 전 추이는 CRIS로만 볼 수 있습니다.
> - 출처: CRIS 공식 API 사본(수집 2026-09-10), 식약처 임상시험 승인현황 공식 API 사본(KCTIS).

## ✅ 의약품 — "국내 당뇨병 시험에서 많이 쓰인 약물은"

- 40초 · 도구 7회 · 플레이북 by-axis-analysis · 레코드 0
- 호출: load_playbook → kctis_describe_schema → aggregate_trials(drug) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT ingredient, COUNT(DISTINCT trial_seq) AS trials FROM v_mfds_trials WHERE target_disease LIKE '%당뇨%' AND ingredient IS NOT NULL AND ingredient != '' GROUP BY ingredient ORDER BY trials DESC LIMIT 30
  ```
  ```sql
  SELECT COALESCE(NULLIF(intervention_kr,''), intervention_en) AS intervention, COUNT(DISTINCT trial_id) AS trials FROM v_cris_trials WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%' GROUP BY intervention ORDER BY trials DESC LIMIT 25
  ```
  ```sql
  SELECT '메트포르민' AS drug, COUNT(DISTINCT trial_id) AS trials FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%메트포르민%' OR intervention_en LIKE '%metformin%') UNION ALL SELECT '인슐린', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%인슐린%' OR intervention_en LIKE '%insulin%') UNION ALL SELECT '다파글리플로진', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%다파글리플로진%' OR intervention_en LIKE '%dapagliflozin%') UNION ALL SELECT '엠파글리플로진', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%엠파글리플로진%' OR intervention_en LIKE '%empagliflozin%') UNION ALL SELECT '리나글립틴', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%리나글립틴%' OR intervention_en LIKE '%linagliptin%') UNION ALL SELECT '시타글립틴', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%시타글립틴%' OR intervention_en LIKE '%sitagliptin%') UNION ALL SELECT '피오글리타존', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%피오글리타존%' OR intervention_en LIKE '%pioglitazone%') UNION ALL SELECT '글리메피리드', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%글리메피리드%' OR intervention_en LIKE '%glimepiride%') UNION ALL SELECT 'SGLT2', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%SGLT2%' OR intervention_en LIKE '%SGLT2%') UNION ALL SELECT 'GLP-1', COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND (intervention_kr LIKE '%GLP-1%' OR intervention_en LIKE '%GLP-1%')
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_id) AS total FROM v_cris_trials WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%'
  ```

> 국내 당뇨병 시험에서 가장 많이 쓰인 약물은 **메트포르민·인슐린·다파글리플로진·엠파글리플로진** 계열이며, 식약처 승인현황 기준으로는 **아토르바스타틴·다파글리플로진·DWP16001(신약 후보)·메트포르민·CKD-383** 순이다.
> **식약처 승인현황(성분명 기준, 대상질환 '당뇨' 포함)** — 성분이 표준명으로 기재되어 가장 깨끗한 집계다. 상위는 아토르바스타틴 16건, 다파글리플로진 15건, DWP16001 15건, 메트포르민 12건, CKD-383 11건, 사르포그렐레이트 10건, 피오글리타존 9건, 펜터민 7건, BR3006 7건이고, 그 뒤에 엠파글리플로진+리나글립틴 복합제 6건, CKD-393·CKD-379·BAY 94-8862 각 6건이 이어진다. 스타틴(아토르바스타틴·로수바스타틴·에제티미브 복합)과 SGLT2 억제제(다파·엠파글리플로진), DPP-4 억제제(리나·시타·테네리글립틴)가 당뇨 시험 약물의 주류를 이룬다.
> **CRIS 등록 시험(제목에 당뇨/diabetes, 총 268건)에서 약물 키워드가 걸린 건수** — 중재명이 자유 서술이라 키워드 포함 방식으로 센 값이다: 메트포르민 26건, 인슐린 18건, 다파글리플로진 12건, 엠파글리플로진 11건, 리나글립틴 6건, 글리메피리드 6건, SGLT2 언급 6건, 시타글립틴 4건, 피오글리타존 3건, GLP-1 언급 3건. 1군 표준치료제인 메트포르민이 배경약·대조약으로도 가장 자주 등장하고, SGLT2 억제제가 그 다음 축을 이룬다.
> **한계**
> - 약물·질환은 자유 텍스트라 **문자열 매칭**으로 센 값이다. CRIS 중재명은 시험마다 서술 형태가 달라(복합제·기기·생활습관 중재가 섞임) 약물별 전수 집계가 불가능하며, 위 CRIS 수치는 "해당 키워드가 중재 서술에 포함된 시험 수"다. 키워드에 안 담긴 약물은 빠져 있다.
> - 한 시험에 여러 약물이 들어가므로 약물별 건수의 합은 모수(식약처 승인 건수, CRIS 268건)보다 크다.
> - 식약처 상세(성분·질환)는 2019년 이후 승인분만 채워져 있다. CRIS 사본 수집 시각: 2026-09-10.
> - 이는 등록·승인 기재사항의 집계이지 약물 효과나 우수성 판정이 아니다.

## ✅ 실시기관 — "당뇨병 임상시험을 가장 많이 실시한 병원은"

- 41초 · 도구 5회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT s.site, COUNT(DISTINCT s.trial_id) AS trials, (SELECT COUNT(DISTINCT trial_id) FROM v_cris_trials WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AS total_diabetes FROM v_cris_site s JOIN v_cris_trials t ON t.trial_id = s.trial_id WHERE t.title_kr LIKE '%당뇨%' OR t.title_en LIKE '%diabetes%' GROUP BY s.site ORDER BY trials DESC LIMIT 15
  ```
  ```sql
  SELECT s.site, COUNT(DISTINCT s.trial_seq) AS trials FROM v_mfds_sites s JOIN v_mfds_trials t ON t.trial_seq = s.trial_seq WHERE t.target_disease LIKE '%당뇨%' GROUP BY s.site ORDER BY trials DESC LIMIT 10
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_seq) AS total_diabetes FROM v_mfds_trials WHERE target_disease LIKE '%당뇨%'
  ```

> **국내(CRIS 등록 기준)로는 가톨릭대학교 서울성모병원이 47건으로 가장 많습니다.** 당뇨병 시험 전체 268건(제목에 '당뇨' 또는 'diabetes'가 든 CRIS 등록 시험)을 실시기관별로 세면 상위는 다음과 같습니다.
> 1. 가톨릭대 서울성모병원 — 47건
> 2. 연세대 세브란스병원 — 38건
> 3. 삼성서울병원 · 분당서울대병원 — 각 37건
> 5. 고려대 안산병원 — 35건
> 6. 서울아산병원 — 33건
> 7. 강동경희대병원 — 30건
> 8. 강북삼성병원 — 28건
> 9. 아주대병원 — 27건
> 10. 서울대병원 · 경희대병원 — 각 25건
> **식약처 승인현황(의약품 임상시험 승인) 기준으로 보면 순위가 달라집니다.** 당뇨 관련 승인 731건 중 실시기관 1위는 에이치플러스양지병원(243건), 2위 부민병원(139건), 3위 바이오인프라(81건)이고, 대학병원 중에서는 세브란스병원(76건)·분당서울대병원(72건)·서울대병원(71건)이 앞섭니다. 이 목록에는 CRO·전문기관이 상위에 섞여 있어, "병원"만 보면 에이치플러스양지병원이 최다입니다.
> 두 출처는 모수가 다릅니다 — CRIS는 연구자 주도·관찰연구까지 포함한 등록 건수, 식약처는 의약품 승인 건수라서 직접 비교하면 안 됩니다.
> **한계**
> - "우수성"을 판정한 것이 아니라 **등록·승인 건수**의 순위입니다.
> - 검색어는 제목의 '당뇨'/'diabetes' 문자열 매칭이라, 제목에 이 단어가 없는 당뇨 시험은 빠졌을 수 있습니다.
> - 한 시험에 실시기관이 여럿(다기관)일 수 있어 기관별 건수의 합은 모수(268건·731건)보다 커집니다.
> - 기관명은 표준명 뷰로 묶었으나 매핑되지 않은 원문 표기는 갈려 있을 수 있습니다.
> - CRIS 사본 수집 시각 2026-09-10, 식약처는 공식 API 사본 기준이며, 다른 레지스트리(미국·EU 등)는 세지 않았습니다.

## ✅ ctgov-의뢰사 — "미국에서 모집 중인 당뇨병 시험은 어느 의뢰사가 많이 하나"

- 20초 · 도구 3회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(aact)
  ```sql
  WITH base AS (
    SELECT s.nct_id, s.source
    FROM studies s
    JOIN conditions c ON c.nct_id = s.nct_id
    JOIN calculated_values v ON v.nct_id = s.nct_id
    WHERE c.downcase_name LIKE '%diabetes%'
      AND s.overall_status = 'RECRUITING'
      AND v.has_us_facility
  )
  SELECT (SELECT COUNT(DISTINCT nct_id) FROM base) AS total_trials,
         source AS sponsor,
         COUNT(DISTINCT nct_id) AS trials
  FROM base
  GROUP BY source
  ORDER BY trials DESC
  LIMIT 15
  ```

> 미국에 실시기관을 둔 모집 중(RECRUITING) 당뇨병 시험은 총 **594건**이고, 의뢰사(주 의뢰기관)로는 **텍사스대학교 샌안토니오 보건과학센터(University of Texas Health Science Center at San Antonio)가 14건으로 가장 많습니다**. 상위는 대체로 대학·학술기관이 차지합니다:
> 1. UT Health Science Center at San Antonio — 14건
> 2. University of Colorado, Denver — 13건
> 3. Mayo Clinic — 12건 / Ohio State University — 12건
> 5. University of Alabama at Birmingham · University of Virginia · Johns Hopkins University · Yale University — 각 11건
> 9. NIH Clinical Center — 10건, Indiana University — 9건, Emory University · University of Michigan — 각 8건
> 제약회사보다 대학병원·학술기관이 주 의뢰기관인 시험이 상위권을 이루는 것이 특징입니다.
> **한계**
> - "우수함"이 아니라 **등록 건수** 순위입니다. 질환은 `diabetes` 포함 표기(당뇨병 전반, 임신성 당뇨 등 포함)로, 상태는 시험 단위 RECRUITING, 미국은 시험에 미국 실시기관이 1곳 이상 있는 것으로 셌습니다.
> - 의뢰사 이름은 레지스트리 원문 그대로라 표기가 다르면 갈려 세어질 수 있습니다(표준명 마스터 없음). 주 의뢰기관(source) 기준이며 공동 의뢰사는 제외했습니다.
> - ClinicalTrials.gov 사본(AACT, CTTI) 기준이며 최신 갱신일은 2026-09-11 — 실제 레지스트리보다 하루쯤 늦을 수 있습니다. ISRCTN·EU CTIS 등 다른 레지스트리는 세지 않았습니다.

## ✅ 기관-연구자-순위 — "전북대학교병원 연구자들의 임상시험 건수에 대한 등수"

- 25초 · 도구 4회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT pi_name_kr, MIN(pi_affiliation_kr) AS aff, COUNT(DISTINCT trial_id) AS n FROM v_cris_trials WHERE pi_affiliation_kr LIKE '%전북대학교병원%' GROUP BY pi_name_kr ORDER BY n DESC LIMIT 20
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_id) AS total_trials, COUNT(DISTINCT pi_name_kr) AS total_pis FROM v_cris_trials WHERE pi_affiliation_kr LIKE '%전북대학교병원%'
  ```

> 전북대학교병원 소속 연구책임자를 CRIS 등록 임상시험 건수 순으로 세면 **1위 김민걸(42건), 2위 채수완(36건), 3위 고명환(18건), 4위 정영철(16건), 5위 김기욱(12건)** 입니다. 병원 전체로는 228건의 시험에 연구책임자 57명이 등록돼 있고, 상위 20명의 명단은 다음과 같습니다.
> 1. 김민걸 42건
> 2. 채수완 36건
> 3. 고명환 18건
> 4. 정영철 16건
> 5. 김기욱 12건
> 6. 문설주 7건
> 7. 두아람 6건 · 윤선중 6건 (동률)
> 9. 박진 5건 · 오선영 5건 · 원유희 5건 (동률)
> 12. 김대현 4건 · 손지선 4건 · 황윤수 4건 (동률)
> 15. 김동찬 3건 · 서정환 3건 · 이상록 3건 · 이선영 3건 · 이승옥 3건 (동률)
> 20. 김고운 2건
> 상위 20명이 병원 전체 시험의 약 8할(187건)을 맡고 있어, 소수 핵심 연구자에게 등록이 집중된 분포입니다. 21위 이하(37명)는 대부분 1~2건 수준입니다.
> **한계**
> - "우수성"을 판정한 것이 아니라 **CRIS 등록 건수**의 순위입니다. 시험의 규모·질·결과는 반영하지 않습니다.
> - 근거는 CRIS(질병관리청 임상연구정보서비스) 공식 API 사본(수집 2026-09-10)이며, 식약처 승인현황이나 미국 ClinicalTrials.gov 등 다른 레지스트리는 세지 않았습니다.
> - 소속은 시험 등록 시 기재된 연구책임자 소속(`pi_affiliation_kr`에 '전북대학교병원' 포함) 기준이고, 동명이인은 갈라내지 않았습니다. 실시기관 기준으로 보면 수치가 달라질 수 있습니다.
> - 한 시험에 연구책임자가 여럿이면 각각 세어졌으므로 개인별 건수의 합이 병원 총 시험 수(228건)와 정확히 일치하지 않을 수 있습니다.

## ✅ 식약처-승인 — "식약처 승인 기준으로 최근 3년간 당뇨병 임상시험을 가장 많이 승인받은 의뢰사는"

- 34초 · 도구 8회 · 플레이북 ranking · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT SUBSTR(approval_date,1,4) AS year, COUNT(DISTINCT trial_seq) AS approvals FROM v_mfds_trials WHERE target_disease LIKE '%당뇨%' OR target_disease LIKE '%diabetes%' GROUP BY year ORDER BY year
  ```
  ```sql
  SELECT sponsor, COUNT(DISTINCT trial_seq) AS approvals FROM v_mfds_trials WHERE (target_disease LIKE '%당뇨%' OR target_disease LIKE '%diabetes%') AND approval_date >= date((SELECT MAX(approval_date) FROM v_mfds_trials), '-3 year') GROUP BY sponsor ORDER BY approvals DESC LIMIT 15
  ```
  ```sql
  SELECT MIN(approval_date) AS min_d, MAX(approval_date) AS max_d FROM v_mfds_trials WHERE target_disease LIKE '%당뇨%' OR target_disease LIKE '%diabetes%'
  ```
  ```sql
  SELECT sponsor, COUNT(DISTINCT trial_seq) AS approvals FROM v_mfds_trials WHERE (target_disease LIKE '%당뇨%' OR target_disease LIKE '%diabetes%') AND approval_date >= '20230910' GROUP BY sponsor ORDER BY approvals DESC LIMIT 15
  ```
  ```sql
  SELECT sponsor, COUNT(DISTINCT trial_seq) AS approvals FROM v_mfds_trials WHERE (target_disease LIKE '%당뇨%' OR target_disease LIKE '%diabetes%') AND approval_date >= '20240101' GROUP BY sponsor ORDER BY approvals DESC LIMIT 15
  ```
  ```sql
  SELECT COUNT(DISTINCT trial_seq) AS total FROM v_mfds_trials WHERE (target_disease LIKE '%당뇨%' OR target_disease LIKE '%diabetes%') AND approval_date >= '20230910'
  ```

> **식약처 승인 기준 최근 3년(2023-09-10~2026-09-10) 당뇨병 임상시험 승인 1위는 ㈜보령으로 16건**입니다. 같은 기간 승인된 당뇨 관련 시험은 총 214건이고, 상위는 다음과 같습니다.
> - ㈜보령 16건
> - (주)대웅제약 11건
> - (주)종근당 10건
> - 아주약품(주) 9건
> - 한국프라임제약·애드파마·동아에스티·노보노디스크제약·제뉴파마 각 8건
> 참고로 기준을 "2024년 이후"로 잡으면 순위가 달라집니다 — 대웅제약 10건, 아주약품·보령·종근당 각 9건 순이며, 보령은 2위로 내려옵니다. 즉 상위권(보령·대웅·종근당·아주)은 겹치지만 1위는 기간 경계에 민감합니다.
> 연도별로 보면 당뇨 관련 승인은 2021년 139건으로 정점을 찍은 뒤 2023년 101건, 2024년 107건으로 완만한 수준을 유지하고 있습니다(2025년 40건·2026년 44건은 아직 진행 중인 연도라 부분 집계입니다).
> **한계**
> - "가장 많이"는 승인 건수 기준이며 연구의 우수성을 판정하는 것은 아닙니다.
> - 대상질환(target_disease)은 자유 텍스트라 '당뇨'·'diabetes' 문자열 매칭으로 세었기 때문에, 기재가 다른 당뇨 관련 시험 일부가 빠졌을 수 있습니다.
> - 한 시험에 의뢰사가 여럿일 수 있어 의뢰사별 건수의 합은 모수(214건)보다 클 수 있습니다.
> - 승인일 기준 최근 3년의 경계(2023-09-10)는 사본 내 최신 승인일에서 역산한 값이며, "2024년 이후"로 잡으면 1위가 달라지는 등 기간 정의에 민감합니다.
> - 출처는 식약처 임상시험 승인현황 공식 API 사본(KCTIS)이며, 다른 레지스트리(CRIS 등)는 세지 않았습니다.

## ✅ 결과-공개 — "국내 당뇨병 임상시험 중 결과가 공개된 비율은"

- 23초 · 도구 5회 · 플레이북 by-axis-analysis · 레코드 0
- 호출: load_playbook → kctis_describe_schema → kctis_query_sql(kctis) → kctis_query_sql(kctis) → kctis_query_sql(kctis)
  ```sql
  SELECT COUNT(*) AS total, SUM(CASE WHEN has_results = 1 THEN 1 ELSE 0 END) AS with_results FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%'
  ```
  ```sql
  SELECT study_type, COUNT(*) AS total, SUM(CASE WHEN has_results = 1 THEN 1 ELSE 0 END) AS with_results FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%' GROUP BY study_type
  ```
  ```sql
  SELECT status_en, COUNT(*) AS total, SUM(CASE WHEN has_results = 1 THEN 1 ELSE 0 END) AS with_results FROM v_cris_unified WHERE title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%' GROUP BY status_en ORDER BY total DESC
  ```

> **국내 당뇨병 임상시험 268건 중 결과가 공개된 것은 72건, 약 27%입니다.** (CRIS 등록 기준)
> - **연구 유형별**: 중재연구 205건 중 54건(26%), 관찰연구 63건 중 18건(29%) — 유형 간 차이는 크지 않습니다.
> - **진행 상태별**: 완료(Completed) 시험 91건 중 47건(52%)으로 완료 시험의 절반 정도만 결과를 공개했습니다. 모집 중 100건 중 12건, 모집 전 51건 중 5건, 진행 중(모집 종료) 17건 중 3건, 조기 종료 8건 중 4건도 결과를 공개한 것으로 기재돼 있습니다.
> - 완료 시험의 공개율(52%)이 전체 평균(27%)보다 높은 것은, 아직 진행 중이거나 시작 전인 시험은 결과가 나올 시점이 아니기 때문으로 보입니다.
> **한계**
> - 출처는 CRIS 공식 API 사본(수집 2026-09-10)이며, 결과 공개 여부(has_results)는 웹 수집분으로 보완한 통합 뷰 기준입니다.
> - 당뇨병 시험은 제목의 문자열 매칭(국문 '당뇨' / 영문 'diabetes')으로 골랐으므로, 제목에 당뇨가 드러나지 않은 시험은 빠졌을 수 있습니다.
> - "결과 공개"는 CRIS 등록 정보상의 표기이며, 논문 게시나 레지스트리 밖 공개 여부는 이 수치에 담기지 않습니다.

## ✅ 조건-검색 — "모집 중인 당뇨병 3상 시험"

- 72초 · 도구 10회 · 플레이북 condition-drug · 레코드 23
- 호출: load_playbook → kctis_describe_schema → kctis_describe_schema → list_registries_and_capabilities → kctis_query_sql(kctis) → kctis_query_sql(aact) → search_trials_multi_registry → search_trials_multi_registry → kctis_query_sql(kctis) → kctis_query_sql(aact)
  ```sql
  SELECT phase, COUNT(*) AS n FROM v_cris_unified WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND status_en = 'Recruiting' GROUP BY phase ORDER BY n DESC
  ```
  ```sql
  SELECT COUNT(DISTINCT s.nct_id) AS n FROM studies s JOIN conditions c ON c.nct_id = s.nct_id WHERE c.downcase_name LIKE '%diabetes%' AND s.overall_status = 'RECRUITING' AND s.phase = 'PHASE3'
  ```
  ```sql
  SELECT trial_id, title_kr, title_en, pi_name_kr, pi_affiliation_kr, date_registration FROM v_cris_unified WHERE (title_kr LIKE '%당뇨%' OR title_en LIKE '%diabetes%') AND status_en = 'Recruiting' AND phase = 'Phase3' ORDER BY date_registration DESC
  ```
  ```sql
  SELECT s.nct_id, s.brief_title, s.source AS sponsor, s.start_date FROM studies s JOIN conditions c ON c.nct_id = s.nct_id WHERE c.downcase_name LIKE '%diabetes%' AND s.overall_status = 'RECRUITING' AND s.phase = 'PHASE3' ORDER BY s.start_date DESC NULLS LAST LIMIT 10
  ```

> **모집 중인 당뇨병 3상 시험은 레지스트리별로 이렇습니다 — 국내(CRIS) 9건, 미국(ClinicalTrials.gov) 72건, 영국(ISRCTN) 18건 중 현재 모집 1건, EU(CTIS)는 상(단계)으로 물어볼 수 없습니다.** 건수는 각 레지스트리별로 따로이며 더하지 않았습니다(같은 시험이 여러 곳에 등록될 수 있습니다).
> **국내(CRIS) — 9건.** 당뇨 관련 모집 중 시험이 총 100건인데 그중 3상이 9건입니다. 최근 등록순으로:
> - [CRIS:KCT0011446] DLT2341/2342 추가병용 3상(제2형 당뇨, 메트포르민+DLT2343 대상) — 권혁상, 가톨릭대 여의도성모병원, 2026-01 등록
> - [CRIS:KCT0011219] 급성기질환·수술 직후 지속혈당모니터링(CGM) 혈당조절 — 고승현, 가톨릭대 성의교정, 2025-11
> - [CRIS:KCT0011173] 제2형 당뇨 메디컬 푸드 유효성 — 유원상, 단국대병원, 2025-11
> - [CRIS:KCT0007174] 위소매절제술 vs 십이지장공장우회술 대비(MEDUSA) — 박영석, 분당서울대병원, 2022-04
> - [CRIS:KCT0001405] Gemigliptin/Rosuvastatin 복합제 3상 — 차봉수, 세브란스병원, 2015-03
> - [CRIS:KCT0000946]·[CRIS:KCT0000801] LY2605541(기저 인슐린) 3상 2건 — 삼성서울병원·을지병원, 2013
> - [CRIS:KCT0000614]·[CRIS:KCT0000576] Dulaglutide 3상 2건 — 릴리(밍첸), 2012
> **미국(ClinicalTrials.gov) — 72건.** 최근 시작한 것들로는 UBT251 주사 3상(UNIGUIDE-2, United Bio-Technology) [CTGOV:NCT07653477], 경구 ASC30(Ascletis) [CTGOV:NCT07743450], BGM0504(BrightGene) [CTGOV:NCT07743983], survodutide(Boehringer Ingelheim) [CTGOV:NCT07754461], zenagamtide vs 인슐린 글라진(노보노디스크 AMBITION 7) [CTGOV:NCT07797335], 소아·청소년 CagriSema(노보노디스크) [CTGOV:NCT07282613] 등 GLP-1·인크레틴 계열이 눈에 띕니다.
> **영국(ISRCTN) — 18건 중 현재 모집 1건.** ISRCTN은 상태로 검색하는 축이 없어 당뇨 3상 전체를 받아 상태를 읽었는데, 모집 중인 것은 소아·청소년 제1형 당뇨 semaglutide 추가요법(Smile T1D, 버밍엄대, 240명) [ISRCTN:ISRCTN29694121] 하나뿐이고 나머지는 완료·중단 등입니다. **EU(CTIS)는 단계(phase) 검색 축이 없어** "모집 중인 3상"으로 좁힐 수 없습니다 — 당뇨 조건 시험은 206건 있습니다.
> **한계.** 국내 수치는 제목에 '당뇨/diabete

---
**13 통과 / 0 실패**
