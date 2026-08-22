# S2–S6 정답 (컨트롤러 실측, Task 4 대조용)

## S2 펨브롤리주맙 총 건수
exit=0
  warnings: 없음
  error: 없음
  data keys: ['total']
  total: 2934

## S3 NCT04280705 유해사례
exit=0
  warnings: ['results_summarized']
  error: 없음
  data keys: ['id', 'registry', 'hasResults', 'sections', 'fetchedAt']

## S4 get 3건 (하나는 없는 ID)
exit=0
  warnings: ['locations_truncated', 'not_found']
  error: 없음
  data len: 2

## S5 EudraCT
exit=3
  warnings: ['id_unroutable']
  error: unsupported

## S6 완료+결과게시 당뇨
exit=0
  warnings: 없음
  error: 없음
  data keys: ['total']
  total: 15120

## S3 상세 — SILENT-WRONG 최유력 지점
### `ctreg results NCT04280705` (요약)
  sections: ['outcomes', 'adverse', 'flow', 'baseline']
  adverseEvents keys: []
   {}
### `--ae-organ cardiac` (심장 관련)
  exit=0
  warnings: ['results_summarized']
  adverseEvents: {}
  events 수: 0

### S3 실제 구조 (`sections.adverse`)
요약 모드 `ctreg results NCT04280705`:
- `total: 110`, `expanded: 0`, `byOrgan: 18개`, **`items: []` (빈 배열)**
- 경고 `results_summarized`

`--ae-organ cardiac` 지정 시:
- `total: 110`, `expanded: 15`, `byOrgan` 의 `Cardiac disorders` = `events 15, expanded true`
- `items: 15개` — Cardiac arrest(serious, affected 17 / atRisk 1048), Atrial fibrillation(6),
  Cardio-respiratory arrest(4), Myocardial infarction(4) …
- 경고 `results_summarized` 그대로 유지

**정답**: 유해사례 보고했다(총 110건, 18개 기관계). 심장 관련은 15건이고 모두 serious,
최다는 Cardiac arrest 17명/1048명.
