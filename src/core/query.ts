import type { StudyType, TrialPhase, TrialStatus } from './vocab.js';

export type IncludeSection = 'core' | 'eligibility' | 'outcomes' | 'contacts' | 'locations' | 'all';

/** 레지스트리 중립 검색 요청. 어댑터가 자기 문법으로 번역한다. */
export type NormalizedQuery = {
  condition?: string;
  intervention?: string;
  term?: string;
  title?: string;
  location?: string;
  outcomeQuery?: string;
  sponsor?: string;
  lead?: string;
  id?: string;
  patient?: string;

  status?: TrialStatus[];
  phase?: TrialPhase[];
  studyType?: StudyType;

  near?: { lat: number; lon: number };
  radius?: { value: number; unit: 'km' | 'mi' };

  updatedSince?: string;
  updatedBefore?: string;
  startAfter?: string;
  startBefore?: string;
  completionAfter?: string;
  completionBefore?: string;

  page?: number;
  pageSize?: number;
  sort?: string;
  /** CT.gov 등은 페이지 번호가 아니라 불투명 커서로 페이지네이션한다 — §5.1. */
  pageToken?: string;
};

export type FetchOpts = {
  include: IncludeSection[];
  caps: { locations: number; eligibilityChars: number; outcomes: number };
  cacheMode: 'use' | 'refresh' | 'off';
  raw: boolean;
  signal?: AbortSignal;
  /**
   * 조회 옵션의 기준점. `NormalizedQuery.near` 는 검색 필터(등록 축소)이고,
   * 이건 매퍼가 각 사이트에 지점으로부터의 거리를 붙이고 정렬하기 위한 것이다 —
   * 두 계층은 다르며 둘 다 필요하다.
   */
  near?: { lat: number; lon: number };
};

export type ResultsOpts = {
  sections: ('outcomes' | 'adverse' | 'flow' | 'baseline')[];
  outcomeFilter?: string[];
  aeOrganFilter?: string;
  aeTermFilter?: string;
  full: boolean;
  cacheMode: 'use' | 'refresh' | 'off';
};

/** 스펙 §5.2 의 캡. 기본값과 상한. */
export const CAPS = {
  pageSize: { default: 20, max: 200 },
  locations: { default: 10, max: 200 },
  eligibilityChars: { default: 8000, max: 40000 },
  outcomes: { default: 20, max: 200 },
} as const;
