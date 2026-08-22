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
  crossIds: z.array(z.strictObject({ registry: z.string(), id: z.string() })).optional(),
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
  fetchedAt: z.string().min(1),
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
