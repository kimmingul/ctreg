/**
 * 하버사인은 clinicaltrialsgov-mcp-server (Copyright Casey Hand / cyanheads, Apache-2.0)
 * 의 `geo-helpers.ts` 에서 파생했다. 원본은 마일을 반환하며 여기서는 km 로 낸다.
 */
import type { Warning } from '../../core/capability.js';
import { CAPS, type FetchOpts } from '../../core/query.js';
import type { TrialLocation, TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
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

export function mapStudy(
  study: unknown,
  o: FetchOpts,
  fetchedAt: string,
): { record: TrialRecord; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const s = study as Record<string, any>;
  const p = s.protocolSection ?? {};
  const ident = p.identificationModule ?? {};
  const registryId: string = ident.nctId;
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
      return {
        ...defined({ facility: l.facility, city: l.city, state: l.state, country: l.country }),
        ...(l.status ? { status: st.status, statusRaw: st.statusRaw } : {}),
        ...(l.geoPoint ? { geo: { lat: l.geoPoint.lat, lon: l.geoPoint.lon } } : {}),
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
    const sexRaw: string | undefined = em.sex;
    eligibility = defined({
      minAge: em.minimumAge,
      maxAge: em.maximumAge,
      sex: sexRaw ? (sexRaw.toLowerCase() as 'all' | 'female' | 'male') : undefined,
      healthyVolunteers: em.healthyVolunteers,
      criteriaText: truncated ? raw!.slice(0, o.caps.eligibilityChars) : raw,
      criteriaTruncated: truncated ? true : undefined,
    }) as TrialRecord['eligibility'];
  }

  // 결과 지표 (옵트인). `--include outcomes` 면 캡이 최대치로 늘어난다 (§5.2) — locations 와 동일한 규칙.
  let outcomes: TrialRecord['outcomes'];
  const om = p.outcomesModule;
  if (om && want('outcomes')) {
    const all = [
      ...(om.primaryOutcomes ?? []).map((x: any) => ({ type: 'primary' as const, ...x })),
      ...(om.secondaryOutcomes ?? []).map((x: any) => ({ type: 'secondary' as const, ...x })),
      ...(om.otherOutcomes ?? []).map((x: any) => ({ type: 'other' as const, ...x })),
    ];
    const effectiveCap = want('outcomes') ? CAPS.outcomes.max : o.caps.outcomes;
    if (all.length > effectiveCap) {
      warnings.push({ code: 'outcomes_truncated', message: `결과 지표 ${all.length}개 중 ${effectiveCap}개만 담았습니다.`, id, at: effectiveCap });
    }
    outcomes = all.slice(0, effectiveCap).map((x) => ({
      type: x.type,
      measure: x.measure,
      ...defined({ timeFrame: x.timeFrame, description: x.description }),
    }));
  }

  const status = toStatus(p.statusModule?.overallStatus);
  const phases = toPhases(p.designModule?.phases);
  const studyType = toStudyType(p.designModule?.studyType);
  const enrollmentInfo = p.designModule?.enrollmentInfo;
  const lead = p.sponsorCollaboratorsModule?.leadSponsor?.name;
  const collaborators: string[] | undefined = p.sponsorCollaboratorsModule?.collaborators?.map((c: any) => c.name);

  const crossIds = (ident.secondaryIdInfos ?? [])
    .filter((x: any) => x.id && x.type)
    .map((x: any) => ({ registry: String(x.type), id: String(x.id) }));

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
    ...(p.armsInterventionsModule?.interventions
      ? { interventions: p.armsInterventionsModule.interventions.map((i: any) => ({ name: i.name, ...defined({ type: i.type }) })) }
      : {}),
    ...(lead || collaborators?.length ? { sponsor: defined({ lead, collaborators }) as TrialRecord['sponsor'] } : {}),
    ...(enrollmentInfo
      ? { enrollment: defined({ count: enrollmentInfo.count, basis: enrollmentInfo.type?.toLowerCase() }) as TrialRecord['enrollment'] }
      : {}),
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
    ...(outcomes ? { outcomes } : {}),
    ...(want('contacts') && p.contactsLocationsModule?.centralContacts
      ? {
          contacts: p.contactsLocationsModule.centralContacts.map((c: any) =>
            defined({ name: c.name, role: c.role, email: c.email, phone: c.phone }),
          ) as TrialRecord['contacts'],
        }
      : {}),
    ...(o.raw ? { source: study } : {}),
  };

  return { record, warnings };
}
