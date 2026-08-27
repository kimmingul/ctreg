/**
 * 파라미터 조립 규칙(리스트는 `|`, filter.advanced 는 괄호 + AND)은
 * clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads, Apache-2.0) 의
 * `buildSearchQuery()` 에서 확인한 실제 동작을 따른다.
 */
import type { Warning } from '../../core/capability.js';
import { CAPS, resolvePageSize, type FetchOpts, type IncludeSection, type NormalizedQuery } from '../../core/query.js';
import { usageError } from '../../runtime/errors.js';
import { fromPhase, fromStatus, fromStudyType } from './vocab.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const CORE_FIELDS = [
  'protocolSection.identificationModule.nctId',
  'protocolSection.identificationModule.briefTitle',
  'protocolSection.identificationModule.officialTitle',
  'protocolSection.identificationModule.secondaryIdInfos',
  'protocolSection.statusModule.overallStatus',
  'protocolSection.statusModule.startDateStruct',
  'protocolSection.statusModule.primaryCompletionDateStruct',
  'protocolSection.statusModule.completionDateStruct',
  'protocolSection.statusModule.studyFirstPostDateStruct',
  'protocolSection.statusModule.lastUpdatePostDateStruct',
  'protocolSection.designModule.phases',
  'protocolSection.designModule.studyType',
  'protocolSection.designModule.enrollmentInfo',
  'protocolSection.conditionsModule.conditions',
  'protocolSection.armsInterventionsModule.interventions',
  'protocolSection.sponsorCollaboratorsModule.leadSponsor',
  'protocolSection.sponsorCollaboratorsModule.collaborators',
  'protocolSection.contactsLocationsModule.locations',
  'hasResults',
];

const SECTION_FIELDS: Record<Exclude<IncludeSection, 'core' | 'all'>, string[]> = {
  // 모듈 전체가 아니라 leaf 필드로 지정한다 — capability.ts 의 detail.eligibilityText 는
  // eligibilityCriteria 텍스트 하나를 가리키지, eligibilityModule 전체를 가리키지 않는다.
  // Task 10 의 매퍼가 실제로 읽는 필드만 싣는다 — 매퍼가 안 쓰는 필드를 실어봐야
  // leaf-path 로 payload 를 줄인 취지가 무색해진다.
  eligibility: [
    'protocolSection.eligibilityModule.eligibilityCriteria',
    'protocolSection.eligibilityModule.healthyVolunteers',
    'protocolSection.eligibilityModule.sex',
    'protocolSection.eligibilityModule.minimumAge',
    'protocolSection.eligibilityModule.maximumAge',
  ],
  outcomes: ['protocolSection.outcomesModule'],
  // overallOfficials (PI/study director) 는 map.ts 가 읽지 않는다 — centralContacts 와는
  // 다른 목적(연락 담당자 vs 연구책임자)이라 record 에 넣으려면 role 의미를 새로 정의해야
  // 하고, 그건 이미 리뷰를 통과한 스펙을 건드리는 일이다. 나중에 필요해지면 그 필드를
  // 읽는 매퍼와 함께 leaf 를 추가한다.
  contacts: ['protocolSection.contactsLocationsModule.centralContacts'],
  locations: ['protocolSection.contactsLocationsModule.locations'],
};

export function buildFields(include: IncludeSection[]): string[] {
  const out = new Set(CORE_FIELDS);
  const wantAll = include.includes('all');
  for (const section of ['eligibility', 'outcomes', 'contacts', 'locations'] as const) {
    if (wantAll || include.includes(section)) for (const f of SECTION_FIELDS[section]) out.add(f);
  }
  return [...out];
}

function dateRange(area: string, from?: string, to?: string): string | undefined {
  if (!from && !to) return undefined;
  for (const d of [from, to]) {
    if (d && !DATE.test(d)) {
      throw usageError(`날짜 '${d}' 는 YYYY-MM-DD 형식이 아닙니다`, '예: 2025-01-01');
    }
  }
  return `AREA[${area}]RANGE[${from ?? 'MIN'}, ${to ?? 'MAX'}]`;
}

