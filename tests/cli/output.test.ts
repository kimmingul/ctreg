import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/cli/exit-codes.js';
import { type Envelope, exitFor, render } from '../../src/cli/output.js';

const base: Envelope = {
  query: { condition: 'NSCLC' },
  registries: [{ registry: 'ctgov', status: 'ok', total: 412, returned: 2 }],
  warnings: [],
  data: [
    { id: 'CTGOV:NCT00000001', title: 'Study One', status: 'recruiting' },
    { id: 'CTGOV:NCT00000002', title: 'Study Two', status: 'completed' },
  ],
};

describe('출력 봉투', () => {
  it('json 은 봉투 전체를 한 덩어리로 낸다', () => {
    const parsed = JSON.parse(render(base, 'json'));
    expect(Object.keys(parsed)).toEqual(['query', 'registries', 'warnings', 'data']);
    expect(parsed.registries[0].total).toBe(412);
  });

  it('ndjson 은 배열 데이터를 한 줄에 하나씩 낸다', () => {
    const lines = render(base, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe('CTGOV:NCT00000001');
  });

  it('ndjson 은 배열이 아닌 데이터를 한 줄로 낸다', () => {
    const lines = render({ ...base, data: { total: 412 } }, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('text 는 사람이 읽는 형식이며 JSON 이 아니다', () => {
    const out = render(base, 'text');
    expect(out).toContain('CTGOV:NCT00000001');
    expect(out).toContain('Study One');
    expect(() => JSON.parse(out)).toThrow();
  });

  it('경고는 어떤 포맷에서도 사라지지 않는다', () => {
    const withWarn: Envelope = {
      ...base,
      warnings: [{ code: 'locations_truncated', message: '장소를 잘랐습니다.', id: 'CTGOV:NCT00000001', at: 10 }],
    };
    expect(JSON.parse(render(withWarn, 'json')).warnings).toHaveLength(1);
    expect(render(withWarn, 'text')).toContain('locations_truncated');
  });

  it('undefined 필드는 봉투에 넣지 않는다', () => {
    const parsed = JSON.parse(render(base, 'json'));
    expect(parsed.registries[0]).not.toHaveProperty('nextPageToken');
  });

  it('모든 레지스트리가 정상이면 exit 0 — 결과 0건도 정상이다', () => {
    expect(exitFor({ ...base, data: [] })).toBe(EXIT.OK);
  });

  it('일부만 실패하면 exit 5 다', () => {
    expect(
      exitFor({
        ...base,
        registries: [
          { registry: 'ctgov', status: 'ok', returned: 1 },
          { registry: 'ctgov', status: 'error', error: { code: 'upstream', message: 'boom' } },
        ],
      }),
    ).toBe(EXIT.PARTIAL);
  });

  it('전부 실패하면 exit 4 다', () => {
    expect(
      exitFor({
        ...base,
        registries: [{ registry: 'ctgov', status: 'error', error: { code: 'upstream', message: 'boom' } }],
      }),
    ).toBe(EXIT.UPSTREAM);
  });

  it('전부 미지원이면 exit 3 이다', () => {
    expect(
      exitFor({
        ...base,
        registries: [{ registry: 'ctgov', status: 'unsupported', error: { code: 'unsupported', message: 'no geo' } }],
      }),
    ).toBe(EXIT.UNSUPPORTED);
  });
});
