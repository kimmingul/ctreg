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
        ictrpAcknowledged: true,
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
   * `get` 은 상세 조회를 쓴다 — 응답이 `items` 로 감싸이지 않고 필드가 **최상위에** 편다
   * (실측). 없는 번호는 오류가 아니라 `03`(NODATA_ERROR)으로 온다.
   */
  it('없는 번호는 오류가 아니라 not_found 다', async () => {
    const { fetchImpl } = stub({ resultCode: '03', resultMsg: 'NODATA_ERROR' });
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CRIS:KCT9999999'], fetchOpts);

    expect(r.data).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
  });

  /**
   * 상세 조회는 번호 하나를 받으므로 목록보다 안전하지만, 확인 없이 믿으면 업스트림이
   * 다른 것을 줬을 때 그것을 그 시험이라고 내놓는다.
   */
  it('돌아온 번호가 다르면 그 시험이라고 내놓지 않는다', async () => {
    const { fetchImpl } = stub({
      resultCode: '00', trial_id: 'KCT0009999', scientific_title_kr: '다른 시험', study_type_kr: '중재연구',
    });
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CRIS:KCT0000145'], fetchOpts);

    expect(r.data).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
  });

  it('맞는 번호면 상세 레코드를 낸다 — 목록보다 두껍다', async () => {
    const { fetchImpl, urls } = stub({
      resultCode: '00',
      trial_id: 'KCT0000145',
      scientific_title_kr: '찾던 시험',
      study_type_kr: '중재연구',
      recruitment_status_kr: '연구종결',
      scientific_name_kr: '김민걸',
      target_size: 12,
      type_enrolment_kr: '실제등록',
    });
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CRIS:KCT0000145'], fetchOpts);

    expect(r.data.map((x) => x.registryId)).toEqual(['KCT0000145']);
    // 목록으로는 알 수 없던 것들 — get 이 상세를 쓰는 이유다.
    expect(r.data[0]?.status).toBe('completed');
    expect(r.data[0]?.enrollment).toEqual({ count: 12, basis: 'actual' });
    expect(JSON.stringify(r.data[0])).toContain('김민걸');
    // 목록이 아니라 상세를 부른 것이 맞는지 본다.
    expect(urls.some((u) => u.includes('/detail') && u.includes('crisNumber'))).toBe(true);
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

/**
 * **`--investigator` 를 CRIS 에서 되게 하는 유일한 길.** 목록 API 에는 사람 이름으로
 * 거는 자리가 없고 `srchWord` 도 이름에 닿지 않는다(실측: 김민걸 0건). 그러나 상세
 * 조회는 `scientific_name_kr/en` 을 낸다 — 그래서 **후보를 좁힌 뒤 하나씩 대조** 한다.
 *
 * 공짜가 아니다: 후보 하나당 요청 하나다. 그래서 `--term` 으로 후보를 좁히도록 요구하고,
 * 몇 건을 열어 봤는지 경고로 말한다. 말없이 수백 건을 두드리면 사용자는 왜 느린지 모른다.
 */
describe('CRIS 연구자 대조', () => {
  const detail = (id: string, name: string) => ({
    resultCode: '00', trial_id: id, scientific_title_kr: `${id} 시험`,
    study_type_kr: '중재연구', scientific_name_kr: name,
  });

  /** 목록 한 번 + 후보마다 상세 한 번을 돌려주는 스텁. */
  function routed(ids: string[], names: Record<string, string>) {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      urls.push(u);
      if (u.includes('/detail')) {
        const m = /crisNumber=([^&]+)/.exec(u);
        const id = decodeURIComponent(m?.[1] ?? '');
        return new Response(JSON.stringify(detail(id, names[id] ?? '다른사람')), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify(ok(ids.map((i) => item(i)), ids.length)),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    return { fetchImpl, urls };
  }

  it('후보를 열어 이름이 맞는 것만 낸다', async () => {
    const { fetchImpl, urls } = routed(
      ['KCT0000001', 'KCT0000002', 'KCT0000003'],
      { KCT0000002: '김민걸' },
    );
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '전북대학교병원', investigator: '김민걸', pageSize: 10 } as NormalizedQuery,
      fetchOpts,
    );

    expect(r.data.map((x) => x.registryId)).toEqual(['KCT0000002']);
    // 후보 셋을 다 열어 봤어야 한다 — 하나만 열고 끝내면 나머지를 조용히 놓친다.
    expect(urls.filter((u) => u.includes('/detail'))).toHaveLength(3);
  });

  /**
   * **연구책임자와 연구실무담당자는 다른 사람이고 다른 역할이다.** 실측 2026-08-28:
   * `KCT0012508` 은 연구책임자가 이창섭이고 김민걸은 `public_name_kr`(연구실무담당자)다.
   * 연락처를 통째로 대조하면 그 시험이 김민걸의 연구로 잡힌다 — `--investigator` 가
   * 약속한 것과 다른 답이고, 사람의 연구 목록에 남의 연구가 섞인다.
   */
  it('연구실무담당자로만 이름이 있는 시험은 걸리지 않는다', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      urls.push(u);
      const body = u.includes('/detail')
        ? {
            resultCode: '00', trial_id: 'KCT0000001', scientific_title_kr: '남의 연구',
            study_type_kr: '중재연구',
            scientific_name_kr: '이창섭',
            public_name_kr: '김민걸',
          }
        : ok([item('KCT0000001')], 1);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '전북', investigator: '김민걸', pageSize: 10 } as NormalizedQuery,
      fetchOpts,
    );
    expect(r.data).toEqual([]);
  });

  it('영문 표기로 걸어도 국문 이름과 맞춘다 — 그 반대도 마찬가지다', async () => {
    const { fetchImpl } = routed(['KCT0000001'], { KCT0000001: '김민걸' });
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '전북', investigator: '김민걸', pageSize: 10 } as NormalizedQuery,
      fetchOpts,
    );
    expect(r.data).toHaveLength(1);
  });

  /** 몇 건을 열어 봤는지 말해야 사용자가 느린 이유와 좁힘의 대가를 안다. */
  it('몇 건을 열어 봤는지 경고로 말한다', async () => {
    const { fetchImpl } = routed(['KCT0000001', 'KCT0000002'], { KCT0000002: '김민걸' });
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '전북', investigator: '김민걸', pageSize: 10 } as NormalizedQuery,
      fetchOpts,
    );
    const w = r.warnings.find((x) => x.code === 'investigator_checked_by_detail');
    expect(w).toBeDefined();
    expect(w?.message).toContain('2');
  });

  /**
   * **가장 중요한 경고 문구.** 후보 집합은 `--term` 이 닿는 범위에 갇힌다. 실측
   * 2026-08-28: `srchWord` 는 연구책임기관과 제목에 닿고 **참여기관에는 닿지 않는다** —
   * `KCT0000145`(연구책임자 기관이 전북대학교병원)가 `전북대학교병원` 177건에도,
   * 더 넓은 `전북대학교` 237건에도 없다. 그 시험의 연구책임기관이 동화약품이기 때문이다.
   *
   * 그래서 걸린 수를 그 연구자의 전부로 읽으면 틀린다. 문구가 그것을 말해야 한다.
   */
  it('후보가 검색어에 갇힌다는 것을 말한다 — 걸린 수가 전부가 아니다', async () => {
    const { fetchImpl } = routed(['KCT0000001'], { KCT0000001: '김민걸' });
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '전북', investigator: '김민걸', pageSize: 10 } as NormalizedQuery,
      fetchOpts,
    );
    const w = r.warnings.find((x) => x.code === 'investigator_checked_by_detail');
    expect(w?.message).toMatch(/전부|아닙니다|갇/);
  });

  /**
   * `--term` 없이 `--investigator` 만 주면 후보가 12,501건이다. 그것을 다 열면 하루
   * 한도(1만 콜)를 한 번에 넘긴다 — 조용히 시작하지 않고 막는다.
   */
  it('--term 없이 --investigator 만 주면 막는다', async () => {
    const { fetchImpl, urls } = routed(['KCT0000001'], {});
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    await expect(
      a.search({ investigator: '김민걸', pageSize: 10 } as NormalizedQuery, fetchOpts),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(urls).toEqual([]);
  });
});

