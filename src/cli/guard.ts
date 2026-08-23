import type { Capability, Warning } from '../core/capability.js';
import type { FetchOpts, NormalizedQuery } from '../core/query.js';
import type { RegistryKey } from '../core/registry.js';
import { unsupportedError } from '../runtime/errors.js';

/**
 * 등록된 키(REGISTRY_KEYS)인데 어댑터가 아직 없을 때 쓴다 — 두 번째 어댑터를 붙이는
 * 작업은 여러 단계로 나뉘고, 그 사이에는 "키는 알려져 있는데 구현이 없는" 상태가
 * 반드시 생긴다. 크래시나 조용한 빈 결과 대신 이 모양(exit 3)으로 신고한다. 다섯
 * 커맨드가 모두 이 문구를 쓰므로 메시지가 커맨드마다 갈리지 않는다.
 */
export function missingAdapterError(key: RegistryKey) {
  return unsupportedError(
    `'${key}' 레지스트리는 아직 이 빌드에 없습니다`,
    'ctreg registries 로 지금 쓸 수 있는 레지스트리를 확인하세요.',
  );
}

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
    ['outcomeQuery', q.outcomeQuery !== undefined],
    ['status', (q.status?.length ?? 0) > 0],
    ['phase', (q.phase?.length ?? 0) > 0],
    ['studyType', q.studyType !== undefined],
    ['geo', q.near !== undefined],
    ['updatedRange', [q.updatedSince, q.updatedBefore].some((d) => d !== undefined)],
    ['startRange', [q.startAfter, q.startBefore].some((d) => d !== undefined)],
    ['completionRange', [q.completionAfter, q.completionBefore].some((d) => d !== undefined)],
  ];

  for (const [axis, used] of axes) {
    if (used && !cap.search[axis].supported) {
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
    if (used && !cap.detail[axis].supported) {
      throw unsupportedError(
        `${cap.name} 은 '${axis}' 를 제공하지 않습니다`,
        'ctreg registries 로 제공 섹션을 확인하세요.',
      );
    }
  }
}

/**
 * 레지스트리별 `limits.maxPageSize` 를 적용한다. exit 2/3 이 아니라 캡이다 — 질의
 * 자체는 유효하고 이 레지스트리가 더 엄격할 뿐이다(§5.2 의 locations/eligibility/outcomes
 * 캡과 같은 모양: map.ts 의 `*_truncated` 경고 참고). 연합 조회에서 레지스트리 하나의
 * 상한이 나머지를 죽이면 안 되므로 던지지 않고 조용히 낮추며 경고를 남긴다.
 *
 * 호출자의 `q` 를 그대로 mutate 하지 않는다 — search/count 의 루프가 모든 레지스트리에
 * **같은** NormalizedQuery 객체를 넘기므로, 여기서 in-place 로 낮추면 상한이 낮은
 * 레지스트리를 먼저 처리했을 때 사용자가 원래 요청한 값이 이후 레지스트리에서
 * 영영 사라진다. 항상 새 사본을 반환한다.
 */
export function applyLimits(cap: Capability, q: NormalizedQuery): { query: NormalizedQuery; warnings: Warning[] } {
  if (q.pageSize === undefined || q.pageSize <= cap.limits.maxPageSize) {
    return { query: q, warnings: [] };
  }
  const clamped = cap.limits.maxPageSize;
  return {
    query: { ...q, pageSize: clamped },
    warnings: [{
      code: 'page_size_clamped',
      message: `${cap.name} 의 페이지 크기 상한은 ${clamped} 입니다. 요청한 ${q.pageSize} 대신 ${clamped} 을 썼습니다.`,
      at: clamped,
      registry: cap.key,
    }],
  };
}
