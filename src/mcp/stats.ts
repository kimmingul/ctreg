import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 호출 통계 — **누가** 가 아니라 **얼마나** 를 센다.
 *
 * 공개 서버에 넣는 이유는 둘이다. 운영계정 신청의 "예상 트래픽" 칸을 지어내지 않고 채우려면
 * 실측이 있어야 하고, 요청률 버킷이 프로세스 전체에 하나라 사용자가 늘면 각자의 몫이 줄어드는
 * 것을 알아채려면 호출 수를 봐야 한다.
 *
 * **기록하지 않는 것이 설계의 절반이다.**
 * - **IP·세션·사용자** — 없다. MCP 에는 로그인이 없어 사람을 가리킬 수 있는 것이 IP 뿐인데
 *   그것은 개인정보다. "몇 명" 은 이 통계로 알 수 없고, 그것을 모르는 채로 두기로 정했다.
 * - **검색어·인자** — 없다. 질환명이나 연구자 이름은 그 자체가 민감할 수 있다.
 *   `CallRecord` 에 그 자리가 없는 것이 1차 방어이고, 테스트가 파일에 안 실리는지 본다.
 *
 * 저장은 NDJSON 한 줄씩 append 다 — 서버가 죽어도 그때까지의 기록이 남고, 파일 하나가
 * 곧 원장이다. 데이터베이스를 두지 않는다: 이 서버의 예상 규모에서 그것은 과하다.
 */
export type CallRecord = {
  /** ISO 시각. */
  at: string;
  tool: string;
  /** 이 호출이 건드린 레지스트리. `registries` 도구처럼 없으면 빈 배열이다. */
  registries: string[];
  exitCode: number;
  /** 소요시간(밀리초). */
  ms: number;
};

export const statsPath = (dir: string): string => join(dir, 'mcp-calls.ndjson');

/** 한 줄 append. 디렉터리가 없으면 만든다. 실패해도 던지지 않는다 — 통계가 서비스를 막으면 안 된다. */
export function record(dir: string, r: CallRecord): void {
  try {
    mkdirSync(dir, { recursive: true });
    // 허용된 키만 싣는다 — 누가 CallRecord 에 자리를 더해도 여기서 걸러진다.
    const row: CallRecord = { at: r.at, tool: r.tool, registries: r.registries, exitCode: r.exitCode, ms: r.ms };
    appendFileSync(statsPath(dir), `${JSON.stringify(row)}\n`);
  } catch {
    // 디스크 문제로 통계를 못 남기는 것은 서비스 장애가 아니다.
  }
}

export function readAll(dir: string): CallRecord[] {
  let text: string;
  try {
    text = readFileSync(statsPath(dir), 'utf8');
  } catch {
    return [];
  }
  const out: CallRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as CallRecord);
    } catch {
      // 반쯤 쓰인 줄(프로세스가 그 순간 죽었을 때)은 건너뛴다.
    }
  }
  return out;
}

export type Aggregate = {
  total: number;
  byTool: Record<string, number>;
  byExit: Record<number, number>;
  /**
   * **호출 수가 아니라 언급 수다.** 한 호출이 레지스트리 둘을 부르면 둘 다 센다 — 그래서
   * 합이 `total` 을 넘을 수 있다. 스킬이 "범주별 건수를 더하지 마라" 고 가르치는 것과 같다.
   */
  byRegistry: Record<string, number>;
  /** `YYYY-MM-DD` → 호출 수. 운영계정 신청의 "예상 트래픽" 이 이것이다. */
  byDay: Record<string, number>;
  /** 중앙값과 최대. 평균은 꼬리에 끌려 쓰지 않는다. */
  ms: { p50: number; max: number };
  first?: string;
  last?: string;
};

const count = <K extends string | number>(items: K[]): Record<K, number> => {
  const out = {} as Record<K, number>;
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
};

export function aggregate(rows: CallRecord[]): Aggregate {
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = ms.length === 0 ? 0
    : ms.length % 2 === 1 ? ms[(ms.length - 1) / 2]!
    : (ms[ms.length / 2 - 1]! + ms[ms.length / 2]!) / 2;
  return {
    total: rows.length,
    byTool: count(rows.map((r) => r.tool)),
    byExit: count(rows.map((r) => r.exitCode)),
    byRegistry: count(rows.flatMap((r) => r.registries)),
    byDay: count(rows.map((r) => r.at.slice(0, 10))),
    ms: { p50, max: ms.length === 0 ? 0 : ms[ms.length - 1]! },
    ...(sorted.length > 0 ? { first: sorted[0]!.at, last: sorted[sorted.length - 1]!.at } : {}),
  };
}
