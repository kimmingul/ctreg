import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCriteria, createCtisAdapter } from '../../../src/adapters/ctis/adapter.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../../src/core/query.js';
import type { CtregError } from '../../../src/runtime/errors.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off',
  raw: false,
};

const cfg = () => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ctis-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
  crisBaseUrl: 'https://cris.example.test',
  ctisBaseUrl: 'https://ctis.example.test',
  ictrpAcknowledged: true,
});

/** 나간 본문을 남기는 스텁 — 무엇을 보냈는지 봐야 하는 검사가 여럿이다. */
function stub(bodies: string[] = []) {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    return new Response(
      JSON.stringify({ pagination: { totalRecords: 1, nextPage: false }, data: [{ ctNumber: 'X', ctTitle: 'T' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe('CTIS 어댑터', () => {
  /**
   * **모르는 나라 이름을 그대로 보내면 0건이 온다**(실측: 이름·알파벳 코드 전부 0건).
   * 그러면 사용자는 "그 나라에 그런 시험이 없다" 로 읽는다 — 이 CLI 가 없애려는 혼동이다.
   * 넘기지 않고 막고, 아는 이름을 제안한다.
   */
  it('모르는 나라 이름은 exit 3 으로 막고 아는 이름을 제안한다', async () => {
    const { fetchImpl, bodies } = stub();
    const a = createCtisAdapter(cfg(), { fetchImpl, sleep: async () => {} });
    try {
      await a.search({ condition: 'x', location: '대한민국', pageSize: 10 } as NormalizedQuery, fetchOpts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as CtregError;
      expect(err.exit).toBe(EXIT.UNSUPPORTED);
      expect(`${err.message} ${err.hint ?? ''}`).toContain('Spain');
    }
    // 막았다면서 두드리면 막은 것이 아니다.
    expect(bodies).toEqual([]);
  });

  it('아는 나라 이름은 숫자 코드로 바뀌어 나간다 — 이름 그대로 보내면 0건이다', () => {
    const crit = buildCriteria({ condition: 'x', location: 'Spain' } as NormalizedQuery);
    expect(crit.msc).toEqual(['724']);
    expect(JSON.stringify(crit)).not.toContain('Spain');
  });

  /** 조건 없이 부르면 전체 12,317건의 첫 쪽이 온다 — 그것을 검색 결과라고 내보내면 안 된다. */
  it('조건이 하나도 없으면 검색하지 않는다', async () => {
    const { fetchImpl, bodies } = stub();
    const a = createCtisAdapter(cfg(), { fetchImpl, sleep: async () => {} });
    await expect(a.search({ pageSize: 10 } as NormalizedQuery, fetchOpts)).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(bodies).toEqual([]);
  });

  /**
   * 이 API 는 모르는 키를 조용히 버린다(실측). 그러므로 **보내지 않는 것** 이 중요하다 —
   * 보내 놓고 무시당하면 우리는 걸렀다고 믿고 사용자는 좁혀진 답을 받았다고 믿는다.
   */
  it('실제로 거르지 않는 키를 보내지 않는다', () => {
    const crit = buildCriteria({
      condition: 'x', term: 't', title: 'ti', sponsor: 's',
      phase: ['phase_3'], status: ['recruiting'], studyType: 'interventional',
      intervention: 'aspirin', id: 'NCT1',
    } as NormalizedQuery);
    expect(Object.keys(crit).sort()).toEqual(['containAll', 'medicalCondition', 'sponsor', 'title']);
  });
});

/**
 * **`get` 은 상세 조회를 쓴다.** 검색으로도 한 건을 집을 수 있지만(자유 텍스트에 번호),
 * 상세가 훨씬 두껍다 — 문자열 상태, 구조화된 질환, 의뢰기관 조직명, 참여국.
 * `ctreg` 에서 `get` 이 `search` 보다 충실해야 한다는 규율이 여기에도 적용된다.
 */
describe('CTIS get 은 상세를 쓴다', () => {
  const detail = {
    ctNumber: 'CT1',
    ctStatus: 'Ended',
    authorizedApplication: {
      authorizedPartI: {
        trialDetails: { clinicalTrialIdentifiers: { publicTitle: '공개 제목', fullTitle: '정식 제목' } },
        medicalConditions: [{ medicalCondition: '어떤 질환' }],
        rowSubjectCount: 42,
      },
      memberStatesConcerned: [{ mscName: 'Spain' }],
    },
  };

  function routed(body: unknown, urls: string[] = []) {
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { fetchImpl, urls };
  }

  it('retrieve 를 부르고 상세 레코드를 낸다', async () => {
    const { fetchImpl, urls } = routed(detail);
    const a = createCtisAdapter(cfg(), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CTIS:CT1'], fetchOpts);

    expect(r.data.map((x) => x.registryId)).toEqual(['CT1']);
    // 검색만으로는 알 수 없던 것들 — get 이 상세를 쓰는 이유다.
    expect(r.data[0]?.statusRaw).toBe('Ended');
    expect(r.data[0]?.conditions).toEqual(['어떤 질환']);
    expect(r.data[0]?.enrollment?.count).toBe(42);
    expect(urls.some((u) => u.includes('/retrieve/CT1'))).toBe(true);
  });

  /** 없는 번호는 오류가 아니라 빈 응답이 온다(실측: HTTP 200, 본문 `{}`). */
  it('빈 응답은 not_found 다 — 오류로 다루지 않는다', async () => {
    const { fetchImpl } = routed({});
    const a = createCtisAdapter(cfg(), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CTIS:CT404'], fetchOpts);

    expect(r.data).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
  });

  /** 업스트림이 다른 것을 줬을 때 그것을 그 시험이라고 내놓지 않는다. */
  it('돌아온 번호가 다르면 내놓지 않는다', async () => {
    const { fetchImpl } = routed({ ...detail, ctNumber: 'OTHER' });
    const a = createCtisAdapter(cfg(), { fetchImpl, sleep: async () => {} });
    const r = await a.get(['CTIS:CT1'], fetchOpts);

    expect(r.data).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('not_found');
  });
});
