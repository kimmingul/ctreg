/**
 * ISRCTN 의 WHO 포맷 레코드 → `TrialRecord`.
 *
 * **왜 WHO 포맷인가.** ISRCTN 은 같은 데이터를 두 모양으로 내는데 둘 다 반쪽이다:
 * - `default` 는 시험센터(기관·도시 단위)와 `totalCount` 를 주지만 **상태도 시작일도
 *   요소로 갖고 있지 않다.** 상태는 저장값이 아니라 종료일에서 계산되는 값이라
 *   (API 문서 3.2.1.1) 레코드에 없다. `TrialRecord.status` 는 필수인데, 없는 것을
 *   날짜에서 우리가 다시 계산하면 그건 레지스트리가 말한 것이 아니라 우리가 지어낸
 *   값이 된다.
 * - `who` 는 레지스트리가 스스로 계산해 **게시한** `recruitment_status` 를 주고,
 *   시작일·종료일·적격 기준·결과지표·상호등록번호까지 준다. 대신 장소는 국가 단위이고
 *   `totalCount` 가 없다.
 *
 * 그래서 레코드는 `who` 에서 만들고, 총계만 `default` 의 `limit=0`(80바이트) 응답에서
 * 따로 읽는다. 지어내지 않으면서 두 포맷의 강한 쪽을 각각 쓰는 유일한 조합이다.
 * 치르는 값은 도시·기관 단위 장소인데, ISRCTN 은 어차피 장소로 검색할 수 없고
 * (`location:` 은 실측에서 0건) 좌표도 없어 `--near` 도 못 받으므로 손실이 가장 작다.
 */

