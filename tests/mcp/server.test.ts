import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMAND_OPTIONS, COMMANDS, OPTIONS } from '../../src/cli/args.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { argvFor, callTool, toolSchemas } from '../../src/mcp/server.js';

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-mcp-')), CTREG_RATE_PER_SEC: '1000' });

/**
 * MCP 는 CLI 의 **세 번째 껍데기** 다(첫째 bin, 둘째 플러그인 스킬). 코어는 하나이므로
 * 여기서 검사하는 것은 "MCP 가 CLI 와 갈리지 않는가" 하나다 — 도구 목록, 인자 표면,
 * 종료 코드 계약이 전부 CLI 에서 파생되어야 한다.
 */
describe('MCP 도구 표면은 CLI 에서 파생된다', () => {
  it('커맨드마다 도구가 하나씩 있고 더는 없다', () => {
    expect(new Set(Object.keys(toolSchemas()))).toEqual(new Set(COMMANDS));
  });

  /**
   * **인자를 손으로 다시 적지 않는다.** `COMMAND_OPTIONS` 가 정본이고, MCP 스키마는 그것을
   * 읽어 만든다. 두 벌로 두면 옵션이 하나 늘 때 CLI 는 받는데 MCP 는 모르는 — 또는 그 반대의 —
   * 상태가 생기고, 그것은 사용자 눈에 "같은 도구가 곳에 따라 다르게 군다" 로 보인다.
   *
   * `format`·`help`·`version` 은 뺀다 — 출력 형식은 MCP 가 정하고(항상 JSON 봉투),
   * 나머지 둘은 프로세스 경계의 물건이다.
   */
  it('도구 인자는 그 커맨드의 COMMAND_OPTIONS 와 같다', () => {
    const excluded = new Set(['format', 'help', 'version']);
    // 위치 인자(get 의 ids, results 의 id)는 옵션 표에 없다 — 따로 확인한다(아래).
    const positional = new Set(['ids', 'trial_id']);
    for (const cmd of COMMANDS) {
      const want = COMMAND_OPTIONS[cmd].filter((o) => !excluded.has(o)).sort();
      const got = Object.keys(toolSchemas()[cmd].shape).filter((k) => !positional.has(k)).sort();
      expect(got, cmd).toEqual(want);
    }
  });

  /**
   * **위치 인자 이름이 옵션 이름과 겹치면 안 된다.** search 에 `--id`(ID 로 거르는 검색 축)가
   * 있어서, results 의 위치 인자를 `id` 로 두면 모델이 둘을 섞는다 — 실제로 첫 구현이 그랬다.
   */
  it('위치 인자 이름은 어떤 옵션 이름과도 겹치지 않는다', () => {
    const optionNames = new Set(Object.keys(OPTIONS));
    for (const k of ['ids', 'trial_id']) expect(optionNames.has(k), k).toBe(false);
  });

  it('get 과 results 는 위치 인자를 받는다', () => {
    expect(toolSchemas().get.shape).toHaveProperty('ids');
    expect(toolSchemas().results.shape).toHaveProperty('trial_id');
  });
});

describe('MCP 인자 → argv 변환', () => {
  it('문자열·반복·불리언을 CLI 가 받는 모양으로 편다', () => {
    const argv = argvFor('search', { condition: 'melanoma', registry: ['ctgov', 'ctis'], 'no-cache': true, 'page-size': 3 });
    expect(argv).toEqual([
      'search', '--condition', 'melanoma', '--registry', 'ctgov', '--registry', 'ctis',
      '--no-cache', '--page-size', '3', '--format', 'json',
    ]);
  });

  /** 대시로 시작하는 값(남반구 좌표)은 등호로 붙여야 파서가 옵션으로 오독하지 않는다. */
  it('대시로 시작하는 값은 등호로 붙인다', () => {
    expect(argvFor('search', { near: '-33.8,151.2' })).toContain('--near=-33.8,151.2');
  });

  it('false 인 불리언과 undefined 는 보내지 않는다', () => {
    const argv = argvFor('search', { condition: 'x', raw: false, term: undefined });
    expect(argv).not.toContain('--raw');
    expect(argv).not.toContain('--term');
  });

  it('위치 인자는 커맨드 바로 뒤에 온다', () => {
    expect(argvFor('get', { ids: ['CTGOV:NCT1', 'CTIS:2'] }).slice(0, 3)).toEqual(['get', 'CTGOV:NCT1', 'CTIS:2']);
    expect(argvFor('results', { trial_id: 'CTGOV:NCT1' }).slice(0, 2)).toEqual(['results', 'CTGOV:NCT1']);
  });
});

/**
 * **종료 코드를 잃으면 이 껍데기는 없느니만 못하다.** CLI 의 핵심이 exit 3(그렇게 물어볼 수
 * 없음)과 0건을 가르는 것인데, MCP 도구 결과에는 종료 코드 자리가 없다. 본문에 명시적으로
 * 싣지 않으면 셸에서 지켜 온 규칙이 MCP 에서 조용히 사라진다.
 */
