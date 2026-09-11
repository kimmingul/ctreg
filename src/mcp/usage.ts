import { loadConfig } from '../runtime/config.js';
import type { ApiResponse } from './web.js';

/**
 * AI 사용량 — 사용자의 Ollama Cloud 계정이 서버 키로 붙어 있으니 얼마나 썼는지가 페이지에 보여야
 * 한다. `GET https://ollama.com/api/usage` 는 문서에 없지만 키로 200 을 낸다(실측 2026-09-11):
 * `limits.session.usage` · `limits.weekly.usage` 가 0~1 비율이다.
 *
 * **비율 둘만 내보낸다.** 모델 이름·요청 수·비용·기간은 페이지에 필요 없고, 남의 계정 정보를
 * 공개 페이지에 흘릴 이유가 없다. 60초 캐시 — 페이지가 열릴 때마다 남의 서버를 두드리지 않는다.
 */
export type Usage = { session: number; weekly: number; at: string };

const TTL_MS = 60_000;
let cache: { at: number; body: Usage } | undefined;
export function _resetUsageCache(): void { cache = undefined; }

export async function usage(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<ApiResponse> {
  const cfg = loadConfig(env);
  if (!cfg.llmApiKey) return { status: 501, body: { error: 'ai_mode_off' } };
  if (cache && Date.now() - cache.at < TTL_MS) return { status: 200, body: cache.body };
  // /v1/... 가 OpenAI 호환 자리이고 usage 는 /api/usage 다 — base URL 의 /v1 을 떼고 붙인다.
  const origin = (cfg.llmBaseUrl ?? 'https://ollama.com/v1').replace(/\/+$/, '').replace(/\/v1$/, '');
  try {
    const res = await fetchImpl(`${origin}/api/usage`, { headers: { authorization: `Bearer ${cfg.llmApiKey}` } });
    if (!res.ok) return { status: 502, body: { error: 'usage_http', message: `사용량 조회가 ${res.status} 를 냈다.` } };
    const j = (await res.json()) as { limits?: { session?: { usage?: number }; weekly?: { usage?: number } } };
    const session = j.limits?.session?.usage;
    const weekly = j.limits?.weekly?.usage;
    if (typeof session !== 'number' || typeof weekly !== 'number') return { status: 502, body: { error: 'usage_shape', message: '사용량 응답의 모양이 달라졌다.' } };
    const body: Usage = { session, weekly, at: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return { status: 200, body };
  } catch (e) {
    return { status: 502, body: { error: 'usage_unreachable', message: (e as Error).message } };
  }
}
