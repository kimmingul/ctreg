import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapTrial } from '../../../src/adapters/isrctn/map.js';
import { parseIsrctnXml } from '../../../src/adapters/isrctn/xml.js';
import { CAPS, type FetchOpts } from '../../../src/core/query.js';
import { TrialRecordSchema } from '../../../src/core/record.js';

const xml = readFileSync(join(__dirname, '../../fixtures/isrctn/search-who.xml'), 'utf8');
const trials = (parseIsrctnXml(xml) as { trials: { trial: Record<string, any>[] } }).trials.trial;
const byId = (id: string) => trials.find((t) => t.main.trial_id === id)!;

const opts = (over: Partial<FetchOpts> = {}): FetchOpts => ({
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off',
  raw: false,
  ...over,
});

const FETCHED = '2026-08-23T00:00:00.000Z';
const map = (id: string, o: FetchOpts = opts()) => mapTrial(byId(id), o, FETCHED);

describe('ISRCTN 매퍼 — core', () => {
  it('계약을 지키는 레코드를 낸다', () => {
    const { record } = map('ISRCTN64724266');
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
    expect(record.id).toBe('ISRCTN:ISRCTN64724266');
    expect(record.registry).toBe('isrctn');
    expect(record.registryId).toBe('ISRCTN64724266');
    expect(record.url).toBe('https://www.isrctn.com/ISRCTN64724266');
  });

  it('제목 두 종류를 각자의 자리에 넣는다', () => {
    const { record } = map('ISRCTN64724266');
    expect(record.title.length).toBeGreaterThan(0);
    expect(record.officialTitle).not.toBe(record.title);
  });

  it('상태·단계·연구유형을 어휘로 접고 원문을 남긴다', () => {
    const { record } = map('ISRCTN30583116');
    expect(record.status).toBe('recruiting');
    expect(record.statusRaw).toBe('Recruiting');
    expect(record.studyType).toBe('observational');
    expect(record.phase).toEqual(['na']);
  });

  /**
   * 'No longer recruiting' 은 정의가 모호해 `other` 로 둔다(vocab.ts 참고). 여기서
   * 확인하는 것은 그 판단이 매퍼를 통과해 실제 레코드까지 온다는 것이다 — 어휘 테이블만
   * 고쳐 놓고 매퍼가 다른 경로로 상태를 만들면 그 판단이 무의미해진다.
   */
  it('모호한 상태는 other 로 오되 원문이 살아 있다', () => {
    const { record } = map('ISRCTN16053507');
    expect(record.status).toBe('other');
    expect(record.statusRaw).toBe('No longer recruiting');
  });

  it('날짜를 DD/MM/YYYY 에서 ISO 로 옮긴다 — 월과 일을 뒤집지 않는다', () => {
    const { record } = map('ISRCTN64724266');
    // 원문 date_enrolment = 01/05/2012 → 2012년 5월 1일이지 1월 5일이 아니다.
    expect(record.dates?.start).toBe('2012-05-01');
  });

  it('조건과 중재를 배열로 담는다', () => {
    const { record } = map('ISRCTN64724266');
    expect(record.conditions.length).toBeGreaterThan(0);
    expect(record.interventions?.[0]?.name.length).toBeGreaterThan(0);
  });

  it('스폰서를 lead 에 넣는다', () => {
    const { record } = map('ISRCTN30583116');
    expect(record.sponsor?.lead).toBe('University of Birmingham');
  });

  /**
   * ctgov 쪽에서 실제로 물었던 버그와 같은 자리다 — 이름 없는 협력사를 그대로 실으면
   * `string[]` 에 undefined 가 섞여 레코드가 계약을 어기고, 그 시험이 결과에서 통째로
   * 사라진다. WHO 포맷은 `<sponsor_name/>` 을 값 없이 남기므로 여기가 늘 밟히는 경로다.
   */
  it('이름 없는 공동 스폰서를 실어 레코드를 죽이지 않는다', () => {
    const { record } = map('ISRCTN64724266'); // 픽스처의 secondary_sponsor 가 비어 있다
    expect(record.sponsor).not.toHaveProperty('collaborators');
    expect(() => TrialRecordSchema.parse(record)).not.toThrow();
  });

  it('crossIds 를 secondary_ids 에서 가져온다', () => {
    const { record } = map('ISRCTN64724266');
    expect(record.crossIds).toEqual([
      expect.objectContaining({ id: '11/LO/1712', registry: 'Protocol serial number' }),
    ]);
  });
});

describe('ISRCTN 매퍼 — 등록 인원', () => {
  /**
   * 조사에서 나온 가장 위험한 함정이다. ISRCTN 은 진행 중인 시험의
   * `results_actual_enrolment` 를 **0 으로 채운다** — "0명 등록" 이 아니라 "아직 모름"
   * 이다. 이걸 `{ count: 0, basis: 'actual' }` 로 실으면 모집 중인 시험이 "0명 등록"
   * 으로 보고된다. 부재는 부재로 둔다.
   */
  it('실제 등록 인원이 0 이면 실제값으로 싣지 않는다 — 0 은 "아직 모름" 이다', () => {
    const { record } = map('ISRCTN30583116'); // results_actual_enrolment = 0
    expect(record.enrollment).toEqual({ count: 1017, basis: 'estimated' });
  });

  it('실제 등록 인원이 0 이 아니면 실제값으로 싣는다', () => {
    const { record } = map('ISRCTN64724266'); // results_actual_enrolment = 262
    expect(record.enrollment).toEqual({ count: 262, basis: 'actual' });
  });
});

