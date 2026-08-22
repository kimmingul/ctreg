# S4 Haiku 필드 테스트

## 1. 실행한 모든 명령과 출력

### 명령 1: ctreg --help
```
$ PATH=/tmp/ctreg-bin:$PATH ctreg --help

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

### 명령 2: ctreg registries
```
$ PATH=/tmp/ctreg-bin:$PATH ctreg registries

{
  "query": {
    "registries": [
      "ctgov"
    ]
  },
  "registries": [
    {
      "registry": "ctgov",
      "status": "ok"
    }
  ],
  "warnings": [],
  "data": [
    {
      "key": "ctgov",
      "name": "ClinicalTrials.gov",
      "region": "US / global",
      "search": {
        "condition": true,
        "intervention": true,
        "term": true,
        "title": true,
        "sponsor": true,
        "lead": true,
        "location": true,
        "id": true,
        "patient": true,
        "outcomeQuery": true,
        "geo": true,
        "geoNeedsCoords": true,
        "status": true,
        "phase": true,
        "studyType": true,
        "dateRange": true
      },
      "detail": {
        "eligibilityText": true,
        "outcomes": true,
        "contacts": true
      },
      "results": true,
      "count": true,
      "limits": {
        "maxPageSize": 200,
        "ratePerSec": 1,
        "maxBatchIds": 50
      }
    }
  ]
}
```

### 명령 3: ctreg get NCT04280705 NCT00000102 NCT99999999 --format json
```
$ PATH=/tmp/ctreg-bin:$PATH CTREG_CACHE_DIR=/tmp/ctreg-ft-s4h ctreg get NCT04280705 NCT00000102 NCT99999999 --format json