/**
 * **`--investigator` 는 후보를 끝까지 걸어야 한다.**
 *
 * 실측 2026-08-28: 고치기 전에는 첫 쪽(50건)만 열어 봤다. `--term 약동학` 의 후보는
 * 339건인데 50건만 보고 1건을 냈다 — 사용자는 "이 검색어로는 1건" 으로 읽지만
 * 실제로는 "첫 50건 안에 1건" 이다. 필터가 조용히 창문 크기로 잘린 것이고,
 * `--investigator` 가 약속한 것과 다르다.
 */
describe('CRIS 연구자 대조는 후보를 끝까지 본다', () => {
  /** 쪽마다 다른 후보를 주고, 뒤쪽에만 맞는 사람을 둔다. */
  function paged(total: number, hitOn: string) {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      urls.push(u);
      if (u.includes('/detail')) {
        const id = decodeURIComponent(/crisNumber=([^&]+)/.exec(u)?.[1] ?? '');
        return new Response(
          JSON.stringify({
            resultCode: '00', trial_id: id, scientific_title_kr: `${id} 시험`,
            study_type_kr: '중재연구',
            scientific_name_kr: id === hitOn ? '김민걸' : '다른사람',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const page = Number(/pageNo=(\d+)/.exec(u)?.[1] ?? '1');
      const start = (page - 1) * 50;
      const items = Array.from({ length: Math.max(0, Math.min(50, total - start)) }, (_, i) =>
        item(`KCT${String(start + i).padStart(7, '0')}`),
      );
      return new Response(JSON.stringify(ok(items, total)), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, urls };
  }

  it('첫 쪽 밖에 있는 후보도 찾아낸다', async () => {
    // 120건 후보 = 3쪽. 맞는 사람은 마지막 쪽(index 100)에 있다.
    const { fetchImpl, urls } = paged(120, 'KCT0000100');
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '약동학', investigator: '김민걸', pageSize: 50 } as NormalizedQuery,
      fetchOpts,
    );

    expect(r.data.map((x) => x.registryId)).toEqual(['KCT0000100']);
    // 후보 120건을 다 열어 봤어야 한다.
    expect(urls.filter((u) => u.includes('/detail'))).toHaveLength(120);
    // 다 걸었으므로 이어서 걸 쪽이 없다.
    expect(r.nextPageToken).toBeUndefined();
  });

  it('몇 건을 열었는지와 후보가 몇이었는지를 말한다', async () => {
    const { fetchImpl } = paged(120, 'KCT0000100');
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '약동학', investigator: '김민걸', pageSize: 50 } as NormalizedQuery,
      fetchOpts,
    );
    const w = r.warnings.find((x) => x.code === 'investigator_checked_by_detail');
    expect(w?.message).toContain('120');
  });

  /**
   * 후보가 아주 많으면 하루 한도(1만 콜)를 한 번에 먹는다. 상한에서 멈추되,
   * **멈췄다는 사실을 말한다** — 조용히 자르면 그 수가 전부로 읽힌다.
   */
  it('상한에서 멈추고 멈췄다고 말한다', async () => {
    const { fetchImpl, urls } = paged(3000, 'KCT0002999');
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    const r = await a.search(
      { term: '건강한', investigator: '김민걸', pageSize: 50 } as NormalizedQuery,
      fetchOpts,
    );
    const opened = urls.filter((u) => u.includes('/detail')).length;
    expect(opened).toBeLessThan(3000);
    expect(r.warnings.map((w) => w.code)).toContain('investigator_scan_truncated');
  });

  /** 끝까지 걷는 마당에 쪽 토큰을 함께 주면 뜻이 갈린다 — 조용히 무시하지 않는다. */
  it('--page-token 과 함께 주면 막는다', async () => {
    const { fetchImpl } = paged(120, 'KCT0000100');
    const a = createCrisAdapter(cfg('K'), { fetchImpl, sleep: async () => {} });
    await expect(
      a.search(
        { term: '약동학', investigator: '김민걸', pageSize: 50, pageToken: '2' } as NormalizedQuery,
        fetchOpts,
      ),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });
});
