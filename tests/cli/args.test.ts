import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../src/cli/args.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import type { CtregError } from '../../src/runtime/errors.js';

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

  it('--include 는 알려진 섹션만 받는다', () => {
    expect(parseCliArgs(['search', '--include', 'eligibility']).fetch.include).toContain('eligibility');
    expectUsage(() => parseCliArgs(['search', '--include', 'everything']));
  });

  it('--eligibility-chars 는 --include eligibility 를 요구하고 상한이 있다', () => {
    expectUsage(() => parseCliArgs(['search', '--eligibility-chars', '100']), '--include eligibility');
    expect(parseCliArgs(['search', '--include', 'eligibility', '--eligibility-chars', '100']).fetch.caps.eligibilityChars).toBe(100);
    expectUsage(() => parseCliArgs(['search', '--include', 'eligibility', '--eligibility-chars', '999999']));
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