{
  "query": {
    "ids": [
      "NCT04280705",
      "NCT00000102",
      "NCT99999999"
    ]
  },
  "registries": [
    {
      "registry": "ctgov",
      "status": "ok",
      "returned": 2
    }
  ],
  "warnings": [
    {
      "code": "locations_truncated",
      "message": "장소 60곳 중 10곳만 담았습니다.",
      "id": "CTGOV:NCT04280705",
      "at": 10
    },
    {
      "code": "not_found",
      "message": "ClinicalTrials.gov 에서 찾지 못했습니다.",
      "id": "CTGOV:NCT99999999"
    }
  ],
  "data": [
    {
      "id": "CTGOV:NCT00000102",
      "registry": "ctgov",
      "registryId": "NCT00000102",
      "crossIds": [
        {
          "registry": "NIH",
          "id": "M01RR001070"
        }
      ],
      "url": "https://clinicaltrials.gov/study/NCT00000102",
      "title": "Congenital Adrenal Hyperplasia: Calcium Channels as Therapeutic Targets",
      "status": "completed",
      "statusRaw": "COMPLETED",
      "phase": [
        "phase_1",
        "phase_2"
      ],
      "phaseRaw": [
        "PHASE1",
        "PHASE2"
      ],
      "studyType": "interventional",
      "studyTypeRaw": "INTERVENTIONAL",
      "conditions": [
        "Congenital Adrenal Hyperplasia"
      ],
      "interventions": [
        {
          "type": "DRUG",
          "name": "Nifedipine"
        }
      ],
      "sponsor": {
        "lead": "National Center for Research Resources (NCRR)"
      },
      "dates": {
        "firstPosted": "1999-11-04",
        "lastUpdated": "2005-06-24"
      },
      "locations": [
        {
          "facility": "Medical University of South Carolina",
          "city": "Charleston",
          "state": "South Carolina",
          "country": "United States",
          "geo": {
            "lat": 32.77632,
            "lon": -79.93275
          }
        }
      ],
      "locationsTotal": 1,
      "hasResults": false,
      "fetchedAt": "2026-08-22T11:06:02.481Z"
    },
    {
      "id": "CTGOV:NCT04280705",
      "registry": "ctgov",
      "registryId": "NCT04280705",
      "url": "https://clinicaltrials.gov/study/NCT04280705",
      "title": "Adaptive COVID-19 Treatment Trial (ACTT)",
      "officialTitle": "A Multicenter, Adaptive, Randomized Blinded Controlled Trial of the Safety and Efficacy of Investigational Therapeutics for the Treatment of COVID-19 in Hospitalized Adults",
      "status": "completed",
      "statusRaw": "COMPLETED",
      "phase": [
        "phase_3"
      ],
      "phaseRaw": [
        "PHASE3"
      ],
      "studyType": "interventional",
      "studyTypeRaw": "INTERVENTIONAL",
      "conditions": [
        "COVID-19"
      ],
      "interventions": [
        {
          "type": "OTHER",
          "name": "Placebo"
        },
        {
          "type": "DRUG",
          "name": "Remdesivir"
        }
      ],
      "sponsor": {
        "lead": "National Institute of Allergy and Infectious Diseases (NIAID)"
      },
      "enrollment": {
        "count": 1062,
        "basis": "actual"
      },
      "dates": {
        "start": "2020-02-21",
        "primaryCompletion": "2020-05-21",
        "completion": "2020-05-21",
        "firstPosted": "2020-02-21",
        "lastUpdated": "2022-03-14"
      },
      "locations": [
        {
          "facility": "University of Alabama at Birmingham School of Medicine - Infectious Disease",
          "city": "Birmingham",
          "state": "Alabama",
          "country": "United States",
          "geo": {
            "lat": 33.52066,
            "lon": -86.80249
          }
        },
        {
          "facility": "University of California San Diego Health - Jacobs Medical Center",
          "city": "La Jolla",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 32.84727,
            "lon": -117.2742
          }
        },
        {
          "facility": "University of California Los Angeles Medical Center - Westwood Clinic",
          "city": "Los Angeles",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 34.05223,
            "lon": -118.24368
          }
        },
        {
          "facility": "University of California Irvine Medical Center - Infectious Disease",
          "city": "Orange",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 33.78779,
            "lon": -117.85311
          }
        },
        {
          "facility": "VA Palo Alto Health Care System - Infectious Diseases",
          "city": "Palo Alto",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 37.44188,
            "lon": -122.14302
          }
        },
        {
          "facility": "University of California Davis Medical Center - Internal Medicine - Infectious Disease",
          "city": "Sacramento",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 38.58157,
            "lon": -121.4944
          }
        },
        {
          "facility": "Naval Medical Center San Diego - Infectious Disease Clinic",
          "city": "San Diego",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 32.71571,
            "lon": -117.16472
          }
        },
        {
          "facility": "University of California San Francisco - Zuckerberg San Francisco General Hospital - Division of Human Immunodeficiency Virus, Infectious Disease, and Global Medicine",
          "city": "San Francisco",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 37.77493,
            "lon": -122.41942
          }
        },
        {
          "facility": "Stanford University - Stanford Hospital and Clinics - Pediatrics - Infectious Diseases",
          "city": "Stanford",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 37.42411,
            "lon": -122.16608
          }
        },
        {
          "facility": "Cedars Sinai Medical Center",
          "city": "West Hollywood",
          "state": "California",
          "country": "United States",
          "geo": {
            "lat": 34.09001,
            "lon": -118.36174
          }
        }
      ],
      "locationsTotal": 60,
      "hasResults": true,
      "fetchedAt": "2026-08-22T11:06:02.481Z"
    }
  ]
}
```

## 2. 사용자의 질문에 대한 최종 답

세 시험 중 두 개를 찾았습니다:

### NCT04280705 — Adaptive COVID-19 Treatment Trial (ACTT)
- **상태**: 완료됨
- **단계**: Phase 3
- **조건**: COVID-19
- **중재**: Placebo, Remdesivir
- **후원자**: National Institute of Allergy and Infectious Diseases (NIAID)
- **참가자**: 1,062명 (실제 등록)
- **진행 기간**: 2020-02-21 ~ 2020-05-21
- **결과**: 공개됨 (유)
- **웹사이트**: https://clinicaltrials.gov/study/NCT04280705
- **주의**: 60개 장소 중 처음 10개만 포함되었습니다.

### NCT00000102 — Congenital Adrenal Hyperplasia: Calcium Channels as Therapeutic Targets
- **상태**: 완료됨
- **단계**: Phase 1/2
- **조건**: Congenital Adrenal Hyperplasia (선천성 부신 과형성)
- **중재**: Nifedipine
- **후원자**: National Center for Research Resources (NCRR)
- **장소**: Medical University of South Carolina (Charleston, SC, USA)
- **결과**: 공개되지 않음 (무)
- **공개 날짜**: 1999-11-04
- **마지막 업데이트**: 2005-06-24
- **웹사이트**: https://clinicaltrials.gov/study/NCT00000102

### NCT99999999
- **상태**: ClinicalTrials.gov에서 찾지 못했습니다.
- 이 ID는 존재하지 않거나 등록되지 않은 것으로 보입니다.

## 3. 헤맨 지점

없음. 도구의 사용법과 지침이 명확했고, 명령 실행이 직접적이었습니다.

## 4. 확신이 없는 지점

없음. 
- 도구가 정상 작동했고, 각 단계의 명령이 예상한 결과를 반환했습니다.
- 경고 메시지는 명확했습니다 (NCT04280705의 장소 자르기, NCT99999999 미발견).
- JSON 응답은 완전하고 해석하기 쉬웠습니다.
