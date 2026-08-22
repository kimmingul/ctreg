import { parseArgs } from 'node:util';
import { CAPS, type FetchOpts, type IncludeSection, type NormalizedQuery, type ResultsOpts } from '../core/query.js';
import { DEFAULT_REGISTRY, REGISTRY_KEYS, type RegistryKey, isRegistryKey } from '../core/registry.js';
import {
  isFilterablePhase, isFilterableStatus, isFilterableStudyType,
  type StudyType, type TrialPhase, type TrialStatus,
} from '../core/vocab.js';
import { usageError } from '../runtime/errors.js';

export const COMMANDS = ['search', 'get', 'results', 'count', 'registries'] as const;

export const USAGE = `ctreg — 임상시험 레지스트리를 하나의 스키마로 조회한다

  ctreg search  [검색 축] [필터] [출력]
  ctreg get     <ID...> [출력]
  ctreg results <ID> [--section s] [--outcome q] [--ae-organ q] [--ae-term q] [--full]
  ctreg count   [search 와 동일한 필터]
  ctreg registries

검색 축   --condition --intervention --term --title --location --outcome-query
          --sponsor --lead --id --patient
필터      --status --phase --study-type (반복 가능)
          --near <lat,lon> --radius <N>km|mi
          --updated-since --updated-before --start-after --start-before
          --completion-after --completion-before   (YYYY-MM-DD)
출력      --registry <key> (반복 가능, 기본 ctgov) --include <section>
          --page-size <N> --page-token <t>
          --sort <field> --eligibility-chars <N> --raw
          --format json|ndjson|text --no-cache --refresh

exit: 0 정상 · 2 사용법 · 3 미지원 · 4 업스트림 · 5 부분 실패
`;

const INCLUDE_SECTIONS: IncludeSection[] = ['core', 'eligibility', 'outcomes', 'contacts', 'locations', 'all'];
const RESULT_SECTIONS = ['outcomes', 'adverse', 'flow', 'baseline'] as const;

export type ParsedArgs = {
  command: (typeof COMMANDS)[number];
  positionals: string[];
  registries: RegistryKey[];
  query: NormalizedQuery;
  fetch: FetchOpts;
  results: ResultsOpts;
  format: 'json' | 'ndjson' | 'text';
  help: boolean;
};

const str = { type: 'string' } as const;
const multi = { type: 'string', multiple: true } as const;
const flag = { type: 'boolean' } as const;

const OPTIONS = {
  condition: str, intervention: str, term: str, title: str, location: str,
  'outcome-query': str, sponsor: str, lead: str, id: str, patient: str,
  status: multi, phase: multi, 'study-type': str,
  near: str, radius: str,
  'updated-since': str, 'updated-before': str,
  'start-after': str, 'start-before': str,
  'completion-after': str, 'completion-before': str,
  registry: multi, include: multi,
  'page-size': str, 'page-token': str, sort: str,
  'eligibility-chars': str, raw: flag,
  format: str, 'no-cache': flag, refresh: flag,
  section: multi, outcome: multi, 'ae-organ': str, 'ae-term': str, full: flag,
  help: flag,
} as const;

