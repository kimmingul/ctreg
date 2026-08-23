import { describe, expect, it } from 'vitest';
import { parseCliArgs, USAGE } from '../../src/cli/args.js';
import { CAPS } from '../../src/core/query.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { CtregError } from '../../src/runtime/errors.js';
import { FILTERABLE_PHASE, FILTERABLE_STATUS, FILTERABLE_STUDY_TYPE } from '../../src/core/vocab.js';

const expectUsage = (fn: () => unknown, hintFragment?: string) => {
  try {
    fn();
    expect.unreachable('던져야 한다');
  } catch (e) {
    expect((e as CtregError).exit).toBe(EXIT.USAGE);
    if (hintFragment) expect(`${(e as CtregError).hint} ${(e as CtregError).message}`).toContain(hintFragment);
  }
};

describe('인자 파싱', () => {
  it('커맨드와 검색 축을 읽는다', () => {
    const a = parseCliArgs(['search', '--condition', 'NSCLC', '--lead', 'Merck']);
    expect(a.command).toBe('search');
    expect(a.query.condition).toBe('NSCLC');
    expect(a.query.lead).toBe('Merck');
  });

  it('폐쇄 어휘 값을 검증한다', () => {
    expect(parseCliArgs(['search', '--status', 'recruiting']).query.status).toEqual(['recruiting']);
    expectUsage(() => parseCliArgs(['search', '--status', 'RECRUITING']), 'recruiting');
    expectUsage(() => parseCliArgs(['search', '--status', 'unknown']));
  });

  it('상태와 phase 는 반복 지정할 수 있다', () => {
    const a = parseCliArgs(['search', '--status', 'recruiting', '--status', 'completed']);
    expect(a.query.status).toEqual(['recruiting', 'completed']);
  });

  it('phase 도 other 를 거부한다 — status 와 같은 형식의 힌트를 낸다', () => {
    expectUsage(() => parseCliArgs(['search', '--phase', 'other']), 'phase_3');
  });

  it('study-type 도 other 를 거부한다 — other 는 매핑 결과이지 필터 입력이 아니다', () => {
    expect(parseCliArgs(['search', '--study-type', 'interventional']).query.studyType).toBe('interventional');
    expectUsage(() => parseCliArgs(['search', '--study-type', 'other']), 'interventional');
    expectUsage(() => parseCliArgs(['search', '--study-type', 'bogus']));
  });

  it('--near 는 좌표만 받는다 — 지명은 exit 2', () => {
    expect(parseCliArgs(['search', '--near', '37.5665,126.978']).query.near).toEqual({ lat: 37.5665, lon: 126.978 });
    expectUsage(() => parseCliArgs(['search', '--near', 'Seoul']), '좌표');
  });

  it('--radius 는 단위를 요구한다 — 접미사가 없으면 업스트림이 미터로 읽는다', () => {
    expect(parseCliArgs(['search', '--near', '37.5,127.0', '--radius', '100km']).query.radius)
      .toEqual({ value: 100, unit: 'km' });
    expectUsage(() => parseCliArgs(['search', '--near', '37.5,127.0', '--radius', '100']), 'km');
  });

  it('--radius 만 있으면 exit 2 다', () => {
    expectUsage(() => parseCliArgs(['search', '--radius', '100km']), '--near');
  });

  /**
   * I2 회귀. `--location` 을 파싱해 `query.location` 에 담는 것과 매퍼가 읽는
   * `fetch.locationTerm` 으로 실어 보내는 것은 다른 자리다 — 후자를 빼먹어도
   * `query.location` 쪽 검사만으로는 안 걸린다. F1(`--location Seoul` 로 걸린 시험의
   * 근거 장소가 응답에 남는지)의 유일한 CLI 이음매가 이 배선이므로, 값이 실린다는
   * 것과 없으면 키 자체가 없다(absent-means-absent)는 것을 둘 다 못박는다.
   */
  it('--location 은 fetch.locationTerm 으로 실려 매퍼까지 간다', () => {
    expect(parseCliArgs(['search', '--location', 'Seoul']).fetch.locationTerm).toBe('Seoul');
    expect(parseCliArgs(['search']).fetch).not.toHaveProperty('locationTerm');
  });

  it('--include 는 알려진 섹션만 받는다', () => {
    expect(parseCliArgs(['search', '--include', 'eligibility']).fetch.include).toContain('eligibility');
    expectUsage(() => parseCliArgs(['search', '--include', 'everything']));
  });

  it('--eligibility-chars 는 --include eligibility 를 요구하고 상한이 있다', () => {
    expectUsage(() => parseCliArgs(['search', '--eligibility-chars', '100']), '--include eligibility');
    expect(parseCliArgs(['search', '--include', 'eligibility', '--eligibility-chars', '100']).fetch.caps.eligibilityChars).toBe(100);
    expectUsage(() => parseCliArgs(['search', '--include', 'eligibility', '--eligibility-chars', '999999']));
  });

  it('--include locations/outcomes 는 해당 캡을 최대치로 올린다 (§5.2) — 정책은 CLI 가 정한다', () => {
    const noInclude = parseCliArgs(['search']);
    expect(noInclude.fetch.caps.locations).toBe(CAPS.locations.default);
    expect(noInclude.fetch.caps.outcomes).toBe(CAPS.outcomes.default);

    const withLocations = parseCliArgs(['search', '--include', 'locations']);
    expect(withLocations.fetch.caps.locations).toBe(CAPS.locations.max);
    expect(withLocations.fetch.caps.outcomes).toBe(CAPS.outcomes.default);

    const withOutcomes = parseCliArgs(['search', '--include', 'outcomes']);
    expect(withOutcomes.fetch.caps.outcomes).toBe(CAPS.outcomes.max);
    expect(withOutcomes.fetch.caps.locations).toBe(CAPS.locations.default);

    const withAll = parseCliArgs(['search', '--include', 'all']);
    expect(withAll.fetch.caps.locations).toBe(CAPS.locations.max);
    expect(withAll.fetch.caps.outcomes).toBe(CAPS.outcomes.max);
  });

  it('--no-cache 와 --refresh 는 캐시 모드를 바꾼다', () => {
    expect(parseCliArgs(['search']).fetch.cacheMode).toBe('use');
    expect(parseCliArgs(['search', '--no-cache']).fetch.cacheMode).toBe('off');
    expect(parseCliArgs(['search', '--refresh']).fetch.cacheMode).toBe('refresh');
    expectUsage(() => parseCliArgs(['search', '--no-cache', '--refresh']));
  });

  it('--format 은 세 값만 받는다', () => {
    expect(parseCliArgs(['search']).format).toBe('json');
    expectUsage(() => parseCliArgs(['search', '--format', 'yaml']));
  });

  it('--registry 는 등록된 키만 받는다', () => {
    expect(parseCliArgs(['search']).registries).toEqual(['ctgov']);
    expectUsage(() => parseCliArgs(['search', '--registry', 'ictrp']), 'ctreg registries');
  });

  // 중복을 그대로 두면 모든 네트워크 커맨드가 같은 레지스트리를 두 번 돈다.
  // count 는 정확히 진실의 2배인 수를 경고 없이 사실로 내놓고(리뷰 I4 에서 실측:
  // 245,472 vs 실제 122,736), search 는 같은 레코드를 두 번 내며, registries[] 는
  // "레지스트리마다 항목 하나" 라는 봉투의 암묵적 형태 규칙을 깬다.
  it('--registry 중복은 합쳐진다 — 같은 레지스트리를 두 번 돌지 않는다', () => {
    expect(parseCliArgs(['count', '--registry', 'ctgov', '--registry', 'ctgov']).registries)
      .toEqual(['ctgov']);
  });

  it('results 커맨드의 필터를 읽는다', () => {
    const a = parseCliArgs(['results', 'CTGOV:NCT01234567', '--outcome', 'PFS', '--ae-organ', 'cardiac', '--section', 'outcomes']);
    expect(a.positionals).toEqual(['CTGOV:NCT01234567']);
    expect(a.results.outcomeFilter).toEqual(['PFS']);
    expect(a.results.aeOrganFilter).toBe('cardiac');
    expect(a.results.sections).toEqual(['outcomes']);
  });

  it('모르는 플래그는 조용히 무시하지 않고 exit 2 다', () => {
    expectUsage(() => parseCliArgs(['search', '--bogus', 'x']));
  });

  it('커맨드가 없거나 모르는 커맨드면 exit 2 다', () => {
    expectUsage(() => parseCliArgs([]));
    expectUsage(() => parseCliArgs(['landscape']), 'search');
  });
});

