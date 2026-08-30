import { z } from 'zod';
import { REGISTRY_KEYS } from './registry.js';
import { STUDY_TYPE, TRIAL_PHASE, TRIAL_STATUS } from './vocab.js';

const RegistryKeySchema = z.enum(REGISTRY_KEYS);
const StatusSchema = z.enum(TRIAL_STATUS);

export const TrialLocationSchema = z.strictObject({
  facility: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  status: StatusSchema.optional(),
  statusRaw: z.string().optional(),
  geo: z.strictObject({ lat: z.number(), lon: z.number() }).optional(),
  distanceKm: z.number().optional(),
});
export type TrialLocation = z.infer<typeof TrialLocationSchema>;

export const TrialRecordSchema = z.strictObject({
  // 신원
  id: z.string().min(1),
  registry: RegistryKeySchema,
  registryId: z.string().min(1),
  crossIds: z
    .array(z.strictObject({ registry: z.string().optional(), id: z.string(), domain: z.string().optional() }))
    .optional(),
  url: z.string().min(1),

  // core
  title: z.string().min(1),
  officialTitle: z.string().min(1).optional(),
  status: StatusSchema,
  statusRaw: z.string().min(1).optional(),
  phase: z.array(z.enum(TRIAL_PHASE)).optional(),
  phaseRaw: z.array(z.string()).optional(),
  studyType: z.enum(STUDY_TYPE).optional(),
  studyTypeRaw: z.string().optional(),
  conditions: z.array(z.string()),
  interventions: z.array(z.strictObject({ type: z.string().optional(), name: z.string() })).optional(),
  sponsor: z
    .strictObject({ lead: z.string().optional(), collaborators: z.array(z.string()).optional() })
    .optional(),
  enrollment: z
    .strictObject({
      count: z.number().optional(),
      basis: z.enum(['actual', 'estimated', 'unknown']).optional(),
    })
    .optional(),
  dates: z
    .strictObject({
      start: z.string().optional(),
      primaryCompletion: z.string().optional(),
      completion: z.string().optional(),
      firstPosted: z.string().optional(),
      lastUpdated: z.string().optional(),
    })
    .optional(),
  locations: z.array(TrialLocationSchema).optional(),
  locationsTotal: z.number().optional(),
  hasResults: z.boolean().optional(),

  // detail (--include)
  eligibility: z
    .strictObject({
      minAge: z.string().optional(),
      maxAge: z.string().optional(),
      sex: z.enum(['all', 'female', 'male', 'unknown']).optional(),
      sexRaw: z.string().optional(),
      healthyVolunteers: z.boolean().optional(),
      criteriaText: z.string().optional(),
      criteriaTruncated: z.boolean().optional(),
    })
    .optional(),
  outcomes: z
    .array(
      z.strictObject({
        type: z.enum(['primary', 'secondary', 'other']),
        measure: z.string(),
        timeFrame: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  outcomesTotal: z.number().optional(),
  contacts: z
    .array(
      z.strictObject({
        name: z.string().optional(),
        role: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      }),
    )
    .optional(),

  // 출처
  /**
   * **이 레코드를 낸 곳을 밝히라고 약관이 요구할 때** 채운다.
   *
   * EMA 는 CTIS 자료의 재생산·배포를 상업·비상업 모두 허용하되 조건을 하나 단다 —
   * *"EMA is always acknowledged as the source of the material. Such acknowledgement
   * must be included in **each copy** of the material."* 봉투 한 곳에만 적으면 레코드를
   * 하나씩 꺼내 쓰는 소비자에게는 그 표시가 따라가지 않는다. 그래서 레코드마다 싣는다.
   *
   * `sourceRefreshedAt` 가 ICTRP 약관 때문에 있는 것과 같은 부류의 자리다.
   */
  attribution: z.string().min(1).optional(),
  fetchedAt: z.string().min(1),
  /**
   * 이 레코드를 **이 레지스트리가 마지막으로 수확한 시각.** 집계 레지스트리에만
   * 의미가 있다 — ICTRP 는 다른 레지스트리의 사본을 주기적으로 거둬 오고, 그 수확일은
   * **시험이 갱신된 날이 아니다**(실측: ctgov 2022-03-14 → ICTRP 2022-03-21,
   * 2024-06-03 → 2024-06-10, 둘 다 7일 뒤). 그래서 `dates.lastUpdated` 에 넣지 않는다 —
   * `dates.*` 는 **시험의** 날짜를 담는 자리이고, 그 안에 넣으면 한 뭉치에 두 가지
   * 뜻이 섞인다.
   *
   * WHO ICTRP 이용 약관이 "데이터를 처리한 날짜를 명시" 하라고 요구하는 것도 이 자리다.
   * ctgov·ISRCTN 은 사본이 아니라 원본이므로 채우지 않는다.
   */
  sourceRefreshedAt: z.string().optional(),
  source: z.unknown().optional(),
});
export type TrialRecord = z.infer<typeof TrialRecordSchema>;

export const OutcomeResultSchema = z.strictObject({
  type: z.enum(['primary', 'secondary', 'other']),
  measure: z.string(),
  timeFrame: z.string().optional(),
  description: z.string().optional(),
  groups: z.array(z.strictObject({ title: z.string(), value: z.string().optional() })).optional(),
});
export type OutcomeResult = z.infer<typeof OutcomeResultSchema>;

export const AdverseEventSchema = z.strictObject({
  organ: z.string().optional(),
  term: z.string(),
  serious: z.boolean().optional(),
  affected: z.number().optional(),
  atRisk: z.number().optional(),
});
export type AdverseEvent = z.infer<typeof AdverseEventSchema>;

export const TrialResultsSchema = z.strictObject({
  id: z.string(),
  registry: RegistryKeySchema,
  hasResults: z.boolean(),
  sections: z.strictObject({
    outcomes: z
      .strictObject({ total: z.number(), expanded: z.number(), items: z.array(OutcomeResultSchema) })
      .optional(),
    adverse: z
      .strictObject({
        total: z.number(),
        expanded: z.number(),
        byOrgan: z.array(
          z.strictObject({ organ: z.string(), events: z.number(), expanded: z.boolean() }),
        ),
        items: z.array(AdverseEventSchema),
      })
      .optional(),
    // flow / baseline 은 레지스트리마다 구조가 달라 정규화하지 않고 원문을 통과시킨다.
    flow: z.strictObject({ total: z.number(), items: z.array(z.unknown()) }).optional(),
    baseline: z.strictObject({ total: z.number(), items: z.array(z.unknown()) }).optional(),
  }),
  fetchedAt: z.string(),
});
export type TrialResults = z.infer<typeof TrialResultsSchema>;
