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
 * 이 질의가 **실제로 쓴** 검색 축들. 질의 필드와 capability 축은 1:1 이 아니라
 * (`near` 하나가 `geo` 이고, 날짜 축은 두 필드가 한 축이다) 그 대응을 아는 자리가
 * 필요하다.
 *
 * 목록이 여기 한 벌만 있는 것이 요점이다. `assertSupported`(요청 **전** 에 돌며
 * 미지원 축을 막고 `vocab_excludes_missing` 을 만든다)와 `zeroResultScope`(요청
 * **후** 에 0건일 때만 쓰인다)가 같은 목록을 봐야 한다 — 두 벌로 갈리면 축이 하나
 * 늘 때 한쪽만 갱신되고, 그 어긋남은 축이 늘기 전까지 아무 데도 나타나지 않는다.
 *
 * 축이 추가되면 여기에도 넣어야 한다. 잊으면 `guard.test.ts` 의 '모든 검색 축을
 * 개별적으로 알아본다' 가 잡는다 — 타입은 이 배열의 전체성을 강제하지 못한다.
 */
export function usedSearchAxes(q: NormalizedQuery): (keyof Capability['search'])[] {
  const table: [keyof Capability['search'], boolean][] = [
    ['condition', q.condition !== undefined],
    ['intervention', q.intervention !== undefined],
    ['term', q.term !== undefined],
    ['title', q.title !== undefined],
    ['location', q.location !== undefined],
    ['sponsor', q.sponsor !== undefined],
    ['lead', q.lead !== undefined],
    ['id', q.id !== undefined],
    ['patient', q.patient !== undefined],
    ['investigator', q.investigator !== undefined],
    ['outcomeQuery', q.outcomeQuery !== undefined],
    ['status', (q.status?.length ?? 0) > 0],
    ['phase', (q.phase?.length ?? 0) > 0],
    ['studyType', q.studyType !== undefined],
    ['geo', q.near !== undefined],
    ['updatedRange', [q.updatedSince, q.updatedBefore].some((d) => d !== undefined)],
    ['startRange', [q.startAfter, q.startBefore].some((d) => d !== undefined)],
    ['completionRange', [q.completionAfter, q.completionBefore].some((d) => d !== undefined)],
  ];
  return table.filter(([, used]) => used).map(([axis]) => axis);
}

/**
 * 미지원 축을 조용히 무시하고 빈 결과를 내면, 에이전트가 "해당 시험 없음"과
 * "이 레지스트리는 그렇게 검색할 수 없음"을 구분하지 못한다. 반드시 exit 3 으로 알린다.
 */
export function assertSupported(
  cap: Capability,
  q: NormalizedQuery,
  fetch: FetchOpts,
): { warnings: Warning[] } {
  const axes = usedSearchAxes(q);

  for (const axis of axes) {
    if (!cap.search[axis].supported) {
      throw unsupportedError(
        `${cap.name}: '${axis}' 검색을 지원하지 않습니다`,
        `ctreg registries 로 이 레지스트리가 지원하는 축을 확인하세요. 결과가 없는 것이 아니라 조회 자체가 불가능합니다.`,
      );
    }
  }

  /**
   * 축은 지원되는데 **그 값** 을 안 받는 경우. `values` 는 "받아들여지는 값의 목록"
   * 이므로 그 밖의 값으로 거는 필터는 조회 자체가 불가능하다는 뜻이고, 축 미지원과
   * 같은 exit 3 이다 — 사용자 입장에서 같은 사실이기 때문이다: 결과가 없는 것이
   * 아니라 그렇게 물어볼 수 없다.
   *
   * `values === null` 은 자유 텍스트 축의 모양이라 대상이 아니다(목록이 없다는 뜻이지
   * 아무 값도 안 받는다는 뜻이 아니다).
   */
  const requested: [keyof Capability['search'], string[]][] = [
    ['status', q.status ?? []],
    ['phase', q.phase ?? []],
    ['studyType', q.studyType === undefined ? [] : [q.studyType]],
  ];
  for (const [axis, values] of requested) {
    const declared = cap.search[axis].values;
    if (declared === null || values.length === 0) continue;
    const strays = values.filter((v) => !declared.includes(v));
    if (strays.length === 0) continue;
    throw unsupportedError(
      `${cap.name}: '${axis}' 를 ${strays.join(', ')} 로 거를 수 없습니다`,
      `이 레지스트리가 받는 값: ${declared.join(', ')}. ` +
        'ctreg registries 로 축마다 받는 값을 확인하세요. 결과가 없는 것이 아니라 그렇게 물어볼 수 없습니다.',
    );
  }

  /**
   * 정렬은 축이 아니라서 `usedSearchAxes` 에 들어가지 않지만, 무시됐을 때의 피해는
   * 같다 — 사용자는 정렬된 목록을 봤다고 믿고 앞 몇 건으로 판단한다. 같은 exit 3.
   */
  if (q.sort !== undefined && !cap.sort.supported) {
    throw unsupportedError(
      `${cap.name}: 'sort' 를 지원하지 않습니다`,
      `이 레지스트리는 정렬 키를 받지 않아 ${cap.sort.scope}. ` +
        '--sort 없이 조회하거나 정렬을 지원하는 레지스트리를 쓰세요. ' +
        '조용히 무시하면 정렬되지 않은 목록을 정렬된 것으로 읽게 됩니다.',
    );
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
        `${cap.name}: '${axis}' 를 제공하지 않습니다`,
        'ctreg registries 로 제공 섹션을 확인하세요.',
      );
    }
  }

  /**
   * 축은 지원되는데 그 축의 어휘가 데이터를 다 덮지 못하는 경우(F8). 값별 건수의
   * 합이 전체 총계보다 작다는 사실을 필터를 거는 **시점에** 말한다 — 선언만으로는
   * 미리 읽은 호출자만 알게 되고, 필드 테스트에서 에이전트가 뺄셈으로 발견한 상황이
   * 그대로 남는다. 날짜 축의 date_filter_excludes_missing 과 같은 모양이고, 어느
   * 쪽도 종료 코드를 바꾸지 않는다.
   *
   * 문구가 원인을 하나로 단정하지 않는다: `exhaustive: false` 의 원인은 둘이다 —
   * 그 필드를 기재하지 않은 레코드와, 기재했으나 그 값이 공통 어휘에 필터 자리가
   * 없는 레코드. 우리는 둘을 구분해 세지 않으므로 어느 쪽이라 말하면 거짓이 될 수
   * 있다. 실측(ctgov status): 미달분 97,667 = UNKNOWN 95,620 + 확대접근 1,066 +
   * WITHHELD 981 — 산술이 정확히 맞고, **상태가 없는 레코드는 0건이다.** 즉 미달분
   * 전부가 "값은 있는데 어휘에 자리가 없는" 쪽이었다. 그래서 "기재하지 않았다"
   * 라고만 말하는 문구는 이 경우 거짓이 된다 — 다음 사람이 "더 구체적으로" 고치려
   * 하면 이 근거를 먼저 봐야 한다.
   */
  const warnings: Warning[] = [];
  for (const axis of axes) {
    if (cap.search[axis].exhaustive === false) {
      warnings.push({
        code: 'vocab_excludes_missing',
        message:
          `${cap.name} 의 '${axis}' 는 값별로 나눈 건수의 합이 전체보다 작습니다 — ` +
          '이 값들 중 어디에도 걸리지 않는 시험이 있습니다(그 필드를 기재하지 않았거나, ' +
          '기재한 값이 공통 어휘에 없습니다). 이 필터의 결과는 그만큼 좁습니다.',
        registry: cap.key,
      });
    }
  }
  return { warnings };
}

