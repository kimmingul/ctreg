import type { Warning } from '../core/capability.js';
import type { RegistryKey } from '../core/registry.js';
import { EXIT, type ExitCode } from './exit-codes.js';

export type RegistryStatus = {
  registry: RegistryKey;
  status: 'ok' | 'error' | 'unsupported';
  total?: number;
  returned?: number;
  nextPageToken?: string;
  error?: { code: string; message: string };
};

export type Envelope = {
  query: unknown;
  registries: RegistryStatus[];
  warnings: Warning[];
  data: unknown;
  error?: { code: string; message: string; hint?: string };
};

/** JSON.stringify 는 undefined 값을 자동으로 뺀다 — 봉투에 빈 필드가 남지 않는다. */
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
    if (r.error) lines.push(`  오류 ${r.error.code}: ${r.error.message}`);
  }
  if (env.error)
    lines.push(`오류 ${env.error.code}: ${env.error.message}${env.error.hint ? `\n  ${env.error.hint}` : ''}`);

  if (Array.isArray(env.data)) {
    for (const row of env.data as Record<string, unknown>[]) {
      lines.push('');
      lines.push(`${String(row.id ?? '')}  ${String(row.status ?? '')}`);
      lines.push(`  ${String(row.title ?? '')}`);
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
