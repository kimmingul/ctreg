import { parseArgs } from 'node:util';
import { CAPS, resolvePageSize, type FetchOpts, type IncludeSection, type NormalizedQuery, type ResultsOpts } from '../core/query.js';
import { DEFAULT_REGISTRY, REGISTRY_KEYS, type RegistryKey, isRegistryKey } from '../core/registry.js';
import {
  FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE,
  isFilterablePhase, isFilterableStatus, isFilterableStudyType,
  type StudyType, type TrialPhase, type TrialStatus,
} from '../core/vocab.js';
import { usageError } from '../runtime/errors.js';

export const COMMANDS = ['search', 'get', 'results', 'count', 'registries'] as const;

// FILTERABLE_STATUS 는 8개라 한 줄에 다 넣으면 80컬럼에서 단어 중간이 잘린다.
// 3/5로 나눠 두 줄에 걸치되, 나누는 지점(3)은 순전히 줄바꿈용 상수이지 값이
// 아니다 — slice(3)이 나머지 전부를 가져가므로 값이 빠질 수는 없다. 다만 폭은
// 보장하지 않는다: 어휘가 늘면 두 줄 다 다시 길어질 수 있으니 그때 폭을 다시 확인하라.
export const USAGE = `ctreg — 임상시험 레지스트리를 하나의 스키마로 조회한다

  ctreg search  [검색 축] [필터] [출력]
  ctreg get     <ID...> [출력]
  ctreg results <ID> [--section s] [--outcome q] [--ae-organ q] [--ae-term q] [--full]
  ctreg count   [search 와 동일한 필터]
  ctreg registries

검색 축   --condition --intervention --term --title --location --outcome-query
          --sponsor --lead --id --patient
필터      --status ${FILTERABLE_STATUS.slice(0, 3).join('|')}|
          ${FILTERABLE_STATUS.slice(3).join('|')}
          --phase ${FILTERABLE_PHASE.join('|')}
          --study-type ${FILTERABLE_STUDY_TYPE.join('|')}
          (셋 다 반복 가능. 값은 소문자다 — 레지스트리 원문 값이 아니라 공통 어휘다)
          --near <lat,lon> --radius <N>km|mi
          --updated-since --updated-before --start-after --start-before
          --completion-after --completion-before   (YYYY-MM-DD)
출력      --registry <key> (반복 가능, 기본 ctgov) --include <section>
          --page-size <N> --page-token <t>
          --sort <field> --eligibility-chars <N> --raw
          --format json|ndjson|text --no-cache --refresh

레지스트리마다 받는 값이 다르다. 어느 축을 어떤 값으로 쓸 수 있는지는 \`ctreg registries\` 가 말한다.

exit: 0 정상(0건 포함) · 2 사용법 · 3 미지원 · 4 업스트림
      5 부분 실패 — 일부 레지스트리만 성공. 경고는 종료 코드를 바꾸지 않는다.
`;

const INCLUDE_SECTIONS: IncludeSection[] = ['core', 'eligibility', 'outcomes', 'contacts', 'locations', 'all'];
const RESULT_SECTIONS = ['outcomes', 'adverse', 'flow', 'baseline'] as const;

