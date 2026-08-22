---
name: ctreg
description: >
  Use when the user asks about clinical trials — finding trials for a condition
  or a drug, checking whether a trial reported results or adverse events,
  looking up a trial by its registry identifier, or asking how many trials
  exist for something. Drives the `ctreg` command-line tool.
---

# ctreg — 임상시험 레지스트리 조회

`ctreg` 는 임상시험 레지스트리를 하나의 정규화된 스키마로 조회하는 명령줄 도구다.
레지스트리마다 다른 필드 이름과 값 어휘를 흡수하고, 요청률과 페이로드를 묶고,
무엇을 할 수 없는지 명시한다.

## 시작하기 전에

**도구가 있는지 확인하라.** `ctreg --help` 가 동작하지 않으면 아직 설치되지 않은 것이다.
추측으로 진행하지 말고 사용자에게 알려라 — 이 스킬은 이 도구 없이는 아무것도 할 수 없다.

**`ctreg registries` 를 먼저 불러라.** 어떤 레지스트리를 조회할 수 있고 각각이 무엇을
할 수 있는지가 거기 있다. 네트워크를 치지 않으므로 공짜다. 사용자의 질문이 이 도구가
다루지 않는 레지스트리에 관한 것이면 그 자리에서 알 수 있다.

**표면은 `--help` 가 말한다.** 커맨드와 옵션을 추측하지 마라. 없는 것을 지어내는 것보다
`--help` 를 한 번 더 읽는 것이 싸다.

## 출력을 읽는 법

**종료 코드로 분기하라.** 이 도구는 성공과 실패를 다른 코드로 구분하고, 실패의 종류도
구분한다. 코드마다 옳은 행동이 다르다 — 어떤 것은 재시도, 어떤 것은 요청 수정, 어떤 것은
사용자에게 한계를 알리는 것이다. 무엇이 무엇인지는 `--help` 가 말한다.

**경고를 반드시 읽어라.** 이 도구는 조용히 좁히거나 자르지 않는다 — 대신 출력에 경고를
남긴다. 경고를 읽지 않으면 잘린 목록을 전체로, 좁혀진 검색을 완전한 검색으로 오독하게
된다. 답을 사용자에게 전하기 전에 경고를 확인하고, 관련된 것은 답에 반영하라.

## 한계

이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.