describe('ISRCTN 매퍼 — 결과 유무', () => {
  it('결과 링크가 있으면 hasResults 다', () => {
    expect(map('ISRCTN64724266').record.hasResults).toBe(true);
  });

  /**
   * `results_actual_enrolment` 와 `results_date_completed` 는 이름이 results 로 시작하지만
   * 결과 게시 여부와 무관하다 — 진행 중인 시험도 종료 예정일을 갖는다. 이 둘을 신호로
   * 삼으면 결과가 없는 시험 대부분이 hasResults 로 나온다.
   */
  it('종료일이나 등록 인원만으로는 hasResults 가 되지 않는다', () => {
    expect(map('ISRCTN30583116').record.hasResults).toBe(false);
  });
});

describe('ISRCTN 매퍼 — 장소', () => {
  it('모집 국가를 국가 단위 장소로 담는다', () => {
    const { record } = map('ISRCTN64724266');
    expect(record.locations).toEqual([
      { country: 'United Kingdom' },
      { country: 'England' },
      { country: 'Wales' },
    ]);
    expect(record.locationsTotal).toBe(3);
  });

  it('캡을 넘으면 자르고 locations_truncated 경고를 남긴다', () => {
    const { record, warnings } = map('ISRCTN64724266', opts({ caps: { ...opts().caps, locations: 1 } }));
    expect(record.locations).toHaveLength(1);
    expect(record.locationsTotal).toBe(3);
    expect(warnings).toEqual([expect.objectContaining({ code: 'locations_truncated', at: 1 })]);
  });
});

describe('ISRCTN 매퍼 — detail 섹션은 옵트인이다', () => {
  it('--include 없이는 적격·결과지표·연락처를 담지 않는다', () => {
    const { record } = map('ISRCTN64724266');
    expect(record.eligibility).toBeUndefined();
    expect(record.outcomes).toBeUndefined();
    expect(record.contacts).toBeUndefined();
  });

  it('eligibility 를 요청하면 포함·제외 기준을 하나의 본문으로 합친다', () => {
    const { record } = map('ISRCTN64724266', opts({ include: ['core', 'eligibility'] }));
    expect(record.eligibility?.criteriaText).toContain('Positive faecal occult blood test');
    expect(record.eligibility?.criteriaText).toContain('Contraindications to colonoscopy');
    expect(record.eligibility?.minAge).toBe('18 Years');
    expect(record.eligibility?.sex).toBe('all');
  });

  it('적격 본문이 캡을 넘으면 자르고 경고를 남긴다', () => {
    const o = opts({ include: ['core', 'eligibility'], caps: { ...opts().caps, eligibilityChars: 20 } });
    const { record, warnings } = map('ISRCTN64724266', o);
    expect(record.eligibility?.criteriaText).toHaveLength(20);
    expect(record.eligibility?.criteriaTruncated).toBe(true);
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'eligibility_truncated' })]));
  });

  it('outcomes 를 요청하면 1차·2차를 구분해 담는다', () => {
    const { record } = map('ISRCTN64724266', opts({ include: ['core', 'outcomes'] }));
    expect(record.outcomes?.map((o) => o.type)).toEqual(['primary', 'secondary']);
    expect(record.outcomesTotal).toBe(2);
  });

  it('contacts 를 요청하면 이름이 있는 연락처만 담는다', () => {
    const { record } = map('ISRCTN64724266', opts({ include: ['core', 'contacts'] }));
    expect(record.contacts).toEqual([
      expect.objectContaining({ name: 'Matthew Banks', role: 'Scientific', email: 'matthew.banks2@nhs.net' }),
    ]);
  });
});

describe('ISRCTN 매퍼 — 원문과 오류', () => {
  it('--raw 면 이 시험의 원문 트리를 통째로 싣는다', () => {
    const { record } = map('ISRCTN64724266', opts({ raw: true }));
    expect(record.source).toEqual(byId('ISRCTN64724266'));
  });

  it('--raw 가 아니면 source 를 만들지 않는다', () => {
    expect(map('ISRCTN64724266').record.source).toBeUndefined();
  });

  /**
   * ctgov 매퍼가 nctId 없는 study 에 대해 던지는 것과 같은 이유다 — id 를 못 만들면
   * `ISRCTN:undefined` 같은 레코드를 조작해 내느니 이 시험 하나를 경고로 격하시켜
   * 건너뛰는 편이 낫고, 그 판단은 어댑터가 한다.
   */
  it('trial_id 가 없으면 조작된 레코드를 만들지 않고 던진다', () => {
    expect(() => mapTrial({ main: { public_title: 'x' } }, opts(), FETCHED)).toThrow();
  });
});