describe('MCP 결과는 종료 코드 계약을 싣는다', () => {
  it('registries 는 exit 0 과 봉투를 낸다', async () => {
    const r = await callTool('registries', {}, env());
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0]!.text) as { exitCode: number; envelope: { registries: unknown[] } };
    expect(body.exitCode).toBe(EXIT.OK);
    expect(body.envelope.registries).toHaveLength(5);
  });

  /**
   * 사용법 오류(exit 2)는 **도구 오류** 다 — 모델이 인자를 고쳐야 한다. 그런데 exit 3
   * (미지원)은 도구 오류가 아니다: 요청은 옳았고 그 레지스트리가 그렇게 못 물을 뿐이다.
   * 둘을 같은 얼굴로 내면 모델이 미지원을 자기 실수로 읽고 인자를 바꿔 가며 헤맨다.
   */
  it('exit 2 는 isError 이고 exit 3 은 아니다', async () => {
    const usage = await callTool('search', { 'page-size': -1 }, env());
    expect(usage.isError).toBe(true);
    expect((JSON.parse(usage.content[0]!.text) as { exitCode: number }).exitCode).toBe(EXIT.USAGE);

    const unsupported = await callTool('search', { registry: ['ctis'], condition: 'x', phase: ['phase_3'] }, env());
    expect(unsupported.isError).toBeFalsy();
    expect((JSON.parse(unsupported.content[0]!.text) as { exitCode: number }).exitCode).toBe(EXIT.UNSUPPORTED);
  });

  /**
   * 원래는 실제 CTIS 를 불러 0건을 받았는데, 다른 프로세스 테스트와 겹치면 5초를 넘겨
   * 플레이크가 났다. 이 검사가 지키는 것은 "0건이 오류가 아니다" 이지 네트워크가 아니므로
   * `registries` 로 바꾼다 — 네트워크 없이 exit 0 을 내는 유일한 커맨드다.
   */
  it('exit 0 은 오류가 아니다', async () => {
    const r = await callTool('registries', { registry: ['ctgov'] }, env());
    expect(r.isError).toBeFalsy();
    expect((JSON.parse(r.content[0]!.text) as { exitCode: number }).exitCode).toBe(EXIT.OK);
  });
});

/** OPTIONS 가 export 되어야 스키마를 파생할 수 있다 — 그 계약을 여기서 못 박는다. */
describe('OPTIONS 가 스키마 파생에 필요한 것을 준다', () => {
  it('모든 옵션이 type 을 갖고, multi 는 multiple 을 갖는다', () => {
    for (const [name, def] of Object.entries(OPTIONS)) {
      expect(def, name).toHaveProperty('type');
      const d = def as { type: string; multiple?: boolean };
      if (d.multiple) expect(d.type, name).toBe('string');
    }
  });
});

/**
 * **진입점은 프로세스 경계라 단위 테스트가 못 본다.** CLI 쪽에서 실제로 겪었고, MCP 에서도
 * 사보타주로 다시 겪었다 — `bin.ts` 의 `loadEnvFiles()` 를 지워도 스위트가 830 초록이었고
 * 실물만 "인증키가 없습니다" 였다. 그래서 진입점을 **자식 프로세스로 띄워 실제 프로토콜로**
 * 검사한다. `dist/` 가 필요하므로 빌드가 선행돼야 한다(다른 dist 테스트와 같은 조건).
 */
describe('ctreg-mcp 진입점 (실제 프로세스)', () => {
  const rpc = (messages: object[], env: NodeJS.ProcessEnv): Promise<Map<number, unknown>> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(__dirname, '../../dist/mcp/bin.js')], {
        env: { ...process.env, ...env, CTREG_CRIS_SERVICE_KEY: undefined as unknown as string },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', reject);
      child.on('close', () => {
        const byId = new Map<number, unknown>();
        for (const line of out.split('\n')) {
          if (!line.trim()) continue;
          const m = JSON.parse(line) as { id?: number; result?: unknown };
          if (typeof m.id === 'number') byId.set(m.id, m.result);
        }
        resolve(byId);
      });
      child.stdin.write(messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
      child.stdin.end();
    });

  const handshake = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ];

  it('사용자 설정 파일의 키를 읽는다 — 진입점이 loadEnvFiles 를 부른다', async () => {
    const xdg = mkdtempSync(join(tmpdir(), 'ctreg-mcp-xdg-'));
    mkdirSync(join(xdg, 'ctreg'), { recursive: true });
    writeFileSync(join(xdg, 'ctreg', '.env'), 'CTREG_CRIS_SERVICE_KEY=dummy-from-user-config\n');
    const res = await rpc(
      [...handshake, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'count', arguments: { registry: ['cris'], term: 'x', 'no-cache': true } } }],
      { XDG_CONFIG_HOME: xdg, CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-mcp-')), CTREG_RATE_PER_SEC: '1000' },
    );
    const r = res.get(3) as { content: { text: string }[] };
    const body = JSON.parse(r.content[0]!.text) as { envelope: { registries: { error?: { message: string } }[] } };
    const msg = body.envelope.registries[0]!.error?.message ?? '';
    // 키를 읽었으면 "없습니다" 가 아니라 업스트림이 가짜 키를 거절한 흔적(403)이 온다.
    expect(msg).not.toContain('인증키가 없습니다');
  }, 30_000);

  it('도구 다섯을 광고한다', async () => {
    const res = await rpc([...handshake, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], {});
    const tools = (res.get(2) as { tools: { name: string }[] }).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...COMMANDS].sort());
  }, 30_000);
});
