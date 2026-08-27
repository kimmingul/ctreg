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

/**
 * 실측 2026-08-28: `get <ID> --include all --format text` 가 `--include core` 와
 * **글자 하나 다르지 않은 출력** 을 냈다. 적격 기준·결과지표·연락처를 받아 오고도
 * 화면에는 ID·상태·제목뿐이었고, 무엇이 빠졌다는 신호도 없었다. 심지어
 * `eligibility_truncated` 경고는 나왔다 — 사용자가 본 적 없는 것이 잘렸다는 경고다.
 *
 * 요청한 것이 조용히 사라지는 부류라 고친다. 텍스트는 사람이 읽는 형식이므로 JSON 을
 * 그대로 쏟지 않고, **레코드에 실제로 있는 것만** 한 줄씩 낸다.
 */
describe('text 는 받아 온 것을 버리지 않는다', () => {
  const rich: Envelope = {
    query: { ids: ['CTGOV:NCT1'] },
    registries: [{ registry: 'ctgov', status: 'ok', returned: 1 }],
    warnings: [],
    data: [
      {
        id: 'CTGOV:NCT1',
        title: '어떤 시험',
        status: 'recruiting',
        phase: ['phase_2'],
        studyType: 'interventional',
        conditions: ['폐암', '고형암'],
        interventions: [{ type: 'DRUG', name: '약물 A' }],
        sponsor: { lead: '어떤 기관' },
        enrollment: { count: 22, basis: 'actual' },
        dates: { start: '2020-03-16', completion: '2027-01-01' },
        locations: [{ facility: '어떤 병원', city: '서울', country: 'Korea, Republic of' }],
        locationsTotal: 11,
        eligibility: { minAge: '18 Years', sex: 'all', criteriaText: '포함기준: 만 18세 이상', criteriaTruncated: true },
        outcomes: [{ type: 'primary', measure: '전체생존', timeFrame: '5년' }],
        outcomesTotal: 9,
        url: 'https://example.org/NCT1',
      },
    ],
  };

  const out = () => render(rich, 'text');

  it('핵심 필드를 화면에 낸다', () => {
    const t = out();
    for (const must of ['어떤 시험', 'recruiting', 'phase_2', '폐암', '약물 A', '어떤 기관']) {
      expect(t, `'${must}' 가 텍스트 출력에 없습니다`).toContain(must);
    }
  });

  it('--include 로 받아 온 섹션도 낸다', () => {
    const t = out();
    expect(t).toContain('18 Years');
    expect(t).toContain('전체생존');
  });

  /**
   * 잘렸다는 경고(`eligibility_truncated`)는 나오는데 정작 그 기준문이 화면에 없으면,
   * 사용자는 **본 적 없는 것이 잘렸다는 경고** 를 읽는다. 둘 중 하나는 고쳐야 한다.
   */
  it('적격 기준문을 내고, 잘렸으면 잘렸다고 표시한다', () => {
    const t = out();
    expect(t).toContain('포함기준: 만 18세 이상');
    expect(t).toMatch(/잘림|…/);
  });

  it('전체 중 일부만 실었다는 사실을 숨기지 않는다', () => {
    const t = out();
    // 기관 11곳 중 1곳, 결과지표 9개 중 1개만 실려 있다. 목록만 보여주면 그것이 전부로 읽힌다.
    expect(t).toContain('11');
    expect(t).toContain('9');
  });

  it('없는 필드는 빈 줄이나 undefined 로 새지 않는다', () => {
    const bare: Envelope = { ...rich, data: [{ id: 'CTGOV:NCT2', title: '제목만', status: 'completed' }] };
    const t = render(bare, 'text');
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('null');
    expect(t).toContain('제목만');
  });

  it('JSON 을 그대로 쏟지 않는다 — 사람이 읽는 형식이다', () => {
    expect(out()).not.toContain('"locationsTotal"');
  });
});