describe('--help 는 값 어휘를 적는다', () => {
  /**
   * F9. 세 시나리오가 `--status` 에 대문자를, `--phase` 에 틀린 값을 넣어 거부당했고
   * **셋 다 같은 힌트**를 받았다. --help 가 값을 적지 않아 틀려 봐야만 알 수 있었다.
   * 목록을 어휘에서 파생해 적으면 어휘가 늘어도 --help 가 저절로 따라간다.
   */
  it('세 닫힌 어휘의 값을 전부 적는다', () => {
    for (const v of FILTERABLE_STATUS) expect(USAGE, `--status 값 '${v}' 가 --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_PHASE) expect(USAGE, `--phase 값 '${v}' 가 --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_STUDY_TYPE) expect(USAGE, `--study-type 값 '${v}' 가 --help 에 없습니다`).toContain(v);
  });

  /**
   * --help 는 **이 CLI 가 받는 값**을, registries 는 **각 레지스트리가 그 값으로
   * 무엇을 하는가**를 말한다. 여기서 레지스트리별 차이까지 적으면 같은 사실이 두
   * 곳에 살게 되고, 이 저장소에서 그렇게 했다가 한쪽만 갱신된 사고가 이미 두 번 있었다.
   */
  it('레지스트리별 차이는 적지 않고 registries 로 보낸다', () => {
    expect(USAGE).toContain('ctreg registries');
  });
});