/**
 * 결과가 0건일 때, 그 질의가 쓴 축들이 **실제로 무엇을 보는지**(`scope`)를 경고로 낸다.
 *
 * F2 의 나머지 절반이다. 선언에는 `scope` 가 실렸지만 응답에는 실리지 않아서,
 * `search --registry ctgov --term "2015-000397-19"` 는 0건·경고 없음·exit 0 이었다 —
 * 미리 `registries` 를 읽지 않은 호출자에게 그 0 은 "없음" 과 구별되지 않는다. 위
 * `vocab_excludes_missing` 을 만든 논거(선언만으로는 미리 읽은 호출자만 알게 된다)가
 * 여기에도 그대로 적용된다.
 *
 * **이 함수는 문구만 만들고 낼지 말지는 정하지 않는다.** `assertSupported` 는
 * `adapter.search()` **전** 에 돌고(미지원 축이면 네트워크를 안 치려는 의도다) 0건이라는
 * 사실은 그 **후** 에야 안다. 그래서 발화 시점만 커맨드로 넘긴다 — 정책(어떤 축을 보고,
 * 무엇을 말하고, 무엇을 말하지 않는가)은 여기 한 군데 남는다. 커맨드가 직접 만들게 하면
 * 같은 로직이 search 와 count 로 갈린다(M3 에서 페이지 크기로 겪은 그 문제).
 *
 * **0건일 때만 부른다.** 늘 내면 `vocab_excludes_missing` 이 모든 닫힌 어휘 축에서
 * 100% 발화해 변별력을 잃었던 것(최종 리뷰 L11)과 같아진다. 모호함이 실제로 존재하는
 * 자리에서만 말해야 신호가 된다.
 *
 * **원인을 단정하지 않는다.** 0건이 "해당하는 시험이 없다" 인지 "그 축이 그것을 보지
 * 않는다" 인지 도구는 모른다. 아는 것은 그 축이 무엇을 보는지뿐이고, 문구는 딱 거기까지
 * 말한다.
 *
 * 레지스트리당 한 건이다(축마다 한 건이 아니라). 이 경고의 단위는 축이 아니라 **질의**
 * 이고, 축 다섯 개를 쓴 질의가 같은 말을 다섯 번 하면 `text` 출력이 도배된다. 대가는
 * 축별로 기계가 파싱할 자리가 없다는 것 — 필요해지면 `Warning` 에 자리를 만드는 것이
 * 먼저다.
 */
export function zeroResultScope(cap: Capability, q: NormalizedQuery): Warning[] {
  const axes = usedSearchAxes(q);
  if (axes.length === 0) return [];
  const scopes = axes.map((axis) => `'${axis}' — ${cap.search[axis].scope}`).join(' / ');
  return [{
    code: 'zero_results_scope',
    message:
      `${cap.name} 에서 결과가 0건입니다. 이 질의가 쓴 축이 실제로 보는 범위는 다음과 같습니다: ${scopes}. ` +
      '0건이 "해당하는 시험이 없다" 인지 "이 축이 그것을 보지 않는다" 인지는 이 도구가 구분하지 못합니다.',
    registry: cap.key,
  }];
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
      message: `${cap.name} 의 페이지 크기 상한은 ${clamped} 입니다. 요청 ${q.pageSize} → 실제 ${clamped}.`,
      at: clamped,
      registry: cap.key,
    }],
  };
}
