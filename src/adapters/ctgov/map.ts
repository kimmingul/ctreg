/**
 * 하버사인은 clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads, Apache-2.0)
 * 의 `geo-helpers.ts` 에서 파생했다. 원본은 마일을 반환하며 여기서는 km 로 낸다.
 */
import { ZodError } from 'zod';
import type { Warning } from '../../core/capability.js';
import { CAPS, type FetchOpts } from '../../core/query.js';
import { TrialRecordSchema, type TrialLocation, type TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import { upstreamError } from '../../runtime/errors.js';
import { toPhases, toStatus, toStudyType } from './vocab.js';

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 값이 없으면 키 자체를 만들지 않는다. `null` / `""` / `0` 으로 채우지 않는다. */
function defined<T extends object>(o: T): Partial<T> | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

const dateOf = (s: { date?: string } | undefined) => s?.date;

/**
 * CT.gov `sex` 원문 → 공통 어휘. statusRaw/phaseRaw 와 같은 규칙 — 필드가 있으면 매핑 성공
 * 여부와 무관하게 원문을 sexRaw 로 남긴다. 처음 보는 값 하나 때문에 레코드 전체 파싱이
 * 깨지면 안 되므로 매핑 실패는 예외가 아니라 'unknown' 으로 흡수한다.
 */
const SEX_IN: Record<string, 'all' | 'female' | 'male'> = { ALL: 'all', FEMALE: 'female', MALE: 'male' };
function toSex(raw?: string): { sex?: 'all' | 'female' | 'male' | 'unknown'; sexRaw?: string } {
  if (raw === undefined || raw === '') return {};
  return { sex: SEX_IN[raw] ?? 'unknown', sexRaw: raw };
}

/**
 * `geoPoint` 는 lat/lon 이 둘 다 유한수일 때만 쓸모가 있다. CT.gov 는 이 필드를 늘 온전히
 * 채우는 것으로 보이지만(실제 픽스처로 반례를 못 찾았다), 좌표 하나가 깨졌다고 사이트 전체를
 * 잃는 것보다 좌표 없이 나머지 정보를 보존하는 편이 낫다 — 쓸 수 없는 좌표를 생략하는 것도
 * 다른 모든 없는 필드와 같은 정직한 진술이지, 조작이 아니다.
 */
function validGeo(gp: unknown): { lat: number; lon: number } | undefined {
  if (!gp || typeof gp !== 'object') return undefined;
  const { lat, lon } = gp as { lat?: unknown; lon?: unknown };
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon)
    ? { lat, lon }
    : undefined;
}

