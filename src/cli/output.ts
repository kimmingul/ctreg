import type { Warning } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import { EXIT, type ExitCode } from './exit-codes.js';

export type RegistryStatus = {
  registry: RegistryKey;
  status: 'ok' | 'error' | 'unsupported';
  total?: number;
  returned?: number;
  nextPageToken?: string;
  /**
   * `hint` 는 업스트림 오류를 회복 가능한 문장으로 옮긴 것이다 (§5.3). 400 이 날 수
   * 있는 유일한 경로가 레지스트리별 catch 이므로, 여기에 자리가 없으면 http.ts 가
   * 업스트림 본문에서 만들어 둔 힌트("Unknown sort field")가 봉투 문턱에서 사라진다 —
   * 호출자는 무엇을 고쳐야 하는지 모른 채 "400 을 반환했습니다" 만 받는다.
   */
  error?: { code: string; message: string; hint?: string };
};

export type Envelope = {
  query: unknown;
  registries: RegistryStatus[];
  warnings: Warning[];
  data: unknown;
  error?: { code: string; message: string; hint?: string };
};

/** JSON.stringify 는 undefined 값을 자동으로 뺀다 — 봉투에 빈 필드가 남지 않는다. */
/** 문자열 배열을 `, ` 로 잇되, 배열이 아니거나 비었으면 `undefined`. */
function joinList(v: unknown, pick?: (x: Record<string, unknown>) => unknown): string | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const parts = v
    .map((x) => (pick !== undefined && typeof x === 'object' && x !== null ? pick(x as Record<string, unknown>) : x))
    .filter((x): x is string | number => typeof x === 'string' || typeof x === 'number')
    .map(String);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * 레코드 하나를 사람이 읽는 몇 줄로 만든다.
 *
 * **왜 있는가**(실측 2026-08-28) — 이전에는 ID·상태·제목 세 조각만 냈다. 그래서
 * `get <ID> --include all --format text` 가 `--include core` 와 글자 하나 다르지 않았고,
 * 받아 온 적격 기준·결과지표가 화면에 한 글자도 나오지 않았다. 요청한 것이 조용히
 * 사라지는 부류라 고쳤다.
 *
 * 두 가지를 지킨다.
 * - **레코드에 있는 것만 낸다.** 없는 필드는 줄 자체를 만들지 않는다 — 빈 줄과
 *   `undefined` 가 화면에 새면 "그 값이 없다" 와 "그 값이 비어 있다" 가 섞인다.
 * - **일부만 실렸으면 전체 수를 함께 낸다.** `locations` 는 캡만큼만, `outcomes` 도
 *   전개한 것만 실린다. 목록만 보여주면 그것이 전부로 읽히는데, 이 CLI 에서 그 오해는
 *   그냥 오해가 아니라 틀린 판단으로 이어진다.
 */
