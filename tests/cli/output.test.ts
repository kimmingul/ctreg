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

  it('ndjson 은 배열 데이터를 한 줄에 하나씩 내고, 마지막에 메타데이터 한 줄을 붙인다', () => {
    const lines = render(base, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).id).toBe('CTGOV:NCT00000001');
    const meta = JSON.parse(lines[2]!);
    expect(meta._meta).toBe(true);
    expect(meta.registries[0].total).toBe(412);
  });

  it('ndjson 은 배열이 아닌 데이터를 한 줄로 내고, 마지막에 메타데이터 한 줄을 붙인다', () => {
    const lines = render({ ...base, data: { total: 412 } }, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)._meta).toBe(true);
  });

  it('ndjson 메타데이터 줄은 경고가 없어도 항상 나온다 — 소비자가 예외 없이 마지막 줄을 메타로 다룰 수 있게', () => {
    const lines = render({ ...base, data: [] }, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const meta = JSON.parse(lines[0]!);
    expect(meta._meta).toBe(true);
    expect(meta.warnings).toEqual([]);
  });

  it('ndjson 은 경고를 메타데이터 줄에 담아 흘리지 않는다', () => {
    const withWarn: Envelope = {
      ...base,
      warnings: [{ code: 'throttle_lock_timeout', message: '락을 잡지 못했습니다.' }],
    };
    const lines = render(withWarn, 'ndjson').trimEnd().split('\n');
    const meta = JSON.parse(lines[lines.length - 1]!);
    expect(meta._meta).toBe(true);
    expect(meta.warnings).toEqual([{ code: 'throttle_lock_timeout', message: '락을 잡지 못했습니다.' }]);
  });

  it('ndjson 은 봉투 최상위 error 도 메타데이터 줄에 담는다', () => {
    const withError: Envelope = {
      ...base,
      error: { code: 'upstream', message: 'boom' },
    };
    const lines = render(withError, 'ndjson').trimEnd().split('\n');
    const meta = JSON.parse(lines[lines.length - 1]!);
    expect(meta._meta).toBe(true);
    expect(meta.error).toEqual({ code: 'upstream', message: 'boom' });
  });

  it('ndjson 은 data 가 null 이면 데이터 줄을 내지 않는다 — null 은 레코드가 아니다', () => {
    const lines = render({ ...base, data: null }, 'ndjson').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)._meta).toBe(true);
  });

  it('ndjson 데이터 줄은 절대 _meta 키를 갖지 않는다', () => {
    const lines = render(base, 'ndjson').trimEnd().split('\n');
    const dataLines = lines.slice(0, -1);
    for (const line of dataLines) {
      expect(JSON.parse(line)).not.toHaveProperty('_meta');
    }
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

  it('text 는 배열도 null 도 아닌 데이터(예: count 결과)를 그대로 찍는다', () => {
    const out = render({ ...base, data: { total: 412 } }, 'text');
    expect(out).toContain('412');
  });

  it('text 는 봉투 최상위 error 도 사람이 읽을 수 있게 낸다', () => {
    const withError: Envelope = {
      ...base,
      error: { code: 'upstream', message: 'boom', hint: '나중에 다시 시도하세요.' },
    };
    const out = render(withError, 'text');
    expect(out).toContain('upstream');
    expect(out).toContain('boom');
    expect(out).toContain('나중에 다시 시도하세요.');
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

  it('ok 없이 error 와 unsupported 가 섞이면 exit 4 다 — 재시도 가능한 실패를 3으로 숨기지 않는다', () => {
    expect(
      exitFor({
        ...base,
        registries: [
          { registry: 'ctgov', status: 'error', error: { code: 'upstream', message: 'boom' } },
          { registry: 'ctgov', status: 'unsupported', error: { code: 'unsupported', message: 'no geo' } },
        ],
      }),
    ).toBe(EXIT.UPSTREAM);
  });
});
