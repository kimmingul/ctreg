import { XMLParser } from 'fast-xml-parser';
import { upstreamError } from '../../runtime/errors.js';

/**
 * 반복될 수 있는 요소들. XML 은 "한 번 나온 것" 과 "여러 번 나올 수 있는 것" 을 구별하지
 * 않으므로, 이 목록이 없으면 원소가 하나뿐인 응답에서 배열이 아니라 객체가 나온다 —
 * 그러면 시험이 하나인 검색 결과와 여럿인 결과가 서로 다른 코드 경로를 타고, 그 차이는
 * 픽스처가 여러 건일 때 영영 드러나지 않는다.
 */
const REPEATED = new Set([
  'trial',
  'fullTrial',
  'country2',
  'contact',
  'secondary_id',
  'prim_outcome',
  'sec_outcome',
  'sponsor_name',
  'source_name',
  'hc_code',
  'i_code',
]);

/**
 * `parseTagValue: false` 가 중요하다. 켜두면 파서가 값을 숫자로 바꾸는데, ISRCTN 의
 * 값 중에는 그러면 안 되는 것이 있다 — 예를 들어 앞자리 0 이 있는 식별자는 숫자가 되면서
 * 0 이 사라진다. 숫자가 필요한 자리(등록 인원)는 매퍼가 명시적으로 변환한다.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => REPEATED.has(name),
});

export function parseIsrctnXml(text: string): unknown {
  try {
    return parser.parse(text);
  } catch (cause) {
    throw upstreamError(
      'ISRCTN 응답을 XML 로 읽지 못했습니다',
      '업스트림이 XML 이 아닌 것(오류 페이지 등)을 돌려줬을 수 있습니다.',
      cause,
    );
  }
}

/** 빈 요소는 `''` 로 온다 — 값이 없는 것과 같이 다룬다(부재는 부재다). */
export function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** `isArray` 로 배열이 보장되지 않는 자리에서도 안전하게 목록으로 본다. */
export function list<T = unknown>(v: unknown): T[] {
  if (v === undefined || v === null || v === '') return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}
