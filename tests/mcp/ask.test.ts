import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ask, parseResolution, systemPrompt } from '../../src/mcp/ask.js';

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-ask-')), CTREG_RATE_PER_SEC: '1000' });
const withKey = () => ({ ...env(), CTREG_LLM_API_KEY: 'test-key', CTREG_LLM_BASE_URL: 'https://llm.example/v1', CTREG_LLM_MODEL: 'test-model' });

/** LLM 응답을 흉내낸다 — OpenAI 호환 chat.completions 모양. */
const llm = (content: string) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));

/**
 * AI 모드 — 검색창의 자연어를 도구·인자로 바꾸는 한 자리. **LLM 이 하는 일은 이것뿐이다.**
 * 결과를 요약하거나 해석하게 두면 이 도구가 없애려던 "조용히 틀린 답" 이 페이지로 돌아온다.
 * 변환이 끝나면 그 뒤는 `callTool` 그대로 — 같은 코어, 같은 봉투.
 */
describe('AI 모드 — 자연어 → 도구·인자', () => {
  it('키가 없으면 501 이다 — 페이지가 "아직 켜져 있지 않다" 를 보인다', async () => {
    const r = await ask({ q: '흑색종 3상', intent: 'search' }, env(), fetch);
    expect(r.status).toBe(501);
  });

  it('LLM 이 고른 도구와 인자로 callTool 을 부르고, 무엇으로 물었는지 함께 낸다', async () => {
    const f = llm('{"tool":"count","args":{"condition":"melanoma","phase":["phase_3"]}}');
    const r = await ask({ q: '흑색종 3상 몇 건', intent: 'count' }, withKey(), f as unknown as typeof fetch);
    expect(r.status).toBe(200);
    const b = r.body as { resolved: { command: string; args: Record<string, unknown> }; exitCode: number };
    expect(b.resolved.command).toBe('count');
    expect(b.resolved.args).toMatchObject({ condition: 'melanoma', phase: ['phase_3'] });
    expect(typeof b.exitCode).toBe('number');
  });

  /** 사용자가 누른 버튼이 search↔count 를 정한다 — 실측에서 모델이 힌트를 약하게 본 경우가 있었다. */
  it('건수만 을 눌렀으면 모델이 search 를 골라도 count 로 간다', async () => {
    const f = llm('{"tool":"search","args":{"intervention":"pembrolizumab","condition":"lung cancer"}}');
    const r = await ask({ q: 'pembrolizumab 폐암', intent: 'count' }, withKey(), f as unknown as typeof fetch);
    expect((r.body as { resolved: { command: string } }).resolved.command).toBe('count');
  });

  /**
   * **모델이 고른 것을 검증 없이 실행하지 않는다.** 모르는 도구·모르는 인자는 여기서 막는다 —
   * CLI 파서가 exit 2 를 내겠지만, 그건 "모델이 헛소리를 했다" 를 "입력을 고쳐라" 로 오도한다.
   */
  it('모델이 모르는 도구를 고르면 실행하지 않고 502 다', async () => {
    const f = llm('{"tool":"delete_everything","args":{}}');
    const r = await ask({ q: 'x', intent: 'search' }, withKey(), f as unknown as typeof fetch);
    expect(r.status).toBe(502);
  });

  it('모델이 JSON 이 아닌 것을 내면 502 다', async () => {
    const f = llm('죄송하지만 그 질문은…');
    const r = await ask({ q: 'x', intent: 'search' }, withKey(), f as unknown as typeof fetch);
    expect(r.status).toBe(502);
  });

  /** LLM 응답에 코드 펜스가 붙어 와도 읽는다 — 작은 모델이 자주 그런다. */
  it('코드 펜스로 감싼 JSON 도 읽는다', () => {
    expect(parseResolution('```json\n{"tool":"search","args":{"term":"x"}}\n```')).toEqual({ tool: 'search', args: { term: 'x' } });
  });

  /**
   * **한국어 이름은 names 로 가야 한다.** 모델이 이름을 직접 로마자로 옮겨 search 에 넣으면
   * 이 서버의 존재 이유가 사라진다. 시스템 프롬프트가 그것을 말하는지 본다 — 모델이 따르는지는
   * 실측으로 따로 재야 한다(테스트로 못 박을 수 없는 것).
   */
  it('시스템 프롬프트가 한국어 이름 → names 를 지시하고 요약을 금한다', () => {
    const p = systemPrompt('search');
    expect(p).toMatch(/names/);
    expect(p).toMatch(/한국어|로마자/);
    expect(p).toMatch(/JSON/);
  });

  it('LLM 호출에 키·모델·베이스 URL 이 실린다', async () => {
    const f = llm('{"tool":"registries","args":{}}');
    await ask({ q: '레지스트리', intent: 'search' }, withKey(), f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string).model).toBe('test-model');
  });
});
