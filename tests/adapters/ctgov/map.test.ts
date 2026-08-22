import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapStudy, haversineKm } from '../../../src/adapters/ctgov/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';
import { CtregError } from '../../../src/runtime/errors.js';

const fixture = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../fixtures/ctgov', `${n}.json`), 'utf8'));

/** search-page.json 에서 nctId 로 원문 study 하나를 뽑는다 — 값 pin 테스트를 실제 응답에 건다. */
const studyByNctId = (nctId: string) => {
  const page = fixture('search-page') as { studies: any[] };
  const s = page.studies.find((x) => x.protocolSection.identificationModule.nctId === nctId);
  if (!s) throw new Error(`fixture 에 ${nctId} 없음`);
  return s;
};

const opts = (over: Partial<FetchOpts> = {}): FetchOpts => ({
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
  ...over,
});

const AT = '2026-08-22T00:00:00.000Z';

describe('CT.gov → TrialRecord 매핑', () => {
  it('실제 응답이 계약 스키마를 통과한다', () => {
    const { record } = mapStudy(fixture('study-full'), opts(), AT);
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
    expect(record.registry).toBe('ctgov');
    expect(record.id).toMatch(/^CTGOV:NCT\d{8}$/);
    expect(record.url).toContain(record.registryId);
  });

  it('검색 페이지의 모든 항목이 계약을 통과한다', () => {
    const page = fixture('search-page') as { studies: unknown[] };
    for (const s of page.studies) {
      expect(() => TrialRecordSchema.parse(mapStudy(s, opts(), AT).record)).not.toThrow();
    }
  });

  it('희소 응답에서 없는 필드는 생략한다 — null 이나 빈 값으로 채우지 않는다', () => {
    const { record } = mapStudy(fixture('study-sparse'), opts(), AT);
    expect(record.title).toBe('Sparse Study');
    expect(record.status).toBe('unknown');
    expect(record).not.toHaveProperty('statusRaw');
    expect(record.sponsor).toBeUndefined();
    expect(record.dates).toBeUndefined();
    expect(record.phase).toBeUndefined();
    expect(record.enrollment).toBeUndefined();
    expect(record.locations).toBeUndefined();
    expect(record.locationsTotal).toBeUndefined();
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  it('장소는 캡을 넘으면 잘리되 총 개수와 경고를 남긴다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000002', briefTitle: 'Many Sites' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const { record, warnings } = mapStudy(many, opts(), AT);
    expect(record.locations).toHaveLength(CAPS.locations.default);
    expect(record.locationsTotal).toBe(37);
    expect(warnings.map((w) => w.code)).toContain('locations_truncated');
  });

  it('--include locations 이면 캡이 최대치로 늘어난다 (args.ts 가 caps.locations 를 올린 것을 매퍼가 그대로 따른다)', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000009', briefTitle: 'Many Sites 2' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    const o = opts({
      include: ['core', 'locations'],
      caps: { locations: CAPS.locations.max, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
    });
    const { record, warnings } = mapStudy(many, o, AT);
    expect(record.locations).toHaveLength(37);
    expect(record.locationsTotal).toBe(37);
    expect(warnings.map((w) => w.code)).not.toContain('locations_truncated');
  });

  it('caps.locations 를 매퍼에 직접 주면 그 값을 쓴다 — 어댑터가 스스로 덮어쓰지 않는다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000010', briefTitle: 'Many Sites 3' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })),
        },
      },
    };
    // include 에 'locations' 가 없어도(=opt-in 게이트는 core 만 지남) caps.locations 는
    // 필터를 통과하지 않는다 — locations 는 core 에 늘 포함되는 섹션이라 want('locations') 는
    // 관계 없이 항상 참이다. 이 테스트가 고정하는 것은 "캡 숫자를 누가 정하는가" 뿐이다.
    const o = opts({ caps: { locations: 5, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default } });
    const { record, warnings } = mapStudy(many, o, AT);
    expect(record.locations).toHaveLength(5);
    expect(warnings.map((w) => w.code)).toContain('locations_truncated');
  });

  it('--include eligibility 없이는 적격 기준문을 담지 않는다', () => {
    const withElig = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000003', briefTitle: 'E' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'Inclusion Criteria: ...', minimumAge: '18 Years', sex: 'ALL' },
      },
    };
    expect(mapStudy(withElig, opts(), AT).record.eligibility).toBeUndefined();
    const on = mapStudy(withElig, opts({ include: ['core', 'eligibility'] }), AT).record;
    expect(on.eligibility?.criteriaText).toContain('Inclusion Criteria');
    expect(on.eligibility?.minAge).toBe('18 Years');
    expect(on.eligibility?.sex).toBe('all');
  });

  it('적격 기준문이 캡을 넘으면 자르고 플래그와 경고를 남긴다', () => {
    const long = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000004', briefTitle: 'L' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'x'.repeat(20000) },
      },
    };
    const o = opts({ include: ['core', 'eligibility'], caps: { locations: 10, eligibilityChars: 100, outcomes: 20 } });
    const { record, warnings } = mapStudy(long, o, AT);
    expect(record.eligibility?.criteriaText).toHaveLength(100);
    expect(record.eligibility?.criteriaTruncated).toBe(true);
    expect(warnings.map((w) => w.code)).toContain('eligibility_truncated');
  });

  it('--include outcomes 없이는 결과 지표를 담지 않고, 있으면 캡이 최대치로 늘어난다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000008', briefTitle: 'O' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        outcomesModule: {
          primaryOutcomes: Array.from({ length: 25 }, (_, i) => ({ measure: `Outcome ${i}` })),
        },
      },
    };
    expect(mapStudy(many, opts(), AT).record.outcomes).toBeUndefined();
    const o = opts({
      include: ['core', 'outcomes'],
      caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.max },
    });
    const { record, warnings } = mapStudy(many, o, AT);
    expect(record.outcomes).toHaveLength(25);
    expect(record.outcomesTotal).toBe(25);
    expect(warnings.map((w) => w.code)).not.toContain('outcomes_truncated');
  });

  it('caps.outcomes 를 매퍼에 직접 주면 그 값으로 자르고 outcomes_truncated 경고를 남긴다 — o.caps.outcomes 채널이 실제로 쓰인다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000011', briefTitle: 'O2' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        outcomesModule: {
          primaryOutcomes: Array.from({ length: 10 }, (_, i) => ({ measure: `Outcome ${i}` })),
        },
      },
    };
    const o = opts({
      include: ['core', 'outcomes'],
      caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: 3 },
    });
    const { record, warnings } = mapStudy(many, o, AT);
    expect(record.outcomes).toHaveLength(3);
    expect(record.outcomesTotal).toBe(10);
    const w = warnings.find((x) => x.code === 'outcomes_truncated');
    expect(w).toBeDefined();
    expect(w?.at).toBe(3);
  });

  it('--near 가 있으면 각 장소에 거리를 붙이고 가까운 순으로 정렬한다', () => {
    const geo = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000005', briefTitle: 'G' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: [
            { city: 'Busan', geoPoint: { lat: 35.1796, lon: 129.0756 } },
            { city: 'Seoul', geoPoint: { lat: 37.5665, lon: 126.978 } },
          ],
        },
      },
    };
    const { record } = mapStudy(geo, { ...opts(), near: { lat: 37.5665, lon: 126.978 } }, AT);
    expect(record.locations?.[0]?.city).toBe('Seoul');
    expect(record.locations?.[0]?.distanceKm).toBeCloseTo(0, 1);
    expect(record.locations?.[1]?.distanceKm).toBeGreaterThan(300);
  });

  it('--raw 일 때만 원문을 동봉한다', () => {
    const s = fixture('study-sparse');
    expect(mapStudy(s, opts(), AT).record.source).toBeUndefined();
    expect(mapStudy(s, opts({ raw: true }), AT).record.source).toEqual(s);
  });

  it('haversineKm 은 서울–부산을 약 325km 로 계산한다', () => {
    const d = haversineKm({ lat: 37.5665, lon: 126.978 }, { lat: 35.1796, lon: 129.0756 });
    expect(d).toBeGreaterThan(310);
    expect(d).toBeLessThan(340);
  });

  // C1 — type 없는 보조 식별자를 조용히 버리면 안 된다. NCT00334763 은 세 개 다 type 이 없다.
  it('type 없는 보조 식별자도 crossIds 에서 살아남는다 (NCT00334763)', () => {
    const { record } = mapStudy(studyByNctId('NCT00334763'), opts(), AT);
    expect(record.crossIds).toEqual([
      { id: 'NU-05L1' },
      { id: 'NU-1362-038' },
      { id: 'GENENTECH-AVF3646s' },
    ]);
  });

  it('crossIds 는 type 있는 항목의 registry 를 채우고, domain 으로 동일 id·다른 기관을 구분한다 (NCT03831932)', () => {
    const { record } = mapStudy(studyByNctId('NCT03831932'), opts(), AT);
    expect(record.crossIds).toEqual([
      { id: 'NCI-2019-00572', registry: 'REGISTRY', domain: 'CTRP (Clinical Trial Reporting Program)' },
      { id: 'OSU 19016' },
      { id: '10216', registry: 'OTHER', domain: 'Ohio State University Comprehensive Cancer Center LAO' },
      { id: '10216', registry: 'OTHER', domain: 'CTEP' },
      { id: 'UM1CA186712', registry: 'NIH' },
    ]);
  });

  // C2 — 모듈은 있지만 배열이 비어 있으면, 그 배열이 있었다는 사실 자체를 기록에 남기지 않는다.
  it('빈 배열은 present-but-empty 컨테이너를 만들지 않고 키 자체를 생략한다', () => {
    const empties = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000010', briefTitle: 'Empties' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        armsInterventionsModule: { interventions: [] },
        outcomesModule: { primaryOutcomes: [], secondaryOutcomes: [], otherOutcomes: [] },
        contactsLocationsModule: { centralContacts: [] },
        sponsorCollaboratorsModule: { leadSponsor: { name: 'Lead Co' }, collaborators: [] },
      },
    };
    const o = opts({ include: ['core', 'eligibility', 'outcomes', 'contacts', 'locations'] });
    const { record } = mapStudy(empties, o, AT);
    expect(record).not.toHaveProperty('interventions');
    expect(record).not.toHaveProperty('outcomes');
    expect(record).not.toHaveProperty('outcomesTotal');
    expect(record).not.toHaveProperty('contacts');
    expect(record).not.toHaveProperty('crossIds');
    expect(record.sponsor).toEqual({ lead: 'Lead Co' });
    expect(record.sponsor).not.toHaveProperty('collaborators');
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  /**
   * 빈 문자열은 이름이 아니다. 이전 가드(`lead || collaborators`)는 같은 사실에
   * 두 답을 냈다: 협력사가 없으면 sponsor 객체를 통째로 버리고(리드가 없다는 정보뿐
   * 아니라 협력사 정보까지 함께 사라진다), 협력사가 있으면 `lead: ""` 를 그대로
   * 내보냈다 — 있지도 않은 스폰서 이름을 주장하는 필드다. 없는 값은 키를 만들지
   * 않는다는 defined() 규칙 하나로 통일한다.
   */
  it('leadSponsor.name 이 빈 문자열이면 lead 키를 만들지 않고 협력사는 보존한다', () => {
    const withEmptyLead = (collaborators: { name: string }[]) => ({
      protocolSection: {
        identificationModule: { nctId: 'NCT00000011', briefTitle: 'Empty lead' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        sponsorCollaboratorsModule: { leadSponsor: { name: '' }, collaborators },
      },
    });

    const alone = mapStudy(withEmptyLead([]), opts(), AT).record;
    expect(alone.sponsor).toBeUndefined();

    const withCollab = mapStudy(withEmptyLead([{ name: 'Collab Co' }]), opts(), AT).record;
    expect(withCollab.sponsor).toEqual({ collaborators: ['Collab Co'] });
    expect(withCollab.sponsor).not.toHaveProperty('lead');
    expect(() => TrialRecordSchema.parse(withCollab)).not.toThrow();
  });

  // I1 — enrollmentInfo 모듈은 있지만 안이 비어 있으면 enrollment 키 자체가 없어야 한다.
  // `{ enrollment: undefined }` 를 스프레드하면 값은 undefined 인데 키는 남는 사고가 났었다.
  it('enrollmentInfo 가 비어 있으면 enrollment 키를 만들지 않는다', () => {
    const s = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000011', briefTitle: 'Empty Enrollment' },
        statusModule: {},
        conditionsModule: { conditions: ['X'] },
        designModule: { enrollmentInfo: {} },
      },
    };
    const { record } = mapStudy(s, opts(), AT);
    expect(Object.hasOwn(record, 'enrollment')).toBe(false);
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  // I3 — sex 는 명시적으로 매핑하고, 모르는 값은 예외 대신 unknown + sexRaw 로 흡수한다.
  it('sex 는 알려진 값을 매핑하고 원문을 sexRaw 로 남긴다', () => {
    for (const [raw, mapped] of [
      ['ALL', 'all'],
      ['FEMALE', 'female'],
      ['MALE', 'male'],
    ] as const) {
      const s = {
        protocolSection: {
          identificationModule: { nctId: 'NCT00000012', briefTitle: 'Sex' },
          statusModule: {},
          conditionsModule: { conditions: ['X'] },
          eligibilityModule: { sex: raw },
        },
      };
      const { record } = mapStudy(s, opts({ include: ['core', 'eligibility'] }), AT);
      expect(record.eligibility?.sex).toBe(mapped);
      expect(record.eligibility?.sexRaw).toBe(raw);
    }
  });

  it('처음 보는 sex 값은 예외를 던지지 않고 unknown 으로 흡수하며 원문을 남긴다', () => {
    const s = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000013', briefTitle: 'Sex Unknown' },
        statusModule: {},
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { sex: 'SOMETHING_NEW' },
      },
    };
    const { record } = mapStudy(s, opts({ include: ['core', 'eligibility'] }), AT);
    expect(record.eligibility?.sex).toBe('unknown');
    expect(record.eligibility?.sexRaw).toBe('SOMETHING_NEW');
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  // I4 — 신원을 지어내지 않는다. nctId 가 없으면 CTGOV:undefined 같은 가짜 id 대신 예외를 던진다.
  it('nctId 가 없으면 가짜 id 를 만들지 않고 upstreamError 를 던진다', () => {
    const s = { protocolSection: { identificationModule: { briefTitle: 'No Id' } } };
    expect(() => mapStudy(s, opts(), AT)).toThrow(CtregError);
  });

  it('study 가 객체가 아니면 원시 TypeError 대신 CtregError 를 던진다', () => {
    expect(() => mapStudy(null, opts(), AT)).toThrow(CtregError);
    expect(() => mapStudy('nope', opts(), AT)).toThrow(CtregError);
  });

  // I5 — 값 자체를 실제 응답으로 pin 한다. "parse 가 안 던진다" 는 잘못된 값도 통과시킨다.
  it('study-full 의 실제 값들이 정확히 매핑된다', () => {
    const { record } = mapStudy(fixture('study-full'), opts(), AT);
    expect(record.officialTitle).toBe(
      'A Multicenter, Adaptive, Randomized Blinded Controlled Trial of the Safety and Efficacy of Investigational Therapeutics for the Treatment of COVID-19 in Hospitalized Adults',
    );
    expect(record.conditions).toEqual(['COVID-19']);
    expect(record.phase).toEqual(['phase_3']);
    expect(record.studyType).toBe('interventional');
    expect(record.hasResults).toBe(true);
    expect(record.enrollment).toEqual({ count: 1062, basis: 'actual' });
    expect(record.dates?.start).toBe('2020-02-21');
    expect(record.dates?.primaryCompletion).toBe('2020-05-21');
    expect(record.dates?.completion).toBe('2020-05-21');
    expect(record.dates?.firstPosted).toBe('2020-02-21');
    expect(record.dates?.lastUpdated).toBe('2022-03-14');
    expect(record.status).toBe('completed');
    expect(record.statusRaw).toBe('COMPLETED');
    expect(record.sponsor).toEqual({ lead: 'National Institute of Allergy and Infectious Diseases (NIAID)' });
    expect(record.interventions).toEqual([
      { type: 'OTHER', name: 'Placebo' },
      { type: 'DRUG', name: 'Remdesivir' },
    ]);
  });

  it('NCT00334763 의 collaborators 가 실제 값으로 매핑된다', () => {
    const { record } = mapStudy(studyByNctId('NCT00334763'), opts(), AT);
    expect(record.sponsor).toEqual({ lead: 'Northwestern University', collaborators: ['National Cancer Institute (NCI)'] });
  });

  it('장소마다 자기 status 를 담는다 — 모든 장소를 recruiting 으로 뭉개지 않는다', () => {
    const mixed = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000014', briefTitle: 'Mixed Status' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: [
            { city: 'A', country: 'US', status: 'RECRUITING' },
            { city: 'B', country: 'US', status: 'COMPLETED' },
            { city: 'C', country: 'US', status: 'NOT_YET_RECRUITING' },
          ],
        },
      },
    };
    const { record } = mapStudy(mixed, opts(), AT);
    expect(record.locations?.map((l) => l.status)).toEqual(['recruiting', 'completed', 'not_yet_recruiting']);
    expect(record.locations?.map((l) => l.statusRaw)).toEqual(['RECRUITING', 'COMPLETED', 'NOT_YET_RECRUITING']);
  });

  it('healthyVolunteers 는 --include eligibility 일 때 실제 값으로 담긴다', () => {
    const s = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000017', briefTitle: 'HV' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        eligibilityModule: { eligibilityCriteria: 'x', healthyVolunteers: false },
      },
    };
    const { record } = mapStudy(s, opts({ include: ['core', 'eligibility'] }), AT);
    expect(record.eligibility?.healthyVolunteers).toBe(false);
  });

  // I6 — contacts 는 eligibility/outcomes 와 같은 opt-in 이다. 실제 이메일을 담은 응답으로 양방향을 편다.
  it('--include contacts 없이는 실제 central contact(이메일 포함)도 새지 않는다 (NCT06999187)', () => {
    const { record } = mapStudy(studyByNctId('NCT06999187'), opts(), AT);
    expect(record.contacts).toBeUndefined();
  });

  it('--include contacts 면 실제 central contact 값이 그대로 담긴다 (NCT06999187)', () => {
    const { record } = mapStudy(studyByNctId('NCT06999187'), opts({ include: ['core', 'contacts'] }), AT);
    expect(record.contacts).toEqual([
      {
        name: 'Dren Bio Central Contact',
        role: 'CONTACT',
        phone: '415-737-5277',
        email: 'DR-0202-ONC-001_inquiries@drenbio.com',
      },
    ]);
  });

  // 리뷰 라운드 2, 항목 1 — outcomes 절단은 §5.2 의 "조용한 절단 금지" 규칙이
  // locations 와 대칭이어야 한다: 캡이 적용되고, outcomesTotal 이 절단 전 총 개수를
  // 담고, 경고가 남아야 한다. 픽스처를 커밋하는 대신 페이로드를 테스트에서 만든다.
  it('결과 지표가 캡(200)을 넘으면 잘리되 outcomesTotal 과 경고를 남긴다', () => {
    const many = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000018', briefTitle: 'Many Outcomes' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        outcomesModule: {
          primaryOutcomes: Array.from({ length: 201 }, (_, i) => ({ measure: `Outcome ${i}` })),
        },
      },
    };
    const o = opts({
      include: ['core', 'outcomes'],
      caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.max },
    });
    const { record, warnings } = mapStudy(many, o, AT);
    expect(record.outcomes).toHaveLength(CAPS.outcomes.max);
    expect(record.outcomesTotal).toBe(201);
    expect(warnings.map((w) => w.code)).toContain('outcomes_truncated');
  });

  // 리뷰 라운드 2, 항목 2 — mapStudy 는 이제 자기 출력을 TrialRecordSchema 로 검증한다.
  // briefTitle 이 없으면 title: undefined 인 레코드를 조용히 돌려주는 대신 예외를 던져야 한다.
  it('briefTitle 이 없으면 title: undefined 인 레코드 대신 예외를 던진다', () => {
    const s = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000019' },
        statusModule: {},
        conditionsModule: { conditions: ['X'] },
      },
    };
    expect(() => mapStudy(s, opts(), AT)).toThrow();
  });

  // 리뷰 라운드 3, 항목 1 — 계약 위반 예외의 메시지가 zod 이슈 덤프가 아니라
  // 실패한 필드 경로를 담은 한 줄 요약이어야 한다. warnings[] 에 그대로 얹히는 문구다.
  it('계약 위반 예외 메시지는 zod 덤프가 아니라 필드 경로 한 줄 요약이다', () => {
    const s = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000020' },
        statusModule: {},
        conditionsModule: { conditions: ['X'] },
      },
    };
    expect(() => mapStudy(s, opts(), AT)).toThrow(/NCT00000020.*title/);
    try {
      mapStudy(s, opts(), AT);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      expect(message).not.toContain('\n');
      expect(message).toContain('title');
    }
  });

  // 리뷰 라운드 3, 항목 3 — geoPoint 가 깨져도 그 사이트 하나만 좌표를 잃고, 스키마 위반으로
  // 전체 study 가 죽지 않는다. 다른 정상 사이트의 좌표는 그대로 남는다.
  it('malformed geoPoint 는 그 장소의 좌표만 생략하고 나머지는 살아남는다', () => {
    const s = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000021', briefTitle: 'Bad Geo' },
        statusModule: { overallStatus: 'RECRUITING' },
        conditionsModule: { conditions: ['X'] },
        contactsLocationsModule: {
          locations: [
            { city: 'Good', geoPoint: { lat: 37.5665, lon: 126.978 } },
            { city: 'MissingLon', geoPoint: { lat: 35.1796 } },
            { city: 'NonNumeric', geoPoint: { lat: 'x', lon: 'y' } },
          ],
        },
      },
    };
    const { record, warnings } = mapStudy(s, opts(), AT);
    expect(record.locations).toHaveLength(3);
    expect(record.locations?.[0]).toMatchObject({ city: 'Good', geo: { lat: 37.5665, lon: 126.978 } });
    expect(record.locations?.[1]?.city).toBe('MissingLon');
    expect(record.locations?.[1]).not.toHaveProperty('geo');
    expect(record.locations?.[2]?.city).toBe('NonNumeric');
    expect(record.locations?.[2]).not.toHaveProperty('geo');
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
    expect(warnings.filter((w) => w.code === 'location_geo_invalid')).toHaveLength(2);
  });
});

