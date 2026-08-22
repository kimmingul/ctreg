import type { Capability } from '../core/capability.js';
import type { FetchOpts, NormalizedQuery } from '../core/query.js';
import { unsupportedError } from '../runtime/errors.js';

/**
 * 미지원 축을 조용히 무시하고 빈 결과를 내면, 에이전트가 "해당 시험 없음"과
 * "이 레지스트리는 그렇게 검색할 수 없음"을 구분하지 못한다. 반드시 exit 3 으로 알린다.
 */
export function assertSupported(cap: Capability, q: NormalizedQuery, fetch: FetchOpts): void {
  const axes: [keyof Capability['search'], boolean][] = [
    ['condition', q.condition !== undefined],
    ['intervention', q.intervention !== undefined],
    ['term', q.term !== undefined],
    ['title', q.title !== undefined],
    ['location', q.location !== undefined],
    ['sponsor', q.sponsor !== undefined],
    ['lead', q.lead !== undefined],
    ['id', q.id !== undefined],
    ['patient', q.patient !== undefined],
    ['status', (q.status?.length ?? 0) > 0],
    ['phase', (q.phase?.length ?? 0) > 0],
    ['studyType', q.studyType !== undefined],
    ['geo', q.near !== undefined],
    ['dateRange',
      [q.updatedSince, q.updatedBefore, q.startAfter, q.startBefore, q.completionAfter, q.completionBefore]
        .some((d) => d !== undefined)],
  ];

  for (const [axis, used] of axes) {
    if (used && !cap.search[axis]) {
      throw unsupportedError(
        `${cap.name} 은 '${axis}' 검색을 지원하지 않습니다`,
        `ctreg registries 로 이 레지스트리가 지원하는 축을 확인하세요. 결과가 없는 것이 아니라 조회 자체가 불가능합니다.`,
      );
    }
  }

  const wantAll = fetch.include.includes('all');
  const detailAxes: [keyof Capability['detail'], boolean][] = [
    ['eligibilityText', wantAll || fetch.include.includes('eligibility')],
    ['outcomes', wantAll || fetch.include.includes('outcomes')],
    ['contacts', wantAll || fetch.include.includes('contacts')],
  ];
  for (const [axis, used] of detailAxes) {
    if (used && !cap.detail[axis]) {
      throw unsupportedError(
        `${cap.name} 은 '${axis}' 를 제공하지 않습니다`,
        'ctreg registries 로 제공 섹션을 확인하세요.',
      );
    }
  }
}