export type ParsedArgs = {
  /**
   * `--help` 를 커맨드 없이 주면 `undefined` 다. 예전에는 이 자리에 `'registries'` 를
   * 넣었는데, 그것은 거짓이었고 **커맨드 단어를 버리게 만들어** 서브커맨드별 사용법을
   * 원리상 불가능하게 했다(F3). `help: true` 인 봉투는 커맨드를 실행하지 않으므로
   * (index.ts 가 먼저 반환한다) 여기서 비는 것이 정확하다.
   */
  command: (typeof COMMANDS)[number] | undefined;
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

export const OPTION_NAMES = Object.keys(OPTIONS) as (keyof typeof OPTIONS)[];

/** 어느 커맨드에서나 뜻이 같은 것들. 표를 다섯 번 반복하지 않으려고 따로 뺀다. */
const COMMON_OPTIONS = ['registry', 'format', 'help'] as const;
/** 네트워크를 치는 커맨드만 캐시를 말할 수 있다. `registries` 는 정적 선언 덤프다. */
const NETWORK_OPTIONS = ['no-cache', 'refresh', 'raw'] as const;
/** search 와 count 가 공유하는 질의 표면. 둘의 차이는 레코드를 받느냐뿐이다. */
const QUERY_OPTIONS = [
  'condition', 'intervention', 'term', 'title', 'location', 'outcome-query',
  'sponsor', 'lead', 'id', 'patient', 'status', 'phase', 'study-type',
  'near', 'radius',
  'updated-since', 'updated-before', 'start-after', 'start-before',
  'completion-after', 'completion-before',
] as const;

/**
 * 커맨드가 **실제로 소비하는** 옵션. 여기 없는 것을 주면 exit 2 다.
 *
 * 왜 필요한가(F4) — 실측: `get <ID> --page-size 5 --sort x` 가 exit 0 으로 끝났고 그
 * 플래그들에 대한 말이 아무 데도 없었다. `get` 은 배치 조회라 페이지도 정렬도 없는데,
 * 사용자가 그것을 준 것은 **먹힌다고 믿는다** 는 뜻이다. 조용히 무시하면 그 믿음이
 * 그대로 답까지 간다 — 필드 테스트에서 에이전트가 해보지도 않은 페이지네이션을
 * 사용자에게 권한 유인이 이것이다(F4·A2).
 *
 * 거절이지 경고가 아닌 이유: 조용히 무시하지 않는 것이 이 도구의 축이고, `ParsedArgs`
 * 에는 경고를 실어 보낼 자리가 아직 없다(같은 이유로 `--raw` 페이로드 경고가 이연됐다).
 *
 * **이 표를 `--help` 도 읽는다**(F3). 커맨드가 무엇을 받는지 두 곳에 적으면 옵션이 하나
 * 늘 때 한쪽만 갱신되고, 그 어긋남은 이 저장소에서 이미 세 번 일어났다. 거절 메시지가
 * 대안을 말할 수 있는 것도 같은 표를 읽기 때문이다.
 *
 * 보수적으로 잡는다 — 원리상 못 쓰는 것만 뺀다. `count` 의 `page-size` 가 남아 있는 것은
 * 실수가 아니다: `applyLimits` 가 레지스트리 순서에 따라 클램프가 갈리지 않도록 일부러
 * 적용한다(commands/count.ts 주석).
 */
export const COMMAND_OPTIONS: Record<(typeof COMMANDS)[number], readonly (keyof typeof OPTIONS)[]> = {
  search: [...COMMON_OPTIONS, ...NETWORK_OPTIONS, ...QUERY_OPTIONS,
    'include', 'eligibility-chars', 'page-size', 'page-token', 'sort'],
  // count 는 개수만 받으므로 레코드 표면(include/eligibility-chars/page-token/sort)이 없다.
  count: [...COMMON_OPTIONS, ...NETWORK_OPTIONS, ...QUERY_OPTIONS, 'page-size'],
  // get 은 ID 목록으로 부른다 — 질의 축도, 페이지도, 정렬도 성립하지 않는다.
  get: [...COMMON_OPTIONS, ...NETWORK_OPTIONS, 'include', 'eligibility-chars'],
  // results 는 ID 하나. 섹션과 전개 필터가 이 커맨드만의 표면이다.
  results: [...COMMON_OPTIONS, ...NETWORK_OPTIONS, 'section', 'outcome', 'ae-organ', 'ae-term', 'full'],
  // registries 는 정적 capability 덤프다. 네트워크도, 질의도 없다.
  registries: [...COMMON_OPTIONS],
};

/** 커맨드 한 줄 요약. `--help` 가 이것과 옵션 표를 함께 낸다. */
const COMMAND_SUMMARY: Record<(typeof COMMANDS)[number], string> = {
  search: '검색 축과 필터로 시험을 찾는다. 레코드를 받는다.',
  count: 'search 와 같은 축·필터로 개수만 센다. 레코드를 받지 않아 빠르다.',
  get: '접두사 붙은 ID 여럿을 한 번에 받아 온다. 검색이 아니라 조회다.',
  results: 'ID 하나의 결과(평가변수·이상반응·흐름·기저)를 낸다. 기본은 요약이다.',
  registries: '이 빌드가 다루는 레지스트리와 각 축이 무엇을 보는지 낸다. 네트워크를 타지 않는다.',
};

/**
 * 커맨드별 사용법(F3). 옵션 목록의 정본은 `COMMAND_OPTIONS` 하나이므로, 여기서
 * 손으로 다시 적지 않는다 — 두 벌로 두면 옵션이 하나 늘 때 거절하는 쪽과 안내하는
 * 쪽이 어긋나고, 사용자는 "받는다고 적혀 있는데 exit 2" 를 만난다.
 */
export function helpFor(command: (typeof COMMANDS)[number]): string {
  const accepts = new Set<string>(COMMAND_OPTIONS[command]);
  const opts = COMMAND_OPTIONS[command].map((o) => `--${o}`).join(' ');
  const positional =
    command === 'get' ? ' <ID...>' : command === 'results' ? ' <ID>' : '';
  /**
   * 닫힌 어휘 축을 받는 커맨드면 **값도 적는다.** F5·F9 를 닫은 것이 "`--help` 가 값
   * 어휘를 적는다" 였는데, 서브커맨드별 사용법이 값을 빼면 사용자가 가장 자주 밟는
   * 경로(`ctreg search --help`)에서 그것이 되살아난다 — 실제로 그렇게 회귀했고, 스위트가
   * `USAGE` 상수만 보고 있어서 실물을 돌려 보고서야 드러났다.
   *
   * 목록은 어휘에서 파생한다(`USAGE` 와 같은 규칙). 어휘가 늘면 두 곳이 함께 따라간다.
   */
  const vocab = [
    accepts.has('status') ? `  --status      ${FILTERABLE_STATUS.join('|')}` : undefined,
    accepts.has('phase') ? `  --phase       ${FILTERABLE_PHASE.join('|')}` : undefined,
    accepts.has('study-type') ? `  --study-type  ${FILTERABLE_STUDY_TYPE.join('|')}` : undefined,
  ].filter((l): l is string => l !== undefined);
  const vocabBlock = vocab.length
    ? `\n값 (소문자다 — 레지스트리 원문 값이 아니라 공통 어휘다)\n${vocab.join('\n')}\n`
    : '';
  return `ctreg ${command}${positional}

${COMMAND_SUMMARY[command]}

받는 옵션
  ${opts}
${vocabBlock}
값이 레지스트리마다 다른 축은 \`ctreg registries\` 가 말한다.
전체 사용법은 \`ctreg --help\` 다.
`;
}

/** 표에 없는 플래그를 실제로 준 경우에만 거절한다. 주지 않은 것은 `undefined`/`false` 다. */
function assertCommandAccepts(command: (typeof COMMANDS)[number], v: Record<string, unknown>): void {
  const allowed = new Set<string>(COMMAND_OPTIONS[command]);
  for (const name of OPTION_NAMES) {
    const given = v[name];
    if (given === undefined || given === false) continue;
    if (allowed.has(name)) continue;
    throw usageError(
      `'${command}' 커맨드는 --${name} 옵션을 쓰지 않습니다`,
      `이 옵션을 줘도 무시되는 대신 여기서 멈춥니다. '${command}' 커맨드가 받는 것: ` +
        `${COMMAND_OPTIONS[command].map((o) => `--${o}`).join(' ')}`,
    );
  }
}

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
    // 커맨드 단어를 **살린다.** 이것이 F3 의 전부다 — 버리면 `ctreg get --help` 와
    // `ctreg --help` 가 같은 입력이 되어 서브커맨드별 사용법이 원리상 불가능해진다.
    const asked = (COMMANDS as readonly string[]).includes(command ?? '') ? (command as (typeof COMMANDS)[number]) : undefined;
    return {
      command: asked, positionals: [], registries: [...REGISTRY_KEYS],
      query: {}, fetch: baseFetch(), results: baseResults(), format: 'json', help: true,
    };
  }
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw usageError(command ? `모르는 커맨드: '${command}'` : '커맨드가 없습니다', USAGE);
  }
  assertCommandAccepts(command as (typeof COMMANDS)[number], v as Record<string, unknown>);

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
    // 기본값을 여기서 못박는다 — 어댑터가 각자 채우면 정책이 어댑터 수만큼 생긴다
    // (caps 채널과 같은 규칙, core/query.ts 의 resolvePageSize 주석 참고).
    pageSize: resolvePageSize({ pageSize: intOpt(v['page-size'], '--page-size', CAPS.pageSize.max) }),
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
      // §5.2: caps 는 CLI 가 정한 정책을 어댑터에 전달하는 채널이다. `--include locations`/`all`
      // 이면 locations 캡을, `--include outcomes`/`all` 이면 outcomes 캡을 최대치로 올린다 —
      // 어댑터는 o.caps.X 를 읽기만 한다(eligibilityChars 와 같은 모양).
      caps: {
        locations: include.includes('locations') || include.includes('all') ? CAPS.locations.max : CAPS.locations.default,
        eligibilityChars: eligibilityChars ?? CAPS.eligibilityChars.default,
        outcomes: include.includes('outcomes') || include.includes('all') ? CAPS.outcomes.max : CAPS.outcomes.default,
      },
      cacheMode,
      raw: v.raw ?? false,
      ...(near ? { near } : {}),
      ...(v.location ? { locationTerm: v.location } : {}),
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
