import { describe, expect, it } from 'vitest';
import { COMMAND_OPTIONS, COMMANDS, helpFor, OPTION_NAMES, parseCliArgs, USAGE } from '../../src/cli/args.js';
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

/**
 * F4. 실측(2026-08-25): `get CTGOV:NCT04280705 --page-size 5 --sort x` 가 **exit 0** 으로
 * 끝났고 그 플래그들에 대한 말이 아무 데도 없었다. `get` 은 배치 조회라 페이지도 정렬도
 * 없는데, 사용자가 그것을 준 것은 **먹힌다고 믿는다** 는 뜻이다. 필드 테스트에서
 * 에이전트가 해보지도 않은 페이지네이션을 사용자에게 권한 유인이 여기다(F4·A2).
 *
 * 경고가 아니라 exit 2 인 이유: 조용히 무시하지 않는 것이 이 도구의 축이고, `ParsedArgs`
 * 에는 경고를 실어 보낼 자리가 아직 없다(정본의 이연 항목이 같은 이유로 열려 있다).
 *
 * 보수적으로 잡는다 — 커맨드가 **원리상 못 쓰는** 것만 거절한다. `count --page-size` 는
 * `applyLimits` 가 일부러 적용하고 있어(레지스트리 순서에 따라 갈리지 않게) 건드리지 않는다.
 */
describe('커맨드가 못 쓰는 플래그', () => {
  it('get 은 페이지·정렬을 받지 않는다 — 배치 조회에는 그런 것이 없다', () => {
    expectUsage(() => parseCliArgs(['get', 'CTGOV:NCT00000001', '--page-size', '5']), '--page-size');
    expectUsage(() => parseCliArgs(['get', 'CTGOV:NCT00000001', '--page-token', 't']), '--page-token');
    expectUsage(() => parseCliArgs(['get', 'CTGOV:NCT00000001', '--sort', 'x']), '--sort');
  });

  it('거절할 때 그 커맨드가 무엇을 받는지 말한다 — 막기만 하면 F4 를 반복한다', () => {
    try {
      parseCliArgs(['get', 'CTGOV:NCT00000001', '--sort', 'x']);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const text = `${(e as CtregError).message} ${(e as CtregError).hint}`;
      expect(text).toContain('get');
      expect(text).toContain('--include'); // get 이 실제로 받는 것
    }
  });

  it('registries 는 조회 축을 받지 않는다', () => {
    expectUsage(() => parseCliArgs(['registries', '--condition', 'X']), '--condition');
  });

  it('results 는 검색 축을 받지 않는다 — ID 하나로 부르는 커맨드다', () => {
    expectUsage(() => parseCliArgs(['results', 'CTGOV:NCT00000001', '--condition', 'X']), '--condition');
  });

  it('각 커맨드가 자기 것은 그대로 받는다 — 거절이 넘치면 도구가 못 쓰게 된다', () => {
    expect(() => parseCliArgs(['search', '--condition', 'X', '--page-size', '5', '--sort', 'x'])).not.toThrow();
    expect(() => parseCliArgs(['count', '--condition', 'X', '--page-size', '5'])).not.toThrow();
    expect(() => parseCliArgs(['get', 'CTGOV:NCT00000001', '--include', 'all', '--raw'])).not.toThrow();
    expect(() => parseCliArgs(['results', 'CTGOV:NCT00000001', '--section', 'flow', '--full'])).not.toThrow();
    expect(() => parseCliArgs(['registries', '--registry', 'ctgov', '--format', 'text'])).not.toThrow();
  });

  /**
   * 표가 옵션을 하나라도 빠뜨리면 그 옵션은 **모든 커맨드에서** 거절된다 — 조용한
   * 무시를 고치려다 멀쩡한 플래그를 죽이는 정반대 결함이 된다. 이름을 손으로 두 번
   * 적는 표라 타입이 이것을 강제하지 못한다.
   */
  it('모든 옵션이 적어도 한 커맨드에는 속한다', () => {
    const covered = new Set(Object.values(COMMAND_OPTIONS).flat());
    expect(OPTION_NAMES.filter((o) => !covered.has(o))).toEqual([]);
  });
});

/**
 * F3. 서브커맨드별 `--help` 가 없어 최상위와 바이트 단위로 동일했다 — 세 시나리오가
 * 부딪혔다. `--help` 가 커맨드 단어를 버리고 `registries` 로 바꿔치기하고 있었던 것이
 * 원인이다.
 *
 * F4 와 **같은 표** 를 읽는다. 커맨드가 무엇을 받는지 두 곳에 적으면 한쪽만 갱신된다.
 */
