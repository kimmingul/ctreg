import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ask, koreanPersonInQuery, parseResolution, systemPrompt } from '../../src/mcp/ask.js';

const env = () => ({ CTREG_CACHE_DIR: mkdtempSync(join(tmpdir(), 'ctreg-ask-')), CTREG_RATE_PER_SEC: '1000' });
const withKey = () => ({ ...env(), CTREG_LLM_API_KEY: 'test-key', CTREG_LLM_BASE_URL: 'https://llm.example/v1', CTREG_LLM_MODEL: 'test-model' });

/** LLM 응답을 흉내낸다 — OpenAI 호환 chat.completions 모양. */
const llmRes = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const llm = (content: string) => vi.fn(async () => llmRes(content));

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

  /**
   * **모델이 준 인자를 그대로 실행에 넘기지 않는다.** 그 도구가 받지 않는 키는 걸러진다.
   * 사보타주로 확인했다 — sanitize 를 우회해도 8개 전부 초록이었다. 걸러지는지 보려면
   * 걸러진 뒤의 인자(resolved.args)를 봐야 한다.
   */
  it('그 도구가 받지 않는 인자는 실행 전에 걸러진다', async () => {
    const f = llm('{"tool":"registries","args":{"registry":["ctgov"],"condition":"x","evil":"rm -rf"}}');
    const r = await ask({ q: '레지스트리', intent: 'search' }, withKey(), f as unknown as typeof fetch);
    const args = (r.body as { resolved: { args: Record<string, unknown> } }).resolved.args;
    expect(args).toEqual({ registry: ['ctgov'] });   // registries 는 registry 만 받는다
    expect(args).not.toHaveProperty('evil');
    expect(args).not.toHaveProperty('condition');
  });

  /**
   * **이름만 쳐도 찾아야 한다.** Claude 에 MCP 로 붙였을 때는 "김민걸 연구 찾아줘" 가 됐다 —
   * 에이전트가 names 실패 뒤 로마자 후보를 여럿 만들어 ctgov 에 각각 물었기 때문이다. 페이지는
   * 한 번 부르고 끝이라 그 절차를 서버가 대신한다. 단, **추측했다고 밝힌다** — 스킬 지침
   * 그대로("찾지 못해 추측했다면 추측했다고 답에 밝혀라").
   */
  it('이름만 있으면 로마자 후보로 ctgov 에 각각 묻고 합쳐 낸다 — 추측했다고 밝히면서', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"names","args":{"korean_name":"김민걸","ctgov":true}}'))
      .mockResolvedValueOnce(llmRes('["Min-Gul Kim","Mingul Kim","Min Gul Kim"]'))
      .mockResolvedValueOnce(llmRes('전북대학교병원'));   // 시설명 → 국문 정식 명칭
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const totals: Record<string, number> = { 'Min-Gul Kim': 2, 'Mingul Kim': 1, 'Min Gul Kim': 0 };
    const site = { facility: 'Chonbuk National University Hospital', country: 'South Korea' };
    const call = (async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if ((args.registry as string[])[0] === 'cris') {
        return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'cris', status: 'ok', total: 1 }], warnings: [{ code: 'investigator_checked_by_detail', message: 'x', registry: 'cris' }], data: [{ id: 'CRIS:KCT1' }] } } };
      }
      const v = args.investigator as string; const total = totals[v] ?? 0;
      const data = cmd === 'count' ? { total } : v === 'Min-Gul Kim' ? [{ id: 'CTGOV:A', locations: [site] }, { id: 'CTGOV:B', locations: [site] }] : [{ id: 'CTGOV:B', locations: [site] }];
      return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total }], warnings: [], data } } };
    }) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '김민걸 교수의 임상시험 리스트', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    expect(r.status).toBe(200);
    const b = r.body as { exitCode: number; resolved: { command: string; args: Record<string, unknown> }; envelope: { registries: { registry: string; status: string }[]; data: { id: string }[]; warnings: { code: string; message: string }[] } };
    expect(b.exitCode).toBe(0);
    expect(b.resolved.command).toBe('search');
    expect(b.resolved.args.investigator).toEqual(['Min-Gul Kim', 'Mingul Kim']);   // 걸린 표기만, 많은 순
    expect(b.envelope.data.map((x) => x.id)).toEqual(['CTGOV:A', 'CTGOV:B', 'CRIS:KCT1']);   // 합치고 중복 제거, CRIS 도
    const w = b.envelope.warnings.find((x) => x.code === 'name_romanized_guess');
    expect(w?.message).toMatch(/추측/);
    expect(w?.message).toMatch(/Min-Gul Kim/);
    expect(calls.filter((c) => c.cmd === 'search' && (c.args.registry as string[])[0] === 'ctgov').map((c) => c.args.investigator)).toEqual(['Min-Gul Kim', 'Mingul Kim']);   // 0건 표기는 열지 않는다
    /**
     * **CRIS 도 나와야 한다.** CRIS 는 이름으로 못 거르지만 ctgov 시험 장소가 소속을 말해 준다
     * (실측: Chonbuk National University Hospital 27건). 그 기관을 좁힐 말로 국문·영문 둘 다
     * 물어 연구책임자를 대조한다 — 사용자: "결과물에 CRIS 꺼는 안 보이는데?"
     */
    const cris = calls.filter((c) => (c.args.registry as string[])[0] === 'cris');
    expect(cris.map((c) => c.args.term).sort()).toEqual(['Chonbuk National University Hospital', '전북대학교병원']);
    expect(cris.every((c) => c.args.investigator === '김민걸')).toBe(true);
    expect(b.envelope.registries.map((r) => r.registry)).toEqual(['ctgov', 'isrctn', 'ctis', 'cris']);   // 넷 다 답한다 — ISRCTN 은 본문, CTIS 는 못 물음
    const a = b.envelope.warnings.find((x) => x.code === 'name_affiliation_guess');
    expect(a?.message).toMatch(/전북대학교병원/);
    expect(b.envelope.warnings.some((x) => x.code === 'investigator_checked_by_detail')).toBe(true);   // CRIS 의 경고를 버리지 않는다
  });

  /** 실측(2026-09-10): 모델 후보 여섯에 `Mingul Kim`(17건)이 없었다. 붙임·띄움은 규칙이라 서버가 만든다. */
  it('하이픈 표기가 오면 붙인 표기도 함께 묻는다 — 모델이 빠뜨려도', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"names","args":{"korean_name":"김민걸"}}'))
      .mockResolvedValueOnce(llmRes('["Min-Gul Kim"]'));
    const asked: string[] = [];
    const call = (async (cmd: string, args: Record<string, unknown>) => { if (cmd === 'count') asked.push(args.investigator as string);
      return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [], warnings: [], data: cmd === 'count' ? { total: 0 } : [] } } }; }) as unknown as Parameters<typeof ask>[3];
    await ask({ q: '김민걸', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    expect(asked).toContain('Min-Gul Kim');
    expect(asked).toContain('Mingul Kim');
  });

  /**
   * **사본이 있으면 소속을 추측하지 않는다.** CRIS 사본은 이름이 목록 축이라 한국어 이름으로 바로
   * 묻고, 거기서 읽은 **등록된** 영문 표기로 ctgov 를 묻는다 — 모델의 로마자 추측은 보조일 뿐이다.
   * 사용자가 CRIS 전체 DB 를 만든 이유가 이것이다(2026-09-11).
   */
  it('CRIS 사본이 있으면 — 한국어 이름으로 CRIS 를 바로 묻고, 등록된 표기로 ctgov 를 묻는다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"names","args":{"korean_name":"김민걸"}}'))
      .mockResolvedValueOnce(llmRes('["Min-Gul Kim","Minkul Kim"]'));   // 추측 — Minkul 은 등록에 없다
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const pi = (en: string) => [{ name: '김민걸', role: '연구책임자' }, { name: en, role: '연구책임자' }];
    const call = (async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      const reg = (args.registry as string[])[0];
      if (reg === 'cris') {
        // 사본: 이름만으로 43건 중 셋 — 등록된 표기 둘(Min-Gul Kim, Min Gul KIm 오타)
        return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'cris', status: 'ok', total: 3 }], warnings: [{ code: 'cris_mirror_copy', message: '사본', registry: 'cris' }],
          data: [{ id: 'CRIS:K1', contacts: pi('Min-Gul Kim') }, { id: 'CRIS:K2', contacts: pi('Min-Gul Kim') }, { id: 'CRIS:K3', contacts: pi('Min Gul KIm') }] } } };
      }
      const v = args.investigator as string;
      const totals: Record<string, number> = { 'Min-Gul Kim': 2, 'Min Gul KIm': 1, 'Minkul Kim': 0, 'Mingul Kim': 0 };
      const total = totals[v] ?? 0;
      const data = cmd === 'count' ? { total } : total === 0 ? [] : v === 'Min-Gul Kim' ? [{ id: 'CTGOV:A' }, { id: 'CTGOV:B' }] : [{ id: 'CTGOV:C' }];
      return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total }], warnings: [], data } } };
    }) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '김민걸 교수의 임상시험 리스트', intent: 'search' }, { ...withKey(), CTREG_CRIS_MIRROR_URL: 'https://kctis.example.test' }, f as unknown as typeof fetch, call);
    const b = r.body as { exitCode: number; resolved: { args: Record<string, unknown> }; envelope: { registries: { registry: string; status: string; total?: number }[]; data: { id: string }[]; warnings: { code: string; message: string }[] } };
    expect(b.exitCode).toBe(0);
    // CRIS 는 한국어 이름으로, term 없이, 소속 추측 없이
    const cris = calls.filter((c) => (c.args.registry as string[])[0] === 'cris');
    expect(cris).toHaveLength(1);
    expect(cris[0]!.args).toMatchObject({ investigator: '김민걸' });
    expect(cris[0]!.args).not.toHaveProperty('term');
    expect(b.envelope.warnings.some((w) => w.code === 'name_affiliation_guess')).toBe(false);
    // ctgov 는 등록된 표기(오타 포함)와 추측 표기 모두를 묻고, 걸린 것만 연다
    const counted = calls.filter((c) => c.cmd === 'count').map((c) => c.args.investigator as string);
    expect(counted).toEqual(expect.arrayContaining(['Min-Gul Kim', 'Min Gul KIm', 'Minkul Kim']));
    expect(b.envelope.data.map((x) => x.id).sort()).toEqual(['CRIS:K1', 'CRIS:K2', 'CRIS:K3', 'CTGOV:A', 'CTGOV:B', 'CTGOV:C']);
    expect(b.envelope.registries.filter((x) => x.status === 'ok').map((x) => [x.registry, x.total])).toEqual([['ctgov', 3], ['isrctn', 0], ['cris', 3]]);
    // 등록된 표기와 추측 표기를 구별해 말한다
    const w = b.envelope.warnings.find((x) => x.code === 'name_romanized_guess');
    expect(w?.message).toMatch(/등록된 표기/);
    expect(w?.message).toMatch(/Min Gul KIm/);
    expect(b.envelope.warnings.some((x) => x.code === 'cris_mirror_copy')).toBe(true);   // 사본 경고를 버리지 않는다
  });

  /**
   * **ISRCTN 도 본다 — 본문 자유검색으로.** 사용자: "내가 진행한 임상시험이 ctgov, cris 이외에
   * 다른 레지스트리에도 1-2개 정도 더 있었거든요?" 실측(2026-09-11): ISRCTN `--term "Min-Gul Kim"`
   * 1건(ISRCTN18353234). 이름 축이 없어 본문 검색이므로 연구책임자가 아닐 수 있다 — 그것을 밝힌다.
   * CTIS 는 네 표기 전부 0 — 자유검색이 이름에 닿지 않는다. 물어볼 수 없다고 적는다.
   */
  it('ISRCTN 은 표기마다 본문 자유검색으로 묻고, 본문 검색이라고 밝힌다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"names","args":{"korean_name":"김민걸"}}'))
      .mockResolvedValueOnce(llmRes('["Min-Gul Kim"]'));
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const call = (async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      const reg = (args.registry as string[])[0];
      if (reg === 'cris') return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'cris', status: 'ok', total: 0 }], warnings: [], data: [] } } };
      if (reg === 'isrctn') {
        const total = args.term === 'Min-Gul Kim' ? 1 : 0;
        return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'isrctn', status: 'ok', total }], warnings: [], data: cmd === 'count' ? { total } : total ? [{ id: 'ISRCTN:ISRCTN18353234' }] : [] } } };
      }
      const total = args.investigator === 'Min-Gul Kim' ? 1 : 0;
      return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total }], warnings: [], data: cmd === 'count' ? { total } : total ? [{ id: 'CTGOV:A' }] : [] } } };
    }) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '김민걸 연구', intent: 'search' }, { ...withKey(), CTREG_CRIS_MIRROR_URL: 'https://kctis.example.test' }, f as unknown as typeof fetch, call);
    const b = r.body as { envelope: { registries: { registry: string; status: string; total?: number }[]; data: { id: string }[]; warnings: { code: string; message: string }[] } };
    // ISRCTN 은 investigator 가 아니라 term 으로 — 축이 없다
    const isr = calls.filter((c) => (c.args.registry as string[])[0] === 'isrctn');
    expect(isr.length).toBeGreaterThan(0);
    expect(isr.every((c) => typeof c.args.term === 'string' && !('investigator' in c.args))).toBe(true);
    expect(b.envelope.data.map((x) => x.id)).toEqual(expect.arrayContaining(['CTGOV:A', 'ISRCTN:ISRCTN18353234']));
    expect(b.envelope.registries.find((x) => x.registry === 'isrctn')).toMatchObject({ status: 'ok', total: 1 });
    expect(b.envelope.registries.find((x) => x.registry === 'ctis')?.status).toBe('unsupported');
    const w = b.envelope.warnings.find((x) => x.code === 'name_fulltext_isrctn');
    expect(w?.message).toMatch(/본문|자유검색/);
  });

  it('이름만 있는데 어느 표기도 안 걸리면 0건이되 그 표기들을 밝힌다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"names","args":{"korean_name":"홍길동"}}'))
      .mockResolvedValueOnce(llmRes('["Gil-Dong Hong","Gildong Hong"]'));
    const call = (async (cmd: string) => ({ content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total: 0 }], warnings: [], data: cmd === 'count' ? { total: 0 } : [] } } })) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '홍길동 연구', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    const b = r.body as { exitCode: number; envelope: { data: unknown[]; warnings: { code: string; message: string }[] } };
    expect(b.exitCode).toBe(0);
    expect(b.envelope.data).toEqual([]);
    expect(b.envelope.warnings[0]?.message).toMatch(/Gil-Dong Hong/);
    expect(b.envelope.warnings[0]?.message).toMatch(/소속|기관/);
    // 소속을 알아낼 ctgov 시험이 없으니 CRIS 는 '그렇게 물어볼 수 없음' — 0건이 아니다
    const cris = (b.envelope as unknown as { registries: { registry: string; status: string }[] }).registries.find((r) => r.registry === 'cris');
    expect(cris?.status).toBe('unsupported');
  });

  /**
   * **답변 층 (사용자 선택 2, 2026-09-11).** "특징 설명"·"연구 분야" 같은 물음은 목록이 답이 아니다.
   * 첫 변환에서 모델이 `wants: answer` 를 정하면, 조회 결과를 모델에게 주고 요약을 받는다.
   * 선: **조회 결과만 근거로**, 없는 것은 없다고. 페이지는 "모델의 요약 — 원본은 아래" 로 표시한다.
   */
  it('wants=answer 면 조회 결과를 모델에게 주고 요약을 받는다 — 근거 레코드가 프롬프트에 실린다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"search","args":{"investigator":"Min-Gul Kim","registry":["ctgov"]},"wants":"answer"}'))
      .mockResolvedValueOnce(llmRes('주로 건강인 대상 약동학 시험이다 [CTGOV:A].'));
    const call = (async () => ({ content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total: 2 }], warnings: [],
      data: [{ id: 'CTGOV:A', title: 'PK of X in healthy adults', status: 'completed', phase: ['phase_1'], studyType: 'interventional', conditions: ['Healthy'], sponsor: { lead: 'CKD' } }, { id: 'CTGOV:B', title: 'BE of Y', status: 'completed', phase: ['phase_1'] }] } } })) as unknown as Parameters<typeof ask>[3];
    // 영문 이름으로 묻는다 — 한국어 이름은 이제 문장에서 잡혀 이름 경로로 가므로(별도 테스트) 이 테스트의 관심사가 아니다.
    const r = await ask({ q: 'Min-Gul Kim 이 한 임상시험 특징 설명', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    expect(r.status).toBe(200);
    const b = r.body as { answer?: { text: string; basedOn: number; model: string }; envelope: { data: unknown[] } };
    expect(b.answer?.text).toMatch(/약동학/);
    expect(b.answer?.basedOn).toBe(2);
    expect(b.envelope.data).toHaveLength(2);   // 원본은 그대로 간다
    // 두 번째 호출: 레코드가 근거로 실리고, 지어내지 말라고 지시한다
    const [, init] = f.mock.calls[1]! as unknown as [string, RequestInit];
    const msgs = (JSON.parse(init.body as string) as { messages: { role: string; content: string }[] }).messages;
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('CTGOV:A');
    expect(all).toContain('PK of X in healthy adults');
    expect(all).toMatch(/없다|모른다/);
    expect(all).toContain('Min-Gul Kim 이 한 임상시험 특징 설명');
  });

  it('wants 가 list 거나 없으면 요약하지 않는다 — LLM 은 한 번만', async () => {
    const f = llm('{"tool":"search","args":{"condition":"melanoma"},"wants":"list"}');
    const call = (async () => ({ content: [], structuredContent: { exitCode: 0, envelope: { registries: [], warnings: [], data: [{ id: 'CTGOV:A' }] } } })) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '흑색종', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    expect((r.body as { answer?: unknown }).answer).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('요약 모델이 실패해도 결과는 나간다 — 요약이 실패했다고만 적는다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"search","args":{"condition":"x"},"wants":"answer"}'))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const call = (async () => ({ content: [], structuredContent: { exitCode: 0, envelope: { registries: [], warnings: [], data: [{ id: 'CTGOV:A' }] } } })) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '특징', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    expect(r.status).toBe(200);
    const b = r.body as { answer?: { text?: string; error?: string }; envelope: { data: unknown[] } };
    expect(b.envelope.data).toHaveLength(1);
    expect(b.answer?.error).toBeTruthy();
    expect(b.answer?.text).toBeUndefined();
  });

  it('시스템 프롬프트가 wants 를 설명한다 — 목록과 답변을 가른다', () => {
    expect(systemPrompt('search')).toMatch(/wants/);
    expect(systemPrompt('search')).toMatch(/answer/);
  });

  /**
   * **한국어 이름은 어느 도구로 왔든 이름 경로로.** 실측(2026-09-11, 공개 서버): 같은 문장을 모델이
   * 회차마다 `names` 로도, `search` 에 한국어 이름을 그대로 넣어서도 분류했다. 후자면 ctgov 에 "김민걸"
   * 을 그대로 물어 **0건** → 빈 화면. 분류가 흔들려도 결과가 흔들리면 안 된다. investigator 에 한글이
   * 있으면 nameOnly 로 돌린다.
   */
  it('search 에 한국어 이름이 오면 — nameOnly 로 돌린다(0건이 되지 않는다)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"search","args":{"investigator":"김민걸","registry":["ctgov","isrctn","ctis","cris"]}}'))
      .mockResolvedValueOnce(llmRes('["Min-Gul Kim"]'));
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const call = (async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      const reg = (args.registry as string[])[0];
      if (reg === 'cris') return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'cris', status: 'ok', total: 1 }], warnings: [], data: [{ id: 'CRIS:K1', contacts: [{ name: 'Min-Gul Kim', role: '연구책임자' }] }] } } };
      if (reg === 'isrctn') return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'isrctn', status: 'ok', total: 0 }], warnings: [], data: cmd === 'count' ? { total: 0 } : [] } } };
      const total = args.investigator === 'Min-Gul Kim' ? 1 : 0;
      return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total }], warnings: [], data: cmd === 'count' ? { total } : total ? [{ id: 'CTGOV:A' }] : [] } } };
    }) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '김민걸 교수 연구', intent: 'search' }, { ...withKey(), CTREG_CRIS_MIRROR_URL: 'https://kctis.example.test' }, f as unknown as typeof fetch, call);
    const b = r.body as { exitCode: number; resolved: { via?: string }; envelope: { data: { id: string }[] } };
    // 모델이 search 라 했어도 이름 경로로 갔다 — ctgov 에 "김민걸" 을 그대로 묻지 않았다
    expect(calls.some((c) => c.args.investigator === '김민걸' && (c.args.registry as string[])[0] === 'ctgov')).toBe(false);
    expect(b.resolved.via).toMatch(/name_only/);
    expect(b.envelope.data.map((x) => x.id).sort()).toEqual(['CRIS:K1', 'CTGOV:A']);
  });

  /**
   * **문장에서 직접 잡는다.** 0.11.2 의 investigator 검사로도 3회 중 1회가 0건이었다(실측, 공개 서버) —
   * 모델이 이름을 로마자로 옮기거나 term 에 넣는 회차가 있다. 모델 출력을 좇아 막는 건 끝이 없다.
   * "○○○ 교수/박사/연구자/선생" 이 문장에 있으면 모델이 뭐라 했든 그 이름으로 이름 경로.
   */
  it('문장에 "○○○ 교수" 가 있으면 모델이 로마자로 옮겨도 이름 경로다', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"search","args":{"investigator":"Kim Min-Gul","registry":["ctgov"]},"wants":"answer"}'))
      .mockResolvedValueOnce(llmRes('["Min-Gul Kim"]'))
      .mockResolvedValueOnce(llmRes('요약'));
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const call = (async (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args });
      const reg = (args.registry as string[])[0];
      const total = reg === 'cris' || args.investigator === 'Min-Gul Kim' ? 1 : 0;
      return { content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: reg, status: 'ok', total }], warnings: [], data: cmd === 'count' ? { total } : total ? [{ id: reg + ':X', contacts: [{ name: 'Min-Gul Kim', role: '연구책임자' }] }] : [] } } }; }) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '김민걸 교수의 임상시험 특징 설명', intent: 'search' }, { ...withKey(), CTREG_CRIS_MIRROR_URL: 'https://kctis.example.test' }, f as unknown as typeof fetch, call);
    const b = r.body as { resolved: { via?: string; args: Record<string, unknown> }; envelope: { data: unknown[] }; answer?: unknown };
    expect(b.resolved.via).toMatch(/name_only/);
    expect(b.resolved.args.korean_name).toBe('김민걸');
    expect(calls.some((c) => c.args.investigator === 'Kim Min-Gul')).toBe(false);   // 모델의 로마자는 버렸다
    expect(b.envelope.data.length).toBeGreaterThan(0);
    expect(b.answer).toBeDefined();   // wants=answer 는 그대로 존중한다
  });

  it('문장의 이름 잡기 — 교수·박사·연구자·선생, 조사가 붙어도', () => {
    expect(koreanPersonInQuery('김민걸 교수의 임상시험')).toBe('김민걸');
    expect(koreanPersonInQuery('이순신박사가 한 연구')).toBe('이순신');
    expect(koreanPersonInQuery('홍길동 연구자')).toBe('홍길동');
    expect(koreanPersonInQuery('당뇨병 3상 시험')).toBeUndefined();
    expect(koreanPersonInQuery('전북대학교병원 교수 연구')).toBeUndefined();   // 기관은 이름이 아니다
  });

  it('count 에 한국어 이름이 와도 nameOnly 로', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(llmRes('{"tool":"count","args":{"investigator":"홍길동"}}'))
      .mockResolvedValueOnce(llmRes('["Gil-Dong Hong"]'));
    const call = (async (cmd: string, args: Record<string, unknown>) => ({ content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: (args.registry as string[])[0], status: 'ok', total: 0 }], warnings: [], data: cmd === 'count' ? { total: 0 } : [] } } })) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: '홍길동 몇 건', intent: 'count' }, withKey(), f as unknown as typeof fetch, call);
    expect((r.body as { resolved: { via?: string } }).resolved.via).toMatch(/name_only/);
  });

  it('영문 이름이 investigator 면 nameOnly 로 돌리지 않는다 — 그건 등록된 표기다', async () => {
    const f = llm('{"tool":"search","args":{"investigator":"Antoni Ribas","registry":["ctgov"]}}');
    const call = (async () => ({ content: [], structuredContent: { exitCode: 0, envelope: { registries: [{ registry: 'ctgov', status: 'ok', total: 18 }], warnings: [], data: [{ id: 'CTGOV:X' }] } } })) as unknown as Parameters<typeof ask>[3];
    const r = await ask({ q: 'Antoni Ribas', intent: 'search' }, withKey(), f as unknown as typeof fetch, call);
    expect((r.body as { resolved: { via?: string } }).resolved.via).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);   // 로마자 후보를 다시 물을 이유가 없다
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
