import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate, record, statsPath, type CallRecord } from '../../src/mcp/stats.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ctreg-stats-'));

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  at: '2026-09-10T00:00:00.000Z',
  tool: 'search',
  registries: ['ctgov'],
  exitCode: 0,
  ms: 120,
  ...over,
});

/**
 * 호출 통계는 **개인정보 없이** 센다 — 도구·레지스트리·종료코드·소요시간뿐이다. 검색어는
 * 남기지 않는다: 질환명이나 연구자 이름은 그 자체가 민감할 수 있다. 운영계정 신청의
 * "예상 트래픽" 에 필요한 것은 이것이 전부다.
 */
describe('호출 기록', () => {
  it('한 호출이 NDJSON 한 줄이다 — 죽어도 그때까지는 남는다', () => {
    const d = dir();
    record(d, call());
    record(d, call({ tool: 'count' }));
    const lines = readFileSync(statsPath(d), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toMatchObject({ tool: 'count' });
  });

  /**
   * **검색어를 남기지 않는다는 것을 못 박는다.** `CallRecord` 에 그 자리가 없는 것이 1차
   * 방어이고, 이 테스트는 누가 자리를 더해도 파일에 안 실리는지 본다.
   */
  it('검색어·인자는 기록에 없다', () => {
    const d = dir();
    record(d, { ...call(), args: { condition: 'melanoma' } } as CallRecord);
    expect(readFileSync(statsPath(d), 'utf8')).not.toContain('melanoma');
  });
});

describe('집계', () => {
  const rows: CallRecord[] = [
    call({ at: '2026-09-10T01:00:00Z', tool: 'search', registries: ['ctgov'], exitCode: 0, ms: 100 }),
    call({ at: '2026-09-10T02:00:00Z', tool: 'search', registries: ['ctgov', 'cris'], exitCode: 5, ms: 300 }),
    call({ at: '2026-09-10T03:00:00Z', tool: 'count', registries: ['cris'], exitCode: 4, ms: 50 }),
    call({ at: '2026-09-11T01:00:00Z', tool: 'registries', registries: [], exitCode: 0, ms: 2 }),
  ];

  it('총계·도구별·종료코드별을 낸다', () => {
    const a = aggregate(rows);
    expect(a.total).toBe(4);
    expect(a.byTool).toEqual({ search: 2, count: 1, registries: 1 });
    expect(a.byExit).toEqual({ 0: 2, 4: 1, 5: 1 });
  });

  /**
   * **레지스트리별은 호출이 아니라 레지스트리 언급 수다.** 한 호출이 둘을 부르면 둘 다
   * 센다 — 그래서 합이 총계보다 클 수 있다. 스킬이 "범주별 건수를 더하지 마라" 고
   * 가르치는 것과 같은 성질이고, 집계 결과가 그것을 말해야 한다.
   */
  it('레지스트리별은 언급 수다 — 합이 총계를 넘을 수 있다', () => {
    const a = aggregate(rows);
    expect(a.byRegistry).toEqual({ ctgov: 2, cris: 2 });
    expect(a.byRegistry.ctgov! + a.byRegistry.cris!).toBeGreaterThan(a.total - 1); // 4건 중 registries 는 언급 없음
  });

  it('일별로 센다 — 운영계정 신청의 예상 트래픽이 이것이다', () => {
    const a = aggregate(rows);
    expect(a.byDay).toEqual({ '2026-09-10': 3, '2026-09-11': 1 });
  });

  it('소요시간의 중앙값과 최대를 낸다 — 평균은 꼬리에 끌린다', () => {
    const a = aggregate(rows);
    expect(a.ms.max).toBe(300);
    expect(a.ms.p50).toBe(75); // [2, 50, 100, 300] 의 중앙값
  });

  it('빈 기록은 0 이지 오류가 아니다', () => {
    const a = aggregate([]);
    expect(a.total).toBe(0);
    expect(a.ms).toEqual({ p50: 0, max: 0 });
  });
});