import type { Warning } from '../../core/capability.js';
import type { FetchOpts } from '../../core/query.js';
import type { TrialLocation, TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import { upstreamError } from '../../runtime/errors.js';
import { toPhase, toStatus, toStudyType } from './vocab.js';
import { list, text } from './xml.js';

type Node = Record<string, any>;

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * WHO 포맷의 날짜는 `DD/MM/YYYY` 다. 이 순서를 잘못 읽으면 05/01 과 01/05 가 조용히
 * 뒤바뀌고, 결과는 여전히 그럴듯한 날짜라서 아무도 눈치채지 못한다. 형식이 이것이
 * 아니면 추측하지 않고 부재로 둔다 — 틀린 날짜보다 없는 날짜가 낫다.
 */
function toIsoDate(raw: unknown): string | undefined {
  const v = text(raw);
  if (v === undefined) return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toCount(raw: unknown): number | undefined {
  const v = text(raw);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const SEX_IN: Record<string, 'all' | 'female' | 'male'> = {
  All: 'all',
  Both: 'all',
  Female: 'female',
  Male: 'male',
};

/**
 * 결과가 **게시되었는지** 를 말하는 필드만 본다.
 *
 * `results_actual_enrolment` 와 `results_date_completed` 는 이름이 results 로 시작하지만
 * 결과 게시와 무관하다 — 진행 중인 시험도 종료 예정일을 갖고, 등록 인원은 0 으로
 * 채워진다. 그 둘을 신호에 넣으면 결과가 없는 시험 대부분이 hasResults 로 나간다.
 */
const RESULTS_FIELDS = [
  'results_url_link',
  'results_summary',
  'results_date_posted',
  'results_date_first_publication',
  'results_baseline_char',
  'results_participant_flow',
  'results_adverse_events',
  'results_outcome_measures',
  'results_url_protocol',
] as const;

export function mapTrial(
  trial: unknown,
  o: FetchOpts,
  fetchedAt: string,
): { record: TrialRecord; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const t = (trial ?? {}) as Node;
  const main = (t.main ?? {}) as Node;

  const registryId = text(main.trial_id);
  if (registryId === undefined) {
    throw upstreamError('ISRCTN 응답에 trial_id 가 없습니다.', '개별 시험 응답을 확인하세요.');
  }
  const id = formatTrialId('isrctn', registryId);

  const wantAll = o.include.includes('all');
  const want = (sec: 'eligibility' | 'outcomes' | 'contacts' | 'locations') =>
    wantAll || o.include.includes(sec);

  // --- 장소: 국가 단위다. ISRCTN 은 WHO 포맷에서 모집 국가만 준다 ---
  const countries = list<string>(t.countries?.country2).map((c) => text(c)).filter((c): c is string => c !== undefined);
  let locations: TrialLocation[] | undefined;
  let locationsTotal: number | undefined;
  if (countries.length > 0) {
    locationsTotal = countries.length;
    let mapped: TrialLocation[] = countries.map((country) => ({ country }));
    const cap = o.caps.locations;
    if (mapped.length > cap) {
      warnings.push({
        code: 'locations_truncated',
        message: `이 시험의 모집 국가 ${mapped.length}곳 중 ${cap}곳만 담았습니다.`,
        id,
        at: cap,
      });
      mapped = mapped.slice(0, cap);
    }
    locations = mapped;
  }

  // --- 등록 인원 ---
  // `results_actual_enrolment: 0` 은 "0명 등록" 이 아니라 "아직 모름" 이다(실측: 진행
  // 중인 시험은 전부 0, 완료된 시험만 실제값). 0 을 실제값으로 실으면 모집 중인 시험이
  // "0명 등록" 으로 보고된다 — 이 CLI 가 없애려는 실패 그 자체다. 0 은 부재로 둔다.
  const actual = toCount(main.results_actual_enrolment);
  const target = toCount(main.target_size);
  const enrollment =
    actual !== undefined && actual > 0
      ? { count: actual, basis: 'actual' as const }
      : target !== undefined
        ? { count: target, basis: 'estimated' as const }
        : undefined;

  // --- 적격 (옵트인) ---
  let eligibility: TrialRecord['eligibility'];
  const c = (t.criteria ?? {}) as Node;
  if (want('eligibility')) {
    const inclusion = text(c.inclusion_criteria);
    const exclusion = text(c.exclusion_criteria);
    const raw = [
      inclusion ? `Inclusion criteria:\n${inclusion}` : undefined,
      exclusion ? `Exclusion criteria:\n${exclusion}` : undefined,
    ]
      .filter((s): s is string => s !== undefined)
      .join('\n\n');
    const truncated = raw.length > o.caps.eligibilityChars;
    if (truncated) {
      warnings.push({ code: 'eligibility_truncated', message: '적격 기준문을 잘랐습니다.', id, at: o.caps.eligibilityChars });
    }
    const sexRaw = text(c.gender);
    const sex: 'all' | 'female' | 'male' | 'unknown' | undefined =
      sexRaw === undefined ? undefined : (SEX_IN[sexRaw] ?? 'unknown');
    const body = raw === '' ? undefined : truncated ? raw.slice(0, o.caps.eligibilityChars) : raw;
    const e = defined({
      minAge: text(c.agemin),
      maxAge: text(c.agemax),
      sex,
      sexRaw,
      criteriaText: body,
      criteriaTruncated: truncated ? true : undefined,
    });
    if (Object.keys(e).length > 0) eligibility = e;
  }

  // --- 결과지표 (옵트인) ---
  let outcomes: TrialRecord['outcomes'];
  let outcomesTotal: number | undefined;
  if (want('outcomes')) {
    const all = [
      ...list(t.primary_outcome?.prim_outcome).map((m) => ({ type: 'primary' as const, measure: text(m) })),
      ...list(t.secondary_outcome?.sec_outcome).map((m) => ({ type: 'secondary' as const, measure: text(m) })),
    ].filter((x): x is { type: 'primary' | 'secondary'; measure: string } => x.measure !== undefined);
    if (all.length > 0) {
      outcomesTotal = all.length;
      const cap = o.caps.outcomes;
      if (all.length > cap) {
        warnings.push({ code: 'outcomes_truncated', message: `결과 지표 ${all.length}개 중 ${cap}개만 담았습니다.`, id, at: cap });
      }
      outcomes = all.slice(0, cap);
    }
  }

  // --- 연락처 (옵트인) ---
  let contacts: TrialRecord['contacts'];
  if (want('contacts')) {
    const mapped = list<Node>(t.contacts?.contact)
      .map((k) => {
        const name = [text(k.firstname), text(k.middlename), text(k.lastname)]
          .filter((s): s is string => s !== undefined)
          .join(' ');
        return defined({
          name: name === '' ? undefined : name,
          role: text(k.type),
          email: text(k.email),
          phone: text(k.telephone),
        });
      })
      // 이름도 연락 수단도 없는 껍데기는 담지 않는다 — WHO 포맷은 공개/과학 연락처 자리를
      // 값이 없어도 요소로 남긴다.
      .filter((k) => k.name !== undefined || k.email !== undefined || k.phone !== undefined);
    if (mapped.length > 0) contacts = mapped;
  }

  const sponsors = list<string>(t.secondary_sponsor?.sponsor_name)
    .map((s) => text(s))
    .filter((s): s is string => s !== undefined);
  const lead = text(main.primary_sponsor);
  const sponsor = lead !== undefined || sponsors.length > 0
    ? defined({ lead, collaborators: sponsors.length > 0 ? sponsors : undefined })
    : undefined;

  const crossIds = list<Node>(t.secondary_ids?.secondary_id)
    .map((s) => defined({ id: text(s.sec_id), registry: text(s.issuing_authority) }))
    .filter((s): s is { id: string; registry?: string } => s.id !== undefined);

  const condition = text(main.hc_freetext);
  const intervention = text(main.i_freetext);

  const dates = defined({
    start: toIsoDate(main.date_enrolment),
    completion: toIsoDate(main.results_date_completed),
    firstPosted: toIsoDate(main.date_registration),
    // `dates.lastUpdated` 는 WHO 포맷에 없다. `default` 포맷의 `trial@lastUpdated` 에는
    // 있지만 그것 하나 때문에 요청을 두 배로 늘리지 않는다 — 갱신일로 **검색** 하는 것은
    // `lastEdited` 축으로 여전히 되고(capability 의 updatedRange), 없는 값을 지어내는
    // 것보다 비는 편이 이 프로젝트의 규칙에 맞다.
  });

  const record: TrialRecord = {
    id,
    registry: 'isrctn',
    registryId,
    url: text(main.url) ?? `https://www.isrctn.com/${registryId}`,
    title: text(main.public_title) ?? text(main.scientific_title) ?? registryId,
    conditions: condition !== undefined ? [condition] : [],
    fetchedAt,
    ...defined({
      officialTitle: text(main.scientific_title),
      interventions: intervention !== undefined ? [{ name: intervention }] : undefined,
      sponsor,
      enrollment,
      crossIds: crossIds.length > 0 ? crossIds : undefined,
      eligibility,
      outcomes,
      outcomesTotal,
      contacts,
    }),
    ...toStatus(text(main.recruitment_status)),
    ...toPhase(text(main.phase)),
    ...toStudyType(text(main.study_type)),
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
    ...(locations ? { locations, locationsTotal } : {}),
    hasResults: RESULTS_FIELDS.some((f) => text(main[f]) !== undefined),
    // `--raw` 는 이 시험의 원문 트리를 통째로 싣는다. 스키마가 담지 못하는 ISRCTN 고유
    // 값(연구가설, plain English 요약, 윤리 심의 등)에 닿는 유일한 경로다.
    ...(o.raw ? { source: t } : {}),
  };

  return { record, warnings };
}
