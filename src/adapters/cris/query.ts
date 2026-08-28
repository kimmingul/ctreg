import type { NormalizedQuery } from '../../core/query.js';
import { unsupportedError } from '../../runtime/errors.js';

/** 실측 2026-08-28: `numOfRows=100` 을 보내도 50개만 온다. 문서의 "최대 50" 과 일치한다. */
export const CRIS_MAX_PAGE_SIZE = 50;

/**
 * 공식 목록 API 의 질의 파라미터를 만든다.
 *
 * **이 API 가 받는 검색 입력은 `srchWord` 하나뿐이다**(포털 요청변수 표: serviceKey ·
 * resultType · srchWord · numOfRows · pageNo). 조건·중재·의뢰기관·상태·상·날짜를 따로
 * 거는 자리가 없다 — 그래서 이 어댑터가 신고하는 검색 축도 하나뿐이다.
 *
 * `srchWord` 가 무엇에 닿는지 실측했다(2026-08-28):
 * 당뇨병 197 · 고혈압 95 · diabetes 185(영문 제목) · 종근당 45 · Chong Kun Dang 42 ·
 * 전북대학교병원 177(기관) · KCT0000145 1(등록번호). **사람 이름에는 닿지 않는다**
 * (김민걸 0, Min-Gul Kim 0) — 연구자 축을 미지원으로 신고하는 근거다.
 */
export function buildListParams(
  q: NormalizedQuery,
  serviceKey: string,
  pageSize: number,
): Record<string, string | number> {
  const term = q.term?.trim();
  if (term === undefined || term === '') {
    /**
     * 검색어 없이 부르면 전체 12,501건의 첫 쪽이 온다. 그것을 "검색 결과" 로 내보내면
     * 사용자는 자기 질의가 통한 줄 안다 — 조용히 틀린 답이다. 물어볼 수 없다고 말한다.
     */
    throw unsupportedError(
      'CRIS 검색에는 --term 이 필요합니다',
      'CRIS 공식 API 가 받는 검색 입력은 자유 텍스트 하나뿐입니다. ' +
        '--condition 이나 --lead 같은 축은 이 레지스트리에 없으니 그 말을 --term 에 담아 주세요. ' +
        '--investigator 도 혼자서는 쓸 수 없습니다 — 후보를 하나씩 열어 대조하므로 ' +
        '--term 으로 먼저 좁혀야 합니다(기관명이 잘 듭니다).',
    );
  }

  return {
    serviceKey,
    resultType: 'json',
    srchWord: term,
    numOfRows: Math.min(pageSize, CRIS_MAX_PAGE_SIZE),
    pageNo: 1,
  };
}

/**
 * `--page-token` 은 쪽 번호 그대로다. 실측: 끝을 넘긴 쪽은 오류가 아니라 `items: []` 를
 * 낸다 — 그래서 "빈 쪽" 과 "없는 쪽" 이 구별되지 않고, 토큰은 남은 것이 있을 때만 낸다.
 */
export function parsePageToken(token: string | undefined): number {
  if (token === undefined) return 1;
  const n = Number(token);
  if (!Number.isInteger(n) || n < 1) {
    throw unsupportedError(
      `CRIS 페이지 토큰을 읽지 못했습니다: '${token}'`,
      'ctreg 가 낸 nextPageToken 을 그대로 넘겨 주세요.',
    );
  }
  return n;
}
