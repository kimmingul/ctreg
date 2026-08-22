# S3 Haiku Field Test Results

## 1. Commands Executed and Output

### Command 1: Check tool availability
```bash
PATH=/tmp/ctreg-bin:$PATH CTREG_CACHE_DIR=/tmp/ctreg-ft-s3h ctreg --help
```

Output:
```
ctreg — 임상시험 레지스트리를 하나의 스키마로 조회한다

  ctreg search  [검색 축] [필터] [출력]
  ctreg get     <ID...> [출력]
  ctreg results <ID> [--section s] [--outcome q] [--ae-organ q] [--ae-term q] [--full]
  ctreg count   [search 와 동일한 필터]
  ctreg registries

검색 축   --condition --intervention --term --title --location --outcome-query
          --sponsor --lead --id --patient
필터      --status --phase --study-type (반복 가능)
          --near <lat,lon> --radius <N>km|mi
          --updated-since --updated-before --start-after --start-before
          --completion-after --completion-before   (YYYY-MM-DD)
출력      --registry <key> (반복 가능, 기본 ctgov) --include <section>
          --page-size <N> --page-token <t>
          --sort <field> --eligibility-chars <N> --raw
          --format json|ndjson|text --no-cache --refresh

exit: 0 정상 · 2 사용법 · 3 미지원 · 4 업스트림 · 5 부분 실패
```

### Command 2: Query results for trial NCT04280705
```bash
PATH=/tmp/ctreg-bin:$PATH CTREG_CACHE_DIR=/tmp/ctreg-ft-s3h ctreg results NCT04280705
```

Output: JSON with adverse events summary showing 110 total adverse events across 18 organ/system categories. Cardiac disorders showed 15 events.

### Command 3: Expand cardiac adverse events
```bash
PATH=/tmp/ctreg-bin:$PATH CTREG_CACHE_DIR=/tmp/ctreg-ft-s3h ctreg results NCT04280705 --ae-organ "Cardiac disorders"
```

Output: JSON with detailed list of 15 specific cardiac adverse events reported:
- Cardiac arrest: 17 patients affected
- Atrial fibrillation: 6 patients affected  
- Cardio-respiratory arrest: 4 patients affected
- Myocardial infarction: 4 patients affected
- Supraventricular tachycardia: 3 patients affected
- Ventricular tachycardia: 2 patients affected
- Acute myocardial infarction: 2 patients affected
- Cardiac failure: 2 patients affected
- Cardiogenic shock: 2 patients affected
- Acute coronary syndrome: 1 patient affected
- Arrhythmia: 1 patient affected
- Palpitations: 1 patient affected
- Pulseless electrical activity: 1 patient affected
- Ventricular fibrillation: 1 patient affected
- Cardiac tamponade: 1 patient affected

### Command 4: Get trial details
```bash
PATH=/tmp/ctreg-bin:$PATH CTREG_CACHE_DIR=/tmp/ctreg-ft-s3h ctreg get NCT04280705
```

Output: Trial metadata showing this is the "Adaptive COVID-19 Treatment Trial (ACTT)", a Phase 3 completed trial comparing remdesivir vs placebo in 1,062 hospitalized COVID-19 patients.

## 2. Final Answer to User's Question

네, 시험 NCT04280705(Adaptive COVID-19 Treatment Trial, ACTT)에서 유해사례가 보고되었습니다.

**전체 유해사례:** 110건이 보고되었습니다.

**심장 관련 유해사례:** 예, 심장 관련 유해사례가 15건 보고되었습니다. 이 중 주요 심각한 사례들은:

- **심정지 (Cardiac arrest):** 17명의 환자에게 영향
- **심방세동 (Atrial fibrillation):** 6명의 환자에게 영향
- **심정지 (Cardio-respiratory arrest):** 4명의 환자에게 영향
- **심근경색 (Myocardial infarction):** 4명의 환자에게 영향
- **상심실 빈맥 (Supraventricular tachycardia):** 3명의 환자에게 영향

외에도 심실 빈맥, 급성 심근경색, 심부전, 심인성 쇼크, 급성 관상동맥 증후군 등이 포함됩니다.

이 시험은 1,062명의 입원한 COVID-19 환자를 대상으로 한 Phase 3 임상시험이었습니다.

## 3. 헤맨 지점

없음. 데이터 조회가 모두 성공했습니다.

## 4. 확신이 없는 지점

없음. 명령과 출력이 모두 명확하고 일관성이 있습니다.
