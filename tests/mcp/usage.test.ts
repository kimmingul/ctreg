import { describe, expect, it, vi } from 'vitest';
import { usage, _resetUsageCache } from '../../src/mcp/usage.js';

const env = (key = true) => ({ ...(key ? { CTREG_LLM_API_KEY: 'k' } : {}), CTREG_LLM_BASE_URL: 'https://ollama.example/v1' });
const payload = { activity: { cost: '0.00000' }, limits: { session: { usage: 0.12, models: [{ name: 'm', request_count: 2 }] }, weekly: { usage: 0.009, models: [] } } };
const ok = () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

/**
 * AI 사용량 — 사용자의 Ollama Cloud 계정을 서버 키로 붙여 두었으니, 얼마나 썼는지가 페이지 구석에
 * 보여야 한다. `GET https://ollama.com/api/usage` (문서에 없다 — 실측 2026-09-11) 가 세션·주간 사용
 * 비율을 낸다. 서버가 받아 **비율 둘만** 페이지에 넘긴다 — 모델 이름·비용·계정 정보는 내지 않는다.
 */
describe('AI 사용량', () => {
  it('세션·주간 비율만 낸다 — 모델 목록·비용은 밖으로 안 나간다', async () => {
    _resetUsageCache();
    const f = vi.fn(async () => ok());
    const r = await usage(env(), f as unknown as typeof fetch);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ session: 0.12, weekly: 0.009, at: expect.any(String) });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://ollama.example/api/usage');   // /v1 이 아니라 /api 다
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('키가 없으면 501 — 페이지는 표시를 숨긴다', async () => {
    _resetUsageCache();
    expect((await usage(env(false), vi.fn() as unknown as typeof fetch)).status).toBe(501);
  });

  it('60초 안에는 다시 묻지 않는다 — 페이지가 열릴 때마다 남의 서버를 두드리지 않는다', async () => {
    _resetUsageCache();
    const f = vi.fn(async () => ok());
    await usage(env(), f as unknown as typeof fetch);
    await usage(env(), f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('업스트림이 실패하면 502 — 0% 로 읽히지 않는다', async () => {
    _resetUsageCache();
    const f = vi.fn(async () => new Response('nope', { status: 500 }));
    const r = await usage(env(), f as unknown as typeof fetch);
    expect(r.status).toBe(502);
    expect(r.body).not.toHaveProperty('session');
  });
});
