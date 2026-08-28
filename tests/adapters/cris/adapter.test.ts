import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCrisAdapter } from '../../../src/adapters/cris/adapter.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../../src/core/query.js';
import type { CtregError } from '../../../src/runtime/errors.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off',
  raw: false,
};

const cfg = (key?: string) => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-cris-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
  crisBaseUrl: 'https://cris.example.test',
  ...(key !== undefined ? { crisServiceKey: key } : {}),
});

/** 나간 URL 을 남기는 스텁. 무엇을 보냈는지 봐야 하는 검사가 여럿이다. */
function stub(body: unknown, urls: string[] = []) {
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

const item = (id: string, title = '어떤 연구') => ({
  trial_id: id,
  scientific_title_kr: title,
  study_type_kr: '중재연구',
  date_registration: '2024-01-01',
});

const ok = (items: unknown[], totalCount = items.length) => ({
  resultCode: '00', resultMsg: 'NORMAL_SERVICE', totalCount, items,
});

describe('CRIS 어댑터', () => {
  /**
   * **공공데이터포털은 실패도 HTTP 200 으로 낸다.** 본문의 `resultCode` 가 진짜
   * 결과다. 그것을 안 보면 인증 실패·한도 초과가 전부 "0건" 으로 읽힌다 — 이 CLI 가
   * 없애려는 실패 그 자체이고, 키를 잘못 넣은 사용자가 "그런 연구가 없다" 로 오해한다.
   */
  it('resultCode 가 정상이 아니면 던진다 — 조용한 0건이 되지 않는다', async () => {
    const a = createCrisAdapter(cfg('K'), {
      ...stub({ resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' }),
      sleep: async () => {},
    });
    await expect(a.search({ term: '당뇨병', pageSize: 10 } as NormalizedQuery, fetchOpts)).rejects.toMatchObject({
      code: 'upstream',
    });
  });

  it('한도 초과는 키 문제와 다른 안내를 낸다', async () => {
    const a = createCrisAdapter(cfg('K'), {
      ...stub({ resultCode: '22', resultMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR' }),
      sleep: async () => {},
    });
    try {
      await a.count({ term: '당뇨병', pageSize: 10 } as NormalizedQuery, fetchOpts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).hint).toContain('한도');
    }
  });

  /**
   * 인증키가 실패 메시지로 새면, 사용자가 그 JSON 을 이슈에 붙이는 순간 유출이다.
   * 가리는 장치는 http.ts 에 있고 — **이 어댑터가 그것을 실제로 켰는지** 를 여기서 본다.
   */
  it('실패 메시지에 인증키를 싣지 않는다', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const a = createCrisAdapter(cfg('SUPERSECRET123'), { fetchImpl: failing, sleep: async () => {} });
    try {
      await a.search({ term: '당뇨병', pageSize: 10 } as NormalizedQuery, fetchOpts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as CtregError;
      expect(`${err.message} ${err.hint ?? ''}`).not.toContain('SUPERSECRET123');
    }
  });

  /**
   * **검색어 없이 부르면 전체의 첫 쪽이 온다.** 그것을 검색 결과로 내보내면 사용자는
   * 자기 질의가 통한 줄 안다 — 12,501건 중 앞 열 건을 답이라고 내놓는 셈이다.
   */
  it('--term 없이는 검색하지 않는다 — 전체 첫 쪽을 결과라고 내지 않는다', async () => {
    const { fetchImpl, urls } = stub(ok([item('KCT0000001')], 12501));
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    try {
      await a.search({ pageSize: 10 } as NormalizedQuery, fetchOpts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.UNSUPPORTED);
    }
    // 던지기만 하고 끝나면 안 된다 — 요청을 보내지도 않아야 한다.
    expect(urls).toEqual([]);
  });

  /**
   * 이 API 에는 ID 로 한 건을 집는 자리가 없어 검색으로 대신한다. 검색은 번호를 부분
   * 일치로도 물 수 있으므로, **대조 없이 첫 건을 내면 다른 시험을 그 시험이라고 내놓는다.**
   */
  it('get 은 돌아온 등록번호를 대조한다 — 첫 건을 그냥 집지 않는다', async () => {
    const { fetchImpl } = stub(ok([item('KCT0009999', '다른 시험')]));
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CRIS:KCT0000145'], fetchOpts);

    expect(r.data).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
  });

  it('get 은 맞는 번호를 찾으면 그 레코드를 낸다', async () => {
    const { fetchImpl } = stub(ok([item('KCT0009999', '다른 시험'), item('KCT0000145', '찾던 시험')]));
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CRIS:KCT0000145'], fetchOpts);

    expect(r.data.map((x) => x.registryId)).toEqual(['KCT0000145']);
    expect(r.data[0]?.title).toBe('찾던 시험');
  });

  /**
   * 키가 없을 때 **생성 시점에 던지면** CRIS 를 부르지도 않은 사용자의
   * `--registry ctgov` 조회까지 같이 죽는다. 키가 필요한 것은 요청을 보낼 때다.
   */
  it('키가 없어도 어댑터는 만들어지고, 부를 때에야 말한다', async () => {
    const { fetchImpl } = stub(ok([item('KCT0000145')]));
    const a = createCrisAdapter(cfg(undefined), { fetchImpl, sleep: async () => {} });
    expect(a.capability().key).toBe('cris');
    await expect(a.count({ term: '당뇨병', pageSize: 10 } as NormalizedQuery, fetchOpts)).rejects.toMatchObject({
      code: 'upstream',
    });
  });

  /** 남은 쪽이 있을 때만 토큰을 낸다. 끝을 넘긴 쪽은 오류가 아니라 빈 목록이 온다(실측). */
  it('남은 것이 있을 때만 다음 쪽 토큰을 낸다', async () => {
    const many = Array.from({ length: 50 }, (_, i) => item(`KCT000${String(i).padStart(4, '0')}`));
    const a = createCrisAdapter(cfg('K'), { ...stub(ok(many, 120)), sleep: async () => {} });
    const first = await a.search({ term: '당뇨병', pageSize: 50 } as NormalizedQuery, fetchOpts);
    expect(first.nextPageToken).toBe('2');

    const b = createCrisAdapter(cfg('K'), { ...stub(ok(many, 50)), sleep: async () => {} });
    const only = await b.search({ term: '당뇨병', pageSize: 50 } as NormalizedQuery, fetchOpts);
    expect(only.nextPageToken).toBeUndefined();
  });
});
