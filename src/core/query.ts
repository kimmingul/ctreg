import type { StudyType, TrialPhase, TrialStatus } from './vocab.js';

export type IncludeSection = 'core' | 'eligibility' | 'outcomes' | 'contacts' | 'locations' | 'all';

/**
 * 캐시 사용 방식. `--no-cache`/`--refresh` 가 이 세 값으로 접힌다.
 * 같은 유니온이 FetchOpts, ResultsOpts, http.ts 의 GetJsonOpts, 그리고 어댑터
 * 클라이언트까지 네 군데에 흩어져 있었고 그중 하나는 자기 사본을 따로 선언하고
 * 있었다 — 값을 하나 더할 때 네 곳을 같이 고쳐야 하는 병렬 어휘였다.
 */
export type CacheMode = 'use' | 'refresh' | 'off';

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

  pageSize?: number;
  sort?: string;
  /**
   * 불투명 커서. CT.gov 를 비롯해 페이지 번호 파라미터가 아예 없는 레지스트리가
   * 흔하므로 `page: number` 는 계약에 두지 않는다 — §5.1.
   */
  pageToken?: string;
};

export type FetchOpts = {
  include: IncludeSection[];
  caps: { locations: number; eligibilityChars: number; outcomes: number };
  cacheMode: CacheMode;
  raw: boolean;
  signal?: AbortSignal;
  /**
   * 조회 옵션의 기준점. `NormalizedQuery.near` 는 검색 필터(등록 축소)이고,
   * 이건 매퍼가 각 사이트에 지점으로부터의 거리를 붙이고 정렬하기 위한 것이다 —
   * 두 계층은 다르며 둘 다 필요하다.
   */
  near?: { lat: number; lon: number };
  /**
   * 조회를 좁힌 장소 문자열. `NormalizedQuery.location` 은 검색 필터(등록 축소)이고,
   * 이건 매퍼가 캡을 적용하기 전에 일치하는 사이트를 앞으로 보내기 위한 것이다.
   * `near` 와 정확히 같은 계층이다 — 필드 테스트에서 `--location` 으로 걸린 시험의
   * 81% 가 반환된 장소 목록에 매칭 사이트를 하나도 담지 못했다. 필터에 걸린 근거를
   * 잘라내고 보여주면 사용자는 그 시험이 왜 걸렸는지 알 수 없다.
   */
  locationTerm?: string;
};

export type ResultsOpts = {
  sections: ('outcomes' | 'adverse' | 'flow' | 'baseline')[];
  outcomeFilter?: string[];
  aeOrganFilter?: string;
  aeTermFilter?: string;
  full: boolean;
  cacheMode: CacheMode;
};

/** 스펙 §5.2 의 캡. 기본값과 상한. */
export const CAPS = {
  pageSize: { default: 20, max: 200 },
  locations: { default: 10, max: 200 },
  eligibilityChars: { default: 8000, max: 40000 },
  outcomes: { default: 20, max: 200 },
} as const;