export function mapStudy(
  study: unknown,
  o: FetchOpts,
  fetchedAt: string,
): { record: TrialRecord; warnings: Warning[] } {
  if (study === null || typeof study !== 'object') {
    throw upstreamError('CT.gov 응답이 예상한 형태(객체)가 아닙니다.', 'CT.gov API 상태를 확인하세요.');
  }
  const warnings: Warning[] = [];
  const s = study as Record<string, any>;
  const p = s.protocolSection ?? {};
  const ident = p.identificationModule ?? {};
  const registryId: string | undefined = ident.nctId;
  if (!registryId) {
    throw upstreamError('CT.gov 응답에 nctId 가 없습니다.', '개별 study 응답을 확인하세요.');
  }
  const id = formatTrialId('ctgov', registryId);

  const wantAll = o.include.includes('all');
  const want = (sec: 'eligibility' | 'outcomes' | 'contacts' | 'locations') =>
    wantAll || o.include.includes(sec);

  // 장소: 거리 주석 → 정렬 → 캡. `--include locations` 면 캡이 최대치로 늘어난다 (§5.2).
  const rawLocations: any[] = p.contactsLocationsModule?.locations ?? [];
  let locations: TrialLocation[] | undefined;
  let locationsTotal: number | undefined;
  if (rawLocations.length > 0) {
    locationsTotal = rawLocations.length;
    let mapped: TrialLocation[] = rawLocations.map((l) => {
      const st = toStatus(l.status);
      const geo = validGeo(l.geoPoint);
      if (l.geoPoint && !geo) {
        warnings.push({
          code: 'location_geo_invalid',
          message: `장소(${l.facility ?? l.city ?? '이름 없음'})의 geoPoint 가 유효하지 않아 좌표를 생략했습니다.`,
          id,
        });
      }
      return {
        ...defined({ facility: l.facility, city: l.city, state: l.state, country: l.country }),
        ...(l.status ? { status: st.status, statusRaw: st.statusRaw } : {}),
        ...(geo ? { geo } : {}),
      } as TrialLocation;
    });
    if (o.near) {
      const center = o.near;
      mapped = mapped
        .map((l) => (l.geo ? { ...l, distanceKm: haversineKm(center, l.geo) } : l))
        .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
    }
    const cap = want('locations') ? CAPS.locations.max : o.caps.locations;
    if (mapped.length > cap) {
      warnings.push({ code: 'locations_truncated', message: `장소 ${mapped.length}곳 중 ${cap}곳만 담았습니다.`, id, at: cap });
      mapped = mapped.slice(0, cap);
    }
    locations = mapped;
  }

  // 적격 (옵트인)
  let eligibility: TrialRecord['eligibility'];
  const em = p.eligibilityModule;
  if (em && want('eligibility')) {
    const raw: string | undefined = em.eligibilityCriteria;
    const truncated = raw !== undefined && raw.length > o.caps.eligibilityChars;
    if (truncated) {
      warnings.push({ code: 'eligibility_truncated', message: '적격 기준문을 잘랐습니다.', id, at: o.caps.eligibilityChars });
    }
    const sexMapped = toSex(em.sex);
    eligibility = defined({
      minAge: em.minimumAge,
      maxAge: em.maximumAge,
      sex: sexMapped.sex,
      sexRaw: sexMapped.sexRaw,
      healthyVolunteers: em.healthyVolunteers,
      criteriaText: truncated ? raw!.slice(0, o.caps.eligibilityChars) : raw,
      criteriaTruncated: truncated ? true : undefined,
    }) as TrialRecord['eligibility'];
  }

  // 결과 지표 (옵트인). `--include outcomes` 없이는 이 블록에 들어오지 않으므로, 들어왔다면
  // want('outcomes') 는 항상 참이고 캡은 항상 최대치다 — o.caps.outcomes 분기는 도달 불가.
  // (locations 는 opt-in 게이트가 없어 사정이 다르다 — 위 참고.) Task 14 는 이 필드에 기대지 않는다.
  let outcomes: TrialRecord['outcomes'];
  let outcomesTotal: number | undefined;
  const om = p.outcomesModule;
  if (om && want('outcomes')) {
    const all = [
      ...(om.primaryOutcomes ?? []).map((x: any) => ({ type: 'primary' as const, ...x })),
      ...(om.secondaryOutcomes ?? []).map((x: any) => ({ type: 'secondary' as const, ...x })),
      ...(om.otherOutcomes ?? []).map((x: any) => ({ type: 'other' as const, ...x })),
    ];
    if (all.length > 0) {
      outcomesTotal = all.length;
      const cap = CAPS.outcomes.max;
      if (all.length > cap) {
        warnings.push({ code: 'outcomes_truncated', message: `결과 지표 ${all.length}개 중 ${cap}개만 담았습니다.`, id, at: cap });
      }
      outcomes = all.slice(0, cap).map((x) => ({
        type: x.type,
        measure: x.measure,
        ...defined({ timeFrame: x.timeFrame, description: x.description }),
      }));
    }
  }

  const status = toStatus(p.statusModule?.overallStatus);
  const phases = toPhases(p.designModule?.phases);
  const studyType = toStudyType(p.designModule?.studyType);
  const enrollmentInfo = p.designModule?.enrollmentInfo;
  const enrollment = enrollmentInfo
    ? (defined({ count: enrollmentInfo.count, basis: enrollmentInfo.type?.toLowerCase() }) as TrialRecord['enrollment'])
    : undefined;

  // 빈 문자열은 이름이 아니다 — `defined()` 가 undefined 를 다루는 것과 같은 규칙을
  // 여기서 한 번 적용해 두 갈래를 없앤다. 이전 가드(`lead || collaborators`)는 같은
  // 사실에 두 답을 냈다: 협력사가 없으면 sponsor 를 통째로 버려 협력사 정보까지
  // 함께 잃었고, 협력사가 있으면 `lead: ""` 라는 있지도 않은 이름을 주장했다.
  const leadName: string | undefined = p.sponsorCollaboratorsModule?.leadSponsor?.name;
  const lead = leadName ? leadName : undefined;
  const rawCollaborators: any[] = p.sponsorCollaboratorsModule?.collaborators ?? [];
  const collaborators: string[] | undefined =
    rawCollaborators.length > 0 ? rawCollaborators.map((c: any) => c.name) : undefined;
  const sponsor = defined({ lead, collaborators }) as TrialRecord['sponsor'];

  // 보조 식별자는 type 이 없어도 id 가 있으면 데이터다 — 버리지 않는다. registry 는 우리
  // RegistryKey 가 아니라 업스트림이 붙인 원문 라벨이고, domain 은 같은 id 를 여러 기관이
  // 재사용할 때(예: 동일 id·다른 CTEP/기관 domain) 구분하는 근거라 함께 보존한다.
  const crossIds = (ident.secondaryIdInfos ?? [])
    .filter((x: any) => x.id)
    .map((x: any) => ({
      id: String(x.id),
      ...(x.type ? { registry: String(x.type) } : {}),
      ...(x.domain ? { domain: String(x.domain) } : {}),
    }));

  const rawInterventions: any[] = p.armsInterventionsModule?.interventions ?? [];
  const rawCentralContacts: any[] = p.contactsLocationsModule?.centralContacts ?? [];

  const record: TrialRecord = {
    id,
    registry: 'ctgov',
    registryId,
    url: `https://clinicaltrials.gov/study/${registryId}`,
    title: ident.briefTitle,
    conditions: p.conditionsModule?.conditions ?? [],
    status: status.status,
    fetchedAt,
    ...(status.statusRaw ? { statusRaw: status.statusRaw } : {}),
    ...defined({ officialTitle: ident.officialTitle }),
    ...phases,
    ...studyType,
    ...(crossIds.length > 0 ? { crossIds } : {}),
    ...(rawInterventions.length > 0
      ? { interventions: rawInterventions.map((i: any) => ({ name: i.name, ...defined({ type: i.type }) })) }
      : {}),
    ...(sponsor ? { sponsor } : {}),
    ...(enrollment ? { enrollment } : {}),
    ...(() => {
      const dates = defined({
        start: dateOf(p.statusModule?.startDateStruct),
        primaryCompletion: dateOf(p.statusModule?.primaryCompletionDateStruct),
        completion: dateOf(p.statusModule?.completionDateStruct),
        firstPosted: dateOf(p.statusModule?.studyFirstPostDateStruct),
        lastUpdated: dateOf(p.statusModule?.lastUpdatePostDateStruct),
      });
      return dates ? { dates } : {};
    })(),
    ...(locations ? { locations, locationsTotal } : {}),
    ...(typeof s.hasResults === 'boolean' ? { hasResults: s.hasResults } : {}),
    ...(eligibility ? { eligibility } : {}),
    ...(outcomes ? { outcomes, outcomesTotal } : {}),
    ...(want('contacts') && rawCentralContacts.length > 0
      ? {
          contacts: rawCentralContacts.map((c: any) =>
            defined({ name: c.name, role: c.role, email: c.email, phone: c.phone }),
          ) as TrialRecord['contacts'],
        }
      : {}),
    ...(o.raw ? { source: study } : {}),
  };

  // 자기 출력을 스스로 검증한다. title 처럼 스키마가 필수로 요구하는 필드가 원문에
  // 없어 undefined 로 새는 등, 여기서 미처 막지 못한 모든 계약 위반을 여기서 잡는다.
  // 계약을 못 지키는 레코드는 조용히 틀리게 돌아가는 대신 여기서 크게 던진다 —
  // 호출자(어댑터)는 study 단위로 잡아 경고로 격하한다. ZodError 를 그대로 던지면 그
  // 경고 메시지가 zod 의 다중 라인 이슈 덤프가 되어 버리므로, 실패한 필드 경로 한 줄
  // 요약으로 바꿔 upstreamError 로 다시 던진다.
  try {
    return { record: TrialRecordSchema.parse(record), warnings };
  } catch (e) {
    if (e instanceof ZodError) {
      const detail = e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw upstreamError(
        `${id} 이(가) 레코드 계약을 만족하지 못했습니다 — ${detail}`,
        'CT.gov 응답에서 해당 필드를 확인하세요.',
      );
    }
    throw e;
  }
}
