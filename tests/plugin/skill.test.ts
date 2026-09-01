import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY_KEYS } from '../../src/core/registry.js';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(join(__dirname, '../../skills/ctreg/SKILL.md'), 'utf8');
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '../../.claude-plugin/plugin.json'), 'utf8'),
);
const MARKET = JSON.parse(
  readFileSync(join(__dirname, '../../.claude-plugin/marketplace.json'), 'utf8'),
);
const PKG = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

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

/**
 * **버전이 세 파일에 있다** — `package.json`(npm), `plugin.json`(플러그인),
 * `marketplace.json`(설치 목록). 이 저장소가 문서에 대해 되풀이해 배운 것이 여기에도
 * 그대로 적용된다: **한 사실을 여러 곳에 적으면 한쪽만 갱신된다.**
 *
 * 갈렸을 때 조용하다는 것이 문제다. 마켓플레이스가 낡은 버전을 광고해도 설치는 되고,
 * 받는 사람은 자기가 무엇을 받았는지 모른다. 지울 수 없는 중복이라면 **묶어 둔다.**
 */
describe('플러그인 배포 매니페스트', () => {
  it('마켓플레이스가 이 저장소 자신을 가리킨다', () => {
    expect(MARKET.plugins).toHaveLength(1);
    expect(MARKET.plugins[0].name).toBe('ctreg');
    // 저장소 루트가 곧 플러그인이다 — 하위 디렉터리로 옮기면 여기도 함께 바뀌어야 한다.
    expect(MARKET.plugins[0].source).toBe('./');
  });

  it('세 파일의 버전이 갈리지 않는다', () => {
    expect(MARKET.plugins[0].version).toBe(MANIFEST.version);
    expect(MANIFEST.version).toBe(PKG.version);
  });

  /**
   * 이 플러그인은 **스킬 한 장이고 CLI 를 싣지 않는다.** 받는 사람이 CLI 를 따로
   * 설치해야 하는데, 그 사실이 설치 목록에 안 적혀 있으면 설치한 뒤에야 알게 된다 —
   * SKILL.md 는 그때 "설치되지 않았다" 고만 말할 수 있다.
   */
  it('설치 목록이 CLI 가 따로 필요하다는 것을 말한다', () => {
    /**
     * **패키지 이름을 여기 박아 넣지 않는다.** `package.json` 에서 읽어 온다 —
     * 실제로 갈렸다: npm 이 `ctreg` 를 기존 패키지와 너무 비슷하다고 거절해서
     * `@kimmingul/ctreg` 로 옮겼는데, 그때 설치 목록이 없는 패키지를 광고하고 있었다.
     * 이름을 두 곳에 적으면 한쪽만 바뀌고, **틀린 쪽이 설치 안내라는 것이 가장 나쁘다.**
     */
    expect(MARKET.plugins[0].description).toContain(`npm i -g ${PKG.name}`);
  });

  /** 패키지 이름이 바뀌어도 **명령어는 `ctreg`** 다. 문서의 모든 예시가 이것에 달려 있다. */
  it('명령어 이름은 패키지 이름과 무관하게 ctreg 다', () => {
    expect(Object.keys(PKG.bin)).toEqual(['ctreg']);
  });
});

/**
 * 슬래시 커맨드는 스킬과 **다른 물건**이다. 스킬은 Claude 가 임상시험 질문을 만났을 때
 * 스스로 붙이는 것이고, 커맨드는 사용자가 이름을 대고 부르는 것이다. 그래서 커맨드는
 * 레지스트리를 하나로 못 박아도 된다 — 사용자가 그것을 골라 부른 것이기 때문이다.
 *
 * 그러나 **얇아야 하는 이유는 같다.** 축과 값과 종료 코드는 여전히 CLI 가 말한다.
 */
describe('슬래시 커맨드', () => {
  const dir = join(__dirname, '../../commands');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

  /**
   * **레지스트리마다 커맨드가 하나씩 있어야 한다.** 어댑터를 더하고 커맨드를 잊으면
   * 그 레지스트리는 슬래시로 부를 수 없는 채 조용히 남는다 — 목록이 두 곳에 있을 때
   * 벌어지는 그 일이다. 여기서 묶어 두면 어댑터를 더하는 사람이 반드시 마주친다.
   */
  it('레지스트리마다 커맨드가 있고, 전부 부르는 all 이 있다', () => {
    expect(new Set(files)).toEqual(new Set([...REGISTRY_KEYS.map((k) => `${k}.md`), 'all.md']));
  });

  it('커맨드마다 프론트매터가 있다', () => {
    for (const f of files) {
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(read(f));
      expect(fm, f).not.toBeNull();
      expect(fm![1], f).toMatch(/^description:\s*\S/m);
      expect(fm![1], f).toMatch(/^argument-hint:\s*\S/m);
    }
  });

  it('사용자 입력을 실제로 넘긴다', () => {
    for (const f of files) expect(read(f), f).toContain('$ARGUMENTS');
  });

  /**
   * **CLI 표면을 복제하지 않는다.** 커맨드가 골라야 하는 것은 레지스트리 하나뿐이고,
   * 나머지 축·값·형식은 `ctreg registries` 와 `ctreg --help` 가 말한다. 여기에 플래그를
   * 적기 시작하면 CLI 가 바뀔 때 여섯 파일이 함께 낡는다.
   */
  it('--registry 와 --help 말고는 플래그를 적지 않는다', () => {
    for (const f of files) {
      const flags = [...new Set([...read(f).matchAll(/--[a-z][a-z-]+/g)].map((m) => m[0]))];
      expect(flags.filter((x) => !['--registry', '--help'].includes(x)), f).toEqual([]);
    }
  });

  /** 각 커맨드는 자기 레지스트리만 건다 — `all` 만 예외다. */
  it('레지스트리 커맨드는 자기 키를 건다', () => {
    for (const k of REGISTRY_KEYS) expect(read(`${k}.md`), k).toContain(`--registry ${k}`);
    expect(read('all.md')).toContain('--registry all');
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
    /**
     * **두 묶음을 가른다.** 앞은 규율(`ctreg registries`·`ctreg --help`)이고, 뒤는
     * **부트스트랩** 이다 — 도구를 어떻게 얻는지는 CLI 자신이 말해 줄 수 없다. 아직
     * 없을 때 필요한 지식이라서다. 그것 말고는 여전히 아무것도 적을 수 없다:
     * 플래그도, 커맨드 이름도, 종료 코드의 뜻도 `--help` 가 말한다.
     *
     * `-y` 를 쓴 것은 `--yes` 가 위의 플래그 검사(정확히 `--help` 하나)를 깨기 때문이다.
     * 가드를 둘 푸는 대신 하나만 푼다.
     */
    const allowed = new Set([
      'ctreg', 'help', 'registries',
      'npx', 'y', 'kimmingul',
    ]);
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
    expect(headings).toEqual(['시작하기 전에', '출력을 읽는 법', '레지스트리를 읽는 법', '한계']);
  });
});
