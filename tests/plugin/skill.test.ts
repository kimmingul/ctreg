import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(join(__dirname, '../../skills/ctreg/SKILL.md'), 'utf8');
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '../../.claude-plugin/plugin.json'), 'utf8'),
);

const BODY = (() => {
  const m = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(SKILL);
  if (!m) throw new Error('SKILL.md 에 프론트매터가 없다');
  return m[1]!;
})();

describe('플러그인 매니페스트', () => {
  it('스킬만 싣는다 — MCP 서버는 CLI 로 대체했다', () => {
    expect(MANIFEST.name).toBe('ctreg');
    expect(MANIFEST.license).toBe('Apache-2.0');
    expect(MANIFEST).not.toHaveProperty('mcpServers');
  });
});

describe('SKILL.md 는 얇다', () => {
  it('frontmatter 에 name 과 description 이 있다', () => {
    expect(SKILL.startsWith('---\n')).toBe(true);
    const fm = SKILL.split('---')[1]!;
    expect(fm).toMatch(/^name:\s*ctreg$/m);
    expect(fm).toMatch(/^description:\s*\S/m);
  });

  it('면책 문장을 축어로 담는다 — 안전 경계는 실험의 순수성보다 우선한다', () => {
    expect(SKILL).toContain(
      '이 도구의 출력은 임상시험 적격 판정이 아니다. 레지스트리 기재사항은 스크리닝을 대체하지 않는다.',
    );
  });

  it('--help 외의 어떤 플래그도 적지 않는다 — CLI 가 스스로 말해야 한다', () => {
    const flags = [...SKILL.matchAll(/--[a-z][a-z-]+/g)].map((m) => m[0]);
    expect([...new Set(flags)]).toEqual(['--help']);
  });

  it('registries 외의 커맨드 이름을 적지 않는다', () => {
    // `ctreg registries` 와 `ctreg --help` 는 규율이라 예외다.
    for (const cmd of ['ctreg search', 'ctreg get', 'ctreg results', 'ctreg count']) {
      expect(SKILL).not.toContain(cmd);
    }
  });

  it('exit code 의 의미나 경고 코드를 적지 않는다', () => {
    for (const leak of ['exit 0', 'exit 2', 'exit 3', 'exit 4', 'exit 5',
                        'not_found', 'results_summarized', 'locations_truncated',
                        'date_filter_excludes_missing', 'geo_radius_defaulted']) {
      expect(SKILL).not.toContain(leak);
    }
  });

  it('한 페이지를 넘지 않는다', () => {
    expect(SKILL.split('\n').length).toBeLessThan(60);
  });

  it('본문의 라틴 토큰은 허용 목록뿐이다 — 커맨드명·플래그명은 접두사 유무와 무관하게 걸린다', () => {
    const allowed = new Set(['ctreg', 'help', 'registries']);
    const found = [...BODY.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)].map((m) => m[0].toLowerCase());
    expect([...new Set(found)].filter((w) => !allowed.has(w))).toEqual([]);
  });

  it('본문에 아라비아 숫자가 없다 — exit code 를 한국어로 풀어 써도 걸린다', () => {
    expect(BODY.match(/[0-9]/g)).toBeNull();
  });

  it('출력 형식을 설명하는 한국어 어휘가 없다', () => {
    const banned = ['표준 출력', '표준 에러', '표준출력', '표준에러', '파싱', '직렬화'];
    expect(banned.filter((w) => BODY.includes(w))).toEqual([]);
  });

  it('절 구성이 고정되어 있다 — 새 절을 만들어 지식을 부어넣을 수 없다', () => {
    const headings = [...BODY.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
    expect(headings).toEqual(['시작하기 전에', '출력을 읽는 법', '한계']);
  });
});