describe('장소 절단은 필터에 걸린 근거를 남긴다', () => {
  const withLocations = (nctId: string, locs: unknown[]) => ({
    protocolSection: {
      identificationModule: { nctId, briefTitle: 'Sites' },
      statusModule: { overallStatus: 'RECRUITING' },
      conditionsModule: { conditions: ['X'] },
      contactsLocationsModule: { locations: locs },
    },
  });

  it('--location 으로 좁혔으면 매칭된 장소가 잘림에서 살아남는다', () => {
    const study = withLocations('NCT00000001', [
      ...Array.from({ length: 15 }, (_, i) => ({ city: `Elsewhere${i}`, country: 'United States' })),
      { facility: 'Seoul National University Hospital', city: 'Seoul', country: 'South Korea' },
    ]);
    const { record, warnings } = mapStudy(study, opts({ locationTerm: 'Seoul' }), AT);
    expect(record.locations).toHaveLength(CAPS.locations.default);
    expect(record.locations!.some((l) => l.city === 'Seoul')).toBe(true);
    expect(warnings.find((w) => w.code === 'locations_truncated')?.message).toContain('일치하는 장소를 앞에');
  });

  it('locationTerm 이 없으면 원래 순서를 유지한다', () => {
    const study = withLocations('NCT00000002', Array.from({ length: 12 }, (_, i) => ({ city: `City${i}`, country: 'US' })));
    const { record } = mapStudy(study, opts(), AT);
    expect(record.locations!.map((l) => l.city)).toEqual(
      Array.from({ length: CAPS.locations.default }, (_, i) => `City${i}`),
    );
  });

  it('경고가 무엇이 잘렸는지 말한다 — 검색 결과가 아니라 이 시험의 장소', () => {
    const study = withLocations('NCT00000003', Array.from({ length: 37 }, (_, i) => ({ city: `City${i}`, country: 'US' })));
    const { warnings } = mapStudy(study, opts(), AT);
    expect(warnings.find((w) => w.code === 'locations_truncated')?.message).toContain('이 시험의 장소');
  });
});