function recordLines(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const head = [row.id, row.status, joinList(row.phase), row.studyType].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  out.push(head.join('  '));
  if (typeof row.title === 'string' && row.title.length > 0) out.push(`  ${row.title}`);

  const add = (label: string, value: string | undefined): void => {
    if (value !== undefined && value.length > 0) out.push(`  ${label}: ${value}`);
  };

  add('조건', joinList(row.conditions));
  add('중재', joinList(row.interventions, (x) => x.name));

  const sponsor = row.sponsor as Record<string, unknown> | undefined;
  const enrollment = row.enrollment as Record<string, unknown> | undefined;
  add(
    '의뢰',
    [
      typeof sponsor?.lead === 'string' ? sponsor.lead : undefined,
      typeof enrollment?.count === 'number'
        ? `등록 ${enrollment.count}명${typeof enrollment.basis === 'string' ? `(${enrollment.basis})` : ''}`
        : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || undefined,
  );

  const dates = row.dates as Record<string, unknown> | undefined;
  if (dates !== undefined) {
    const span = [dates.start, dates.completion].filter((d): d is string => typeof d === 'string');
    if (span.length > 0) add('기간', span.join(' ~ '));
  }

  // 캡에 걸려 일부만 실린 두 목록은 **전체 수를 함께** 말한다.
  const locations = row.locations;
  if (Array.isArray(locations) && locations.length > 0) {
    const total = typeof row.locationsTotal === 'number' ? row.locationsTotal : locations.length;
    const first = joinList(locations.slice(0, 3), (x) =>
      [x.facility, x.city, x.country].filter((y): y is string => typeof y === 'string' && y.length > 0).join(' / '),
    );
    add(`기관 ${locations.length}/${total}`, first);
  }

  const eligibility = row.eligibility as Record<string, unknown> | undefined;
  if (eligibility !== undefined) {
    add(
      '적격',
      [eligibility.minAge, eligibility.maxAge, eligibility.sex]
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .join(' · ') || undefined,
    );
    /**
     * 기준문 자체를 낸다. 안 내면 `eligibility_truncated` 경고가 **사용자가 본 적 없는
     * 것이 잘렸다** 고 말하는 꼴이 된다. 여러 줄이므로 들여쓰기를 유지해 붙인다.
     */
    if (typeof eligibility.criteriaText === 'string' && eligibility.criteriaText.length > 0) {
      const body = eligibility.criteriaText.trimEnd().split('\n').map((l) => `    ${l}`).join('\n');
      out.push(`  적격기준${eligibility.criteriaTruncated === true ? ' (잘림)' : ''}:`);
      out.push(body);
    }
  }

  const outcomes = row.outcomes;
  if (Array.isArray(outcomes) && outcomes.length > 0) {
    const total = typeof row.outcomesTotal === 'number' ? row.outcomesTotal : outcomes.length;
    add(`결과지표 ${outcomes.length}/${total}`, joinList(outcomes.slice(0, 3), (x) => x.measure));
  }

  if (typeof row.url === 'string' && row.url.length > 0) out.push(`  ${row.url}`);
  return out;
}

export function render(env: Envelope, format: 'json' | 'ndjson' | 'text'): string {
  if (format === 'json') return `${JSON.stringify(env, null, 2)}\n`;

  if (format === 'ndjson') {
    // data 가 없으면 데이터 줄을 아예 내지 않는다. `null` 한 줄은 레코드가 아닌데도
    // 레코드 자리에 앉아, 스트리밍 소비자가 걸러내야 하는 가짜 행이 된다.
    // 메타 줄은 그대로 나가므로 "마지막 줄은 언제나 메타" 규칙은 그대로다.
    const rows = Array.isArray(env.data) ? env.data : env.data === null || env.data === undefined ? [] : [env.data];
    const dataLines = rows.map((r) => JSON.stringify(r));
    // 데이터 줄 뒤에 메타데이터 한 줄을 항상 붙인다 — query/registries/warnings/error 는
    // 개별 레코드에 담을 자리가 없다 (예: throttle_lock_timeout 은 id 가 없다).
    // `_meta: true` 로 구분하며, 레코드 스키마가 strict 라 데이터 줄이 이 키를 우연히 갖지 않는다.
    // 조건 없이 항상 낸다 — 소비자가 "마지막 줄은 언제나 메타"라는 규칙 하나만 알면 되게 하기 위해서다.
    const meta: { _meta: true; query: unknown; registries: RegistryStatus[]; warnings: Warning[]; error?: Envelope['error'] } = {
      _meta: true,
      query: env.query,
      registries: env.registries,
      warnings: env.warnings,
      error: env.error,
    };
    return [...dataLines, JSON.stringify(meta)].join('\n') + '\n';
  }

  const lines: string[] = [];
  for (const r of env.registries) {
    const counts = [
      r.total !== undefined ? `총 ${r.total}건` : undefined,
      r.returned !== undefined ? `표시 ${r.returned}건` : undefined,
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`[${r.registry}] ${r.status}${counts ? ` — ${counts}` : ''}`);
    if (r.error) {
      lines.push(`  오류 ${r.error.code}: ${r.error.message}`);
      if (r.error.hint) lines.push(`    ${r.error.hint}`);
    }
  }
  if (env.error)
    lines.push(`오류 ${env.error.code}: ${env.error.message}${env.error.hint ? `\n  ${env.error.hint}` : ''}`);

  if (Array.isArray(env.data)) {
    for (const row of env.data as Record<string, unknown>[]) {
      lines.push('');
      lines.push(...recordLines(row));
    }
  } else if (env.data !== undefined && env.data !== null) {
    lines.push('');
    lines.push(JSON.stringify(env.data, null, 2));
  }

  for (const w of env.warnings) {
    lines.push('');
    lines.push(`! ${w.code}${w.id ? ` (${w.id})` : ''}: ${w.message}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * registries[] 상태를 하나의 종료 코드로 접는다.
 * - 빈 배열이거나 전부 ok 면 0 (결과 0건도 정상).
 * - 하나라도 ok 이고 나머지가 실패/미지원이면 부분 성공 5.
 * - 하나도 ok 가 아니고 전부 unsupported 면 3.
 * - 하나도 ok 가 아니고 error 가 섞여 있으면 4 (unsupported 보다 error 를 우선한다).
 */
export function exitFor(env: Envelope): ExitCode {
  const states = env.registries.map((r) => r.status);
  if (states.length === 0) return EXIT.OK;
  if (states.every((s) => s === 'ok')) return EXIT.OK;
  if (states.some((s) => s === 'ok')) return EXIT.PARTIAL;
  if (states.every((s) => s === 'unsupported')) return EXIT.UNSUPPORTED;
  return EXIT.UPSTREAM;
}