function intOpt(raw: string | undefined, name: string, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw usageError(`${name} 은 0 이상의 정수여야 합니다: '${raw}'`);
  if (n > max) throw usageError(`${name} 의 상한은 ${max} 입니다`, `${name} ${max} 이하로 주세요.`);
  return n;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (cause) {
    throw usageError((cause as Error).message, USAGE);
  }
  const v = parsed.values;
  const [command, ...positionals] = parsed.positionals;

  if (v.help) {
    return {
      command: 'registries', positionals: [], registries: [...REGISTRY_KEYS],
      query: {}, fetch: baseFetch(), results: baseResults(), format: 'json', help: true,
    };
  }
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw usageError(command ? `모르는 커맨드: '${command}'` : '커맨드가 없습니다', USAGE);
  }

  // --- 출력 ---
  const format = (v.format ?? 'json') as ParsedArgs['format'];
  if (!['json', 'ndjson', 'text'].includes(format)) {
    throw usageError(`--format 은 json|ndjson|text 중 하나입니다: '${format}'`);
  }
  if (v['no-cache'] && v.refresh) throw usageError('--no-cache 와 --refresh 는 함께 쓸 수 없습니다');
  const cacheMode: FetchOpts['cacheMode'] = v['no-cache'] ? 'off' : v.refresh ? 'refresh' : 'use';

  // 기본값은 커맨드에 따라 다르다. 조회 커맨드(search/get/results/count)는 이름 붙은
  // 하나로 간다 — 등록된 키 전체로 두면 어댑터를 하나 붙이는 순간 기존 호출자 전원의
  // 기본 동작이 조용히 팬아웃으로 바뀐다(DEFAULT_REGISTRY 의 주석 참고).
  //
  // `registries` 는 정반대다. 이 커맨드의 일 자체가 발견이고, §4.5 는 이것을
  // "capability 덤프 — `--registry <key>` 로 하나만" 으로 규정한다: 좁히는 것이
  // 옵션이지 기본이 아니다. 여기까지 DEFAULT_REGISTRY 를 적용하면, 스킬이 요청을
  // 조립하기 전에 부르라고 안내받은 바로 그 커맨드가 두 번째 레지스트리의 존재를
  // 영영 알려주지 않는다 — C2 와 똑같이 어댑터가 하나인 동안에는 보이지 않는다.
  //
  // 중복은 어느 쪽이든 합친다: 그냥 두면 모든 네트워크 커맨드가 같은 레지스트리를 두
  // 번 돌아 count 가 정확히 진실의 2배인 수를 경고 없이 사실로 내고(리뷰 I4), search
  // 는 같은 레코드를 두 번 내며, "레지스트리마다 registries[] 항목 하나" 라는 봉투의
  // 형태 규칙이 깨진다. 순서는 호출자가 준 순서를 그대로 유지한다.
  const fallback: readonly string[] = command === 'registries' ? REGISTRY_KEYS : [DEFAULT_REGISTRY];
  const registries = [...new Set((v.registry ?? fallback) as string[])];
  for (const r of registries) {
    if (!isRegistryKey(r)) {
      throw usageError(`모르는 레지스트리: '${r}'`, 'ctreg registries 로 사용 가능한 키를 확인하세요.');
    }
  }

  const include = (v.include ?? ['core']) as string[];
  for (const s of include) {
    if (!(INCLUDE_SECTIONS as string[]).includes(s)) {
      throw usageError(`모르는 --include 섹션: '${s}'`, `가능: ${INCLUDE_SECTIONS.join(', ')}`);
    }
  }
  if (!include.includes('core')) include.unshift('core');

  const eligibilityChars = intOpt(v['eligibility-chars'], '--eligibility-chars', CAPS.eligibilityChars.max);
  if (eligibilityChars !== undefined && !include.includes('eligibility') && !include.includes('all')) {
    throw usageError('--eligibility-chars 는 --include eligibility 와 함께 써야 합니다');
  }

  // --- 어휘 ---
  const status = (v.status ?? []).map((s) => {
    if (!isFilterableStatus(s)) {
      throw usageError(`--status 값이 잘못되었습니다: '${s}'`, "소문자 공통 어휘를 쓰세요 (예: recruiting). 'unknown'/'other' 는 검색 조건이 아닙니다.");
    }
    return s as TrialStatus;
  });
  const phase = (v.phase ?? []).map((p) => {
    if (!isFilterablePhase(p)) {
      throw usageError(`--phase 값이 잘못되었습니다: '${p}'`, "소문자 공통 어휘를 쓰세요 (예: phase_3). 'other' 는 검색 조건이 아닙니다.");
    }
    return p as TrialPhase;
  });
  let studyType: StudyType | undefined;
  if (v['study-type']) {
    if (!isFilterableStudyType(v['study-type'])) {
      throw usageError(
        `--study-type 값이 잘못되었습니다: '${v['study-type']}'`,
        "소문자 공통 어휘를 쓰세요 (예: interventional). 'other' 는 검색 조건이 아닙니다.",
      );
    }
    studyType = v['study-type'];
  }

  // --- 지오 ---
  let near: { lat: number; lon: number } | undefined;
  if (v.near) {
    const m = v.near.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) {
      throw usageError(
        `--near 는 좌표만 받습니다: '${v.near}'`,
        '지명을 좌표로 바꾸는 기능은 없습니다. --near 37.5665,126.978 처럼 위도,경도를 주세요.',
      );
    }
    near = { lat: Number(m[1]), lon: Number(m[2]) };
  }
  let radius: { value: number; unit: 'km' | 'mi' } | undefined;
  if (v.radius) {
    const m = v.radius.match(/^(\d+(?:\.\d+)?)(km|mi)$/i);
    if (!m) {
      throw usageError(
        `--radius 는 단위가 필요합니다: '${v.radius}'`,
        '접미사가 없으면 업스트림이 미터로 읽습니다. 예: 100km, 50mi',
      );
    }
    radius = { value: Number(m[1]), unit: m[2]!.toLowerCase() as 'km' | 'mi' };
  }
  if (radius && !near) throw usageError('--radius 는 --near 없이 쓸 수 없습니다', '--near <lat,lon> 으로 중심 좌표를 주세요.');

  const query: NormalizedQuery = {
    condition: v.condition, intervention: v.intervention, term: v.term, title: v.title,
    location: v.location, outcomeQuery: v['outcome-query'], sponsor: v.sponsor,
    lead: v.lead, id: v.id, patient: v.patient,
    ...(status.length ? { status } : {}),
    ...(phase.length ? { phase } : {}),
    ...(studyType ? { studyType } : {}),
    ...(near ? { near } : {}),
    ...(radius ? { radius } : {}),
    updatedSince: v['updated-since'], updatedBefore: v['updated-before'],
    startAfter: v['start-after'], startBefore: v['start-before'],
    completionAfter: v['completion-after'], completionBefore: v['completion-before'],
    pageSize: intOpt(v['page-size'], '--page-size', CAPS.pageSize.max),
    pageToken: v['page-token'],
    sort: v.sort,
  };

  const sections = (v.section ?? [...RESULT_SECTIONS]) as string[];
  for (const s of sections) {
    if (!(RESULT_SECTIONS as readonly string[]).includes(s)) {
      throw usageError(`모르는 --section: '${s}'`, `가능: ${RESULT_SECTIONS.join(', ')}`);
    }
  }

  return {
    command: command as ParsedArgs['command'],
    positionals,
    registries: registries as RegistryKey[],
    query,
    fetch: {
      include: include as IncludeSection[],
      caps: {
        locations: CAPS.locations.default,
        eligibilityChars: eligibilityChars ?? CAPS.eligibilityChars.default,
        outcomes: CAPS.outcomes.default,
      },
      cacheMode,
      raw: v.raw ?? false,
      ...(near ? { near } : {}),
    },
    results: {
      sections: sections as ResultsOpts['sections'],
      ...(v.outcome ? { outcomeFilter: v.outcome } : {}),
      ...(v['ae-organ'] ? { aeOrganFilter: v['ae-organ'] } : {}),
      ...(v['ae-term'] ? { aeTermFilter: v['ae-term'] } : {}),
      full: v.full ?? false,
      cacheMode,
    },
    format,
    help: false,
  };
}

const baseFetch = (): FetchOpts => ({
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'use',
  raw: false,
});
const baseResults = (): ResultsOpts => ({ sections: [...RESULT_SECTIONS], full: false, cacheMode: 'use' });
