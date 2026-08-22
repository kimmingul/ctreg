/**
 * 파라미터 조립 규칙(리스트는 `|`, filter.advanced 는 괄호 + AND)은
 * clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads, Apache-2.0) 의
 * `buildSearchQuery()` 에서 확인한 실제 동작을 따른다.
 */
import type { Warning } from '../../core/capability.js';
import { CAPS, type FetchOpts, type IncludeSection, type NormalizedQuery } from '../../core/query.js';
import { usageError } from '../../runtime/errors.js';
import { fromPhase, fromStatus } from './vocab.js';

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
  if (q.phase?.length) advanced.push(q.phase.map((p) => `AREA[Phase]${fromPhase(p)}`).join(' OR '));
  if (q.studyType) advanced.push(`AREA[StudyType]${q.studyType.toUpperCase()}`);

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

  params.fields = buildFields(o.include).join('|');
  params.pageSize = Math.min(q.pageSize ?? CAPS.pageSize.default, CAPS.pageSize.max);
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
    fields: buildFields(o.include).join('|'),
    pageSize: Math.min(ids.length, CAPS.pageSize.max),
  };
}