describe('커맨드별 --help', () => {
  it('커맨드와 함께 주면 그 커맨드를 기억한다 — 예전에는 registries 로 바뀌었다', () => {
    const a = parseCliArgs(['get', '--help']);
    expect(a.help).toBe(true);
    expect(a.command).toBe('get');
  });

  it('커맨드 없이 주면 전체 사용법이다', () => {
    const a = parseCliArgs(['--help']);
    expect(a.help).toBe(true);
    expect(a.command).toBeUndefined();
  });

  it('그 커맨드가 받는 것만 적는다 — 표가 정본이다', () => {
    const text = helpFor('get');
    for (const o of COMMAND_OPTIONS.get) expect(text, `--${o} 이 없습니다`).toContain(`--${o}`);
    // get 이 안 받는 것은 나오지 않는다. 이것이 F3 의 요점이다 — 최상위 사용법을
    // 그대로 내면 서브커맨드 전용 표면을 확인할 방법이 여전히 없다.
    for (const o of ['sort', 'page-size', 'condition']) expect(text).not.toContain(`--${o}`);
  });

  it('다섯 커맨드 전부 자기 사용법을 낸다', () => {
    for (const c of COMMANDS) {
      const text = helpFor(c);
      expect(text, `'${c}' 의 사용법이 커맨드 이름을 안 적습니다`).toContain(c);
    }
  });

  it('--help 는 어느 커맨드에서도 거절되지 않는다', () => {
    for (const c of COMMANDS) expect(() => parseCliArgs([c, '--help'])).not.toThrow();
  });
});

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
    // 'ictrp' 는 이제 등록된 키라 미등록 프로브로 못 쓴다 — 레지스트리 이름이 될 리
    // 없는 문자열을 쓴다(registry.test.ts 의 같은 결정 참고).
    expectUsage(() => parseCliArgs(['search', '--registry', 'nosuchreg']), 'ctreg registries');
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
   *
   * 문자열 부분일치(`toContain`)로는 안 된다 — 단어 경계가 없어서 `na` 를
   * 목록에서 통째로 지워도 `terminated` 안의 "na" 에 걸려 통과해 버린다
   * (`phase_1` 도 `early_phase_1` 안에, `recruiting` 도 `not_yet_recruiting`
   * 안에 숨는다). `[a-z0-9_]` 가 아닌 문자로 잘라 토큰 배열을 만들고 그
   * 배열에 값이 원소로 있는지를 본다 — 줄바꿈 위치가 바뀌어도 토큰 경계는
   * 그대로라 안전하다.
   */
  it('세 닫힌 어휘의 값을 전부 적는다', () => {
    const tokens = USAGE.split(/[^a-z0-9_]+/);
    for (const v of FILTERABLE_STATUS) expect(tokens, `--status 값 '${v}' 가 --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_PHASE) expect(tokens, `--phase 값 '${v}' 가 --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_STUDY_TYPE) expect(tokens, `--study-type 값 '${v}' 가 --help 에 없습니다`).toContain(v);
  });

  /**
   * --help 는 **이 CLI 가 받는 값**을, registries 는 **각 레지스트리가 그 값으로
   * 무엇을 하는가**를 말한다. 여기서 레지스트리별 차이까지 적으면 같은 사실이 두
   * 곳에 살게 되고, 이 저장소에서 그렇게 했다가 한쪽만 갱신된 사고가 이미 두 번 있었다.
   */
  it('레지스트리별 차이는 적지 않고 registries 로 보낸다', () => {
    expect(USAGE).toContain('ctreg registries');
  });

  /**
   * **커맨드별 사용법에도 값이 있어야 한다.** F5·F9 를 닫은 것이 "`--help` 가 값 어휘를
   * 적는다" 인데, 위 검사는 `USAGE` 상수만 본다 — 서브커맨드별 `--help`(F3)가 생기면서
   * 사용자가 가장 자주 밟는 경로(`ctreg search --help`)에서 값이 사라져도 스위트는
   * 침묵했다. 실제로 그렇게 회귀했고 실물을 돌려 보고서야 드러났다.
   *
   * 위와 같은 이유로 토큰 경계를 쓴다(`na` 가 `terminated` 안에 숨는다).
   */
  it('그 커맨드가 어휘 축을 받으면 커맨드별 --help 에도 값이 있다', () => {
    const tokens = helpFor('search').split(/[^a-z0-9_]+/);
    for (const v of FILTERABLE_STATUS) expect(tokens, `--status 값 '${v}' 가 search --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_PHASE) expect(tokens, `--phase 값 '${v}' 가 search --help 에 없습니다`).toContain(v);
    for (const v of FILTERABLE_STUDY_TYPE) expect(tokens, `--study-type 값 '${v}' 가 search --help 에 없습니다`).toContain(v);
    // count 도 같은 축을 받는다.
    expect(helpFor('count')).toContain(FILTERABLE_PHASE[0]!);
  });

  it('그 축을 안 받는 커맨드에는 값도 적지 않는다 — 받지 않는 것을 적으면 F3 이 도로 열린다', () => {
    // 세 축을 전부 본다. 한 축만 보면 나머지 두 축이 새어도 통과한다 — 사보타주로
    // 확인했다(`status` 만 항상 적게 만들어도 phase 만 보는 검사는 침묵했다).
    for (const c of ['get', 'results', 'registries'] as const) {
      const text = helpFor(c);
      for (const v of [...FILTERABLE_STATUS, ...FILTERABLE_PHASE, ...FILTERABLE_STUDY_TYPE]) {
        expect(text, `'${c}' 사용법에 쓰지도 않는 값 '${v}' 가 있습니다`).not.toContain(v);
      }
    }
  });
});

/**
 * 실측 2026-08-28: 날짜 옵션에 검증이 전혀 없었다. 모양만 맞으면 달력에 없는 날도
 * 그대로 레지스트리에 실려 나갔고, **그 결과가 조용히 틀렸다**.
 *
 *   --updated-since 2026-02-30  → ctgov 가 2,596 건을 내고 exit 0. 2월 30일은 없다.
 *   --updated-since 2026-13-45  → 0 건, exit 0. 오타 하나가 "그런 시험이 없다" 가 된다.
 *
 * 둘 다 이 CLI 가 없애려는 실패 그 자체다. 날짜는 사용자가 손으로 치는 값이고 오타가
 * 흔하므로, 레지스트리에 보내기 전에 여기서 막는다.
 */
describe('날짜 옵션은 달력에 있는 날만 받는다', () => {
  const DATE_OPTS = [
    '--updated-since', '--updated-before',
    '--start-after', '--start-before',
    '--completion-after', '--completion-before',
  ];

  it('제대로 된 날짜는 그대로 통과한다', () => {
    const a = parseCliArgs(['search', '--updated-since', '2026-02-28', '--start-before', '2024-02-29']);
    expect(a.query.updatedSince).toBe('2026-02-28');
    // 2024 는 윤년이다 — 2월 29일이 있다.
    expect(a.query.startBefore).toBe('2024-02-29');
  });

  it('달력에 없는 날은 여섯 옵션 모두에서 사용법 오류다', () => {
    for (const opt of DATE_OPTS) {
      expectUsage(() => parseCliArgs(['search', opt, '2026-02-30']), opt);
      expectUsage(() => parseCliArgs(['search', opt, '2026-13-45']), opt);
      // 2026 은 윤년이 아니다.
      expectUsage(() => parseCliArgs(['search', opt, '2026-02-29']), opt);
    }
  });

  it('모양이 어긋난 값도 사용법 오류다 — 업스트림까지 가지 않는다', () => {
    for (const bad of ['2026-1-1', '20260101', 'abc', '2026-01-01T00:00:00Z', '']) {
      expectUsage(() => parseCliArgs(['search', '--updated-since', bad]));
    }
  });
});

/**
 * 실측 2026-08-28: `--near` 에 두 결함이 있었다.
 *
 * 1. **범위를 보지 않았다.** `--near 91,181` 은 지구에 없는 좌표인데 그대로 실려 나가
 *    ctgov 가 400 을 냈다 — exit 4. 사용자의 오타가 "레지스트리 장애" 로 보고됐다.
 * 2. **남반구를 쓸 수 없었다.** `--near -33.8,151.2`(시드니)가 Node parseArgs 의
 *    "argument is ambiguous" 로 죽었다. 값이 대시로 시작하면 옵션으로 보이기 때문인데,
 *    그 안내가 영어 원문이고 해법(`--near=-33.8,151.2`)은 이 CLI 의 사용법 어디에도
 *    없었다. 시드니·상파울루·부에노스아이레스·케이프타운이 다 여기 걸린다.
 */
describe('--near 는 지구에 있는 좌표만 받는다', () => {
  it('정상 좌표는 통과한다 — 음수 경도 포함', () => {
    expect(parseCliArgs(['search', '--near', '37.5,127.0']).query.near).toEqual({ lat: 37.5, lon: 127.0 });
    // 뉴욕. 경도가 음수인 것은 값이 대시로 시작하지 않으므로 원래도 됐다.
    expect(parseCliArgs(['search', '--near', '40.7,-74.0']).query.near).toEqual({ lat: 40.7, lon: -74.0 });
    // 남반구는 `--near=` 형태로 줘야 파서를 통과한다.
    expect(parseCliArgs(['search', '--near=-33.8,151.2']).query.near).toEqual({ lat: -33.8, lon: 151.2 });
  });

  it('범위를 벗어난 좌표는 사용법 오류다 — 업스트림까지 가지 않는다', () => {
    for (const bad of ['91,0', '-91,0', '0,181', '0,-181', '90.1,0']) {
      expectUsage(() => parseCliArgs(['search', `--near=${bad}`]), '--near');
    }
  });

  it('경계값은 받는다', () => {
    expect(parseCliArgs(['search', '--near=90,180']).query.near).toEqual({ lat: 90, lon: 180 });
    expect(parseCliArgs(['search', '--near=-90,-180']).query.near).toEqual({ lat: -90, lon: -180 });
  });

  it('대시로 시작하는 값이 막히면 한국어로 해법을 알려 준다', () => {
    try {
      parseCliArgs(['search', '--near', '-33.8,151.2']);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as CtregError;
      expect(err.exit).toBe(EXIT.USAGE);
      // 영어 원문만 던지고 끝나면 사용자는 무엇을 해야 할지 모른다.
      expect(`${err.message} ${err.hint ?? ''}`).toContain('--near=-33.8,151.2');
    }
  });
});

/**
 * 실측 2026-08-28: `--radius 0km` 이 ctgov 에서 500 을 냈고, `runtime/http.ts` 가 그것을
 * **세 번 재시도** 한 뒤 exit 4 로 끝났다. 반경 0 은 사용자가 고쳐야 하는 입력이지
 * 레지스트리 장애가 아니다 — 재시도는 그 시간만큼 사용자를 기다리게 하고 업스트림에
 * 부담을 준다. 좌표·날짜와 같은 이유로 보내기 전에 막는다.
 *
 * 음수는 파서가 이미 막지만 문구가 "단위가 필요합니다" 였다 — 단위는 있었고 부호가
 * 문제였다. 틀린 진단은 없는 것보다 나쁘다.
 */
describe('--radius 는 양수여야 한다', () => {
  it('0 은 사용법 오류다 — 업스트림을 재시도로 두들기지 않는다', () => {
    expectUsage(() => parseCliArgs(['search', '--near=37.5,127.0', '--radius', '0km']), '--radius');
    expectUsage(() => parseCliArgs(['search', '--near=37.5,127.0', '--radius', '0mi']), '--radius');
    expectUsage(() => parseCliArgs(['search', '--near=37.5,127.0', '--radius', '0.0km']), '--radius');
  });

  it('음수는 단위 탓으로 진단하지 않는다', () => {
    try {
      parseCliArgs(['search', '--near=37.5,127.0', '--radius=-5km']);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as CtregError;
      expect(err.exit).toBe(EXIT.USAGE);
      expect(`${err.message} ${err.hint ?? ''}`).not.toContain('단위가 필요');
    }
  });

  it('양수는 그대로 통과한다', () => {
    const a = parseCliArgs(['search', '--near=37.5,127.0', '--radius', '0.5km']);
    expect(a.query.radius).toEqual({ value: 0.5, unit: 'km' });
  });
});

/**
 * Node `parseArgs` 의 오류 문구가 그대로 새어 나왔다 — 한국어 CLI 에서 영어 원문이고,
 * 안내가 이 상황에 맞지도 않는다. 실측 2026-08-28:
 *
 *   --nosuchopt → "Unknown option '--nosuchopt'. To specify a positional argument
 *                  starting with a '-', place it at the end ... after '--'"
 *     오타를 낸 사람에게 위치 인자를 `--` 뒤에 두라고 한다. 시킨 대로 하면 더 헤맨다.
 *   --condition (값 없이) → "Option '--condition <value>' argument missing"
 *
 * 이 CLI 는 오류도 사람이 읽고 행동할 수 있어야 한다는 규칙으로 돌아간다.
 */
describe('파서 오류를 영어 원문으로 흘리지 않는다', () => {
  const messageOf = (argv: string[]): string => {
    try {
      parseCliArgs(argv);
      return '';
    } catch (e) {
      const err = e as CtregError;
      expect(err.exit).toBe(EXIT.USAGE);
      return `${err.message} ${err.hint ?? ''}`;
    }
  };

  it('모르는 옵션은 한국어로 말하고, 위치 인자 이야기를 꺼내지 않는다', () => {
    const m = messageOf(['search', '--nosuchopt']);
    expect(m).toContain('--nosuchopt');
    expect(m).not.toContain('positional argument');
    expect(m).toMatch(/모르는|없는/);
  });

  it('값이 빠진 옵션도 한국어로 말한다', () => {
    const m = messageOf(['search', '--condition']);
    expect(m).toContain('--condition');
    expect(m).not.toContain('argument missing');
  });
});