describe('두 축을 같이 주면 둘 다 근거로 남는다', () => {
  const study = {
    protocolSection: {
      identificationModule: { nctId: 'NCT00000007', briefTitle: 'Both' },
      statusModule: { overallStatus: 'RECRUITING' },
      conditionsModule: { conditions: ['X'] },
      contactsLocationsModule: {
        locations: [
          // 중심에 가까운 15곳 (서울과 무관)
          ...Array.from({ length: 15 }, (_, i) => ({
            city: `Near${i}`, country: 'United States',
            geoPoint: { lat: 37.6 + i * 0.001, lon: 127.0 },
          })),
          // 매칭되지만 멀리 있는 서울 사이트
          { facility: 'Seoul National University Hospital', city: 'Seoul', country: 'South Korea',
            geoPoint: { lat: 10.0, lon: 10.0 } },
        ],
      },
    },
  };
  const center = { lat: 37.5665, lon: 126.978 };

  it('near 가 있어도 location 매칭 장소가 잘려나가지 않는다', () => {
    const { record, warnings } = mapStudy(study, opts({ near: center, locationTerm: 'Seoul' }), AT);
    expect(record.locations!.some((l) => l.city === 'Seoul')).toBe(true);
    const msg = warnings.find((w) => w.code === 'locations_truncated')!.message;
    expect(msg).toContain('Seoul');
    expect(msg).toContain('가까운 순');
  });

  it('near 만 주면 예전처럼 거리순이다', () => {
    const { record } = mapStudy(study, opts({ near: center }), AT);
    expect(record.locations![0]!.city).toMatch(/^Near/);
    expect(record.locations!.some((l) => l.city === 'Seoul')).toBe(false);
  });
});