export function buildSearchParams(
  q: NormalizedQuery,
  o: FetchOpts,
): { params: Record<string, string | number | undefined>; warnings: Warning[] } {
  const params: Record<string, string | number | undefined> = {};
  const warnings: Warning[] = [];

  params['query.cond'] = q.condition;
  params['query.intr'] = q.intervention;
  params['query.term'] = q.term;
  /**
   * **여러 낱말은 구가 아니라 토큰 AND 다.** ctgov 는 낱말들을 문서 어디에서든 각각 찾고,
   * 같은 필드일 필요도 같은 사람일 필요도 없다. 실측 2026-08-28: `Min-Gul Kim` 49건 중
   * NCT06072131 은 Min Kyoung Kim(대구 연락담당) · Gul Cebecioglu Hasancebi(터키
   * 세부연구자) · Kim 이 낱말을 하나씩 댄 것이었다. `"Min-Gul Kim"` 으로 묶으면 48건이다.
   *
   * **막지 않고 말만 한다.** `--term "diabetes metformin"` 처럼 낱말 AND 가 바로 원하는
   * 것인 쓰임이 흔하다 — 자동으로 따옴표를 씌우면 그 쓰임이 죽는다. 이미 구로 묶어 온
   * 호출자는 그 사실을 아는 것이므로 조용히 둔다.
   */
  const term = q.term?.trim();
  if (term !== undefined && /\s/.test(term) && !(term.startsWith('"') && term.endsWith('"'))) {
    warnings.push({
      code: 'term_matches_scattered_words',
      message:
        `--term 의 낱말들을 따로 찾습니다 — 한 시험 안에 흩어져 있기만 하면 걸리고, 같은 필드일 필요도 같은 사람일 필요도 없습니다. ` +
        `붙어 있는 그대로 찾으려면 따옴표로 묶으세요: --term '"${term}"'`,
      registry: 'ctgov',
    });
  }
  params['query.titles'] = q.title;
  params['query.locn'] = q.location;
  params['query.outc'] = q.outcomeQuery;
  params['query.spons'] = q.sponsor;
  params['query.lead'] = q.lead;
  params['query.id'] = q.id;
  params['query.patient'] = q.patient;

  if (q.status?.length) params['filter.overallStatus'] = q.status.map(fromStatus).join('|');

  if (q.radius && !q.near) {
    throw usageError('--radius 는 --near 없이 쓸 수 없습니다', '--near <lat,lon> 으로 중심 좌표를 주세요.');
  }
  if (q.near) {
    if (q.radius) {
      params['filter.geo'] = `distance(${q.near.lat},${q.near.lon},${q.radius.value}${q.radius.unit})`;
    } else {
      const r = { value: 50, unit: 'km' as const };
      params['filter.geo'] = `distance(${q.near.lat},${q.near.lon},${r.value}${r.unit})`;
      // --radius 를 안 주면 CT.gov 로 보낼 반경을 임의로 정한 것 — 다른 암묵적 축소와
      // 마찬가지로 caller 가 볼 수 없는 필터이니 반드시 경고를 남긴다.
      warnings.push({
        code: 'geo_radius_defaulted',
        message: `--radius 를 지정하지 않아 기본값 ${r.value}${r.unit} 를 적용했습니다. 이 범위 밖의 시험은 결과에서 빠집니다.`,
      });
    }
  }

  const advanced: string[] = [];
  /**
   * **연구자는 필드를 지정해서 묻는다.** `query.term` 에 실으면 ctgov 가 문서 전체에 대한
   * 토큰 AND 로 처리해서, 서로 다른 사람에게서 낱말이 하나씩 걸린 시험까지 맞는다
   * (실측 2026-08-28: `Min-Gul Kim` 49건 중 1건은 Min Kyoung Kim · Gul Cebecioglu ·
   * Kim 셋이 각각 한 낱말씩 댄 것이었다).
   *
   * 두 필드를 OR 로 묶는다 — 한 사람이 시험마다 연구책임자로도, 책임당사자 연구자로도
   * 올라간다(실측: 44 / 2, OR 45). 하나만 보면 나머지가 조용히 빠진다.
   *
   * 이름은 **구로 묶는다.** 안 묶으면 필드 안에서 다시 낱말이 흩어진다.
   */
  if (q.investigator !== undefined) {
    if (q.investigator.includes('"')) {
      throw usageError(
        `--investigator 값에는 따옴표(")를 쓸 수 없습니다: ${q.investigator}`,
        '따옴표가 들어가면 이름을 구로 묶을 수 없고, ctgov 는 깨진 질의를 오류가 아니라 다른 결과로 되돌립니다. 따옴표를 빼고 다시 시도하세요.',
      );
    }
    const name = `"${q.investigator}"`;
    advanced.push(
      `AREA[OverallOfficialName]${name} OR AREA[ResponsiblePartyInvestigatorFullName]${name}`,
    );
  }
  if (q.phase?.length) advanced.push(q.phase.map((p) => `AREA[Phase]${fromPhase(p)}`).join(' OR '));
  if (q.studyType) advanced.push(`AREA[StudyType]${fromStudyType(q.studyType)}`);

  const ranges = [
    dateRange('LastUpdatePostDate', q.updatedSince, q.updatedBefore),
    dateRange('StartDate', q.startAfter, q.startBefore),
    dateRange('PrimaryCompletionDate', q.completionAfter, q.completionBefore),
  ].filter((v): v is string => v !== undefined);

  if (ranges.length > 0) {
    advanced.push(...ranges);
    warnings.push({
      code: 'date_filter_excludes_missing',
      message: '날짜 필터는 해당 날짜를 게시한 시험만 매칭합니다. 날짜를 기재하지 않은 시험은 결과에서 빠집니다.',
    });
  }

  // 참조 구현과 동일하게: 표현식이 하나뿐이면 괄호 없이, 둘 이상이면 각각 괄호로
  // 싸 AND 로 잇는다. 표현식이 하나일 때 무조건 괄호를 씌우는 것은 §7.1 및
  // 참조 buildSearchQuery() 와 다르다.
  if (advanced.length === 1) params['filter.advanced'] = advanced[0];
  else if (advanced.length > 1) params['filter.advanced'] = advanced.map((p) => `(${p})`).join(' AND ');

  // `--raw` 면 투영을 걸지 않는다. source 가 정규화기의 작업용 필드 집합으로 좁혀지면
  // 설계에 있는 유일한 탈출구(§2.1 — 스키마가 담지 못하는 레지스트리별 값을 보존하는
  // 자리)가 구조적으로 비게 된다: source 는 정규화기가 이미 요청한 것 이상을 절대
  // 담을 수 없으니, "레지스트리가 실제로 뭐라고 했나" 라는 질문에 영영 답하지 못한다.
  // 캐시 키는 파라미터에서 파생하므로 raw 응답과 투영 응답은 저절로 다른 키에 앉는다.
  if (!o.raw) params.fields = buildFields(o.include).join('|');
  params.pageSize = resolvePageSize(q);
  params.countTotal = 'true';
  params.pageToken = q.pageToken;
  params.sort = q.sort;

  return { params, warnings };
}

export function buildIdsParams(
  ids: string[],
  o: FetchOpts,
): Record<string, string | number | undefined> {
  return {
    'filter.ids': ids.join('|'),
    // buildSearchParams 와 같은 이유로 `--raw` 면 투영을 생략한다.
    ...(o.raw ? {} : { fields: buildFields(o.include).join('|') }),
    pageSize: Math.min(ids.length, CAPS.pageSize.max),
  };
}
