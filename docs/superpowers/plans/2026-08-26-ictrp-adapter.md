# ICTRP 어댑터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WHO ICTRP 를 `search`·`count` 만 하는 세 번째 레지스트리로 붙인다. 다른 레지스트리와 비교하거나 묶지 않는다.

**Architecture:** ICTRP 는 REST API 가 없고 ASP.NET WebForms 포털만 있다. `AdvSearch.aspx` 를 GET 해 ViewState hidden 필드를 수확하고, 폼 필드를 채워 POST 하고, 결과 HTML 에서 건수와 행을 읽는다. 쿠키는 필요 없다. 캐시·스로틀·재시도는 `http.ts` 의 기존 루프를 공유한다.

**Tech Stack:** TypeScript (ESM, Node 22+), vitest, zod. HTML 파싱은 **의존성을 더하지 않고** 정규식으로 한다 — 필요한 것이 hidden `<input>` 과 결과 `<tr>` 뿐이라 파서를 들일 값이 없다.

**Spec:** `docs/superpowers/specs/2026-08-26-ictrp-as-its-own-registry-design.md`

## Global Constraints

- **주석·문서·테스트 이름은 한국어.** 커밋 제목만 영어 conventional commit.
- **TDD.** 실패를 눈으로 본 뒤에 구현한다. 테스트가 통과해 버리면 그 테스트가 틀린 것이다.
- **사보타주는 고친 함수가 아니라 그 함수를 부르는 자리를 겨눈다.** 이 저장소에서 같은 형태의 구멍이 세 번 났다.
- **없는 값을 지어내지 않는다.** 못 쟀으면 못 쟀다고 주석에 적는다.
- **검사로 만들 수 없는 것을 검사인 척하지 않는다.**
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- 전체 스위트: `npx vitest run` · 타입: `npm run typecheck` · 빌드: `npm run build`
- **네트워크를 타는 테스트를 스위트에 넣지 않는다.** 업스트림 확인은 `scripts/ictrp-field-test.ts` 의 몫이다.

**스펙에서 그대로 옮기는 값 (바꾸지 말 것)**

- 베이스 URL: `https://trialsearch.who.int`, 폼 경로: `/AdvSearch.aspx`
- 폼 필드 접두사: `ctl00$ContentPlaceHolder1$`
- `limits.maxPageSize = 10`, `limits.ratePerSec = 1`
  (**정정 2026-08-26:** 100 은 근거가 없었다. `ddlPageSize` 를 검색 POST 에 실으면 결과가
  0건이 된다 — 그 컨트롤은 결과 페이지에만 있다. 검색 POST 에 **보내지 않는다.**)
- 페이지 크기 컨트롤: `ddlPageSize`, 페이저: `dlPager2$ctlNN$lnkPageNo`
- **`ddlRecruitingStatus` 는 언제나 명시한다** — `--status recruiting` 이면 `1`, 아니면 `ALL`

---

### Task 1: 런타임에 폼 POST

**Files:**
- Modify: `src/runtime/http.ts`
- Test: `tests/runtime/http.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `postForm<T>(cfg, o, deps): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }>`
  where `o: { registry: string; baseUrl: string; path: string; form: Record<string, string>; cacheKeyParams: Record<string, string | number>; cacheMode: CacheMode; ratePerSec: number; decode: (text: string) => T; accept?: string; signal?: AbortSignal }`

`getJson` 의 시그니처와 동작은 바뀌지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/runtime/http.test.ts` 끝에 더한다:

```ts
describe('postForm — 폼 POST', () => {
  /**
   * ICTRP 는 REST API 가 없고 ViewState 폼만 있다. 어댑터가 fetch 를 직접 부르면
   * 캐시·스로틀·재시도·타임아웃을 통째로 다시 구현하게 되고 레지스트리마다 신뢰성이
   * 갈린다 — `decode` 훅이 존재하는 이유와 같은 논거다.
   */
  it('폼을 application/x-www-form-urlencoded 로 POST 한다', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await postForm(cfg(), {
      registry: 'ictrp', baseUrl: 'https://ictrp.example.test', path: '/AdvSearch.aspx',
      form: { a: '1', b: 'x y' },
      cacheKeyParams: { q: 'diabetes' },
      cacheMode: 'off', ratePerSec: 1000,
      decode: (text) => text,
    }, { fetchImpl, sleep: async () => {} });

    expect(res.value).toBe('<html>ok</html>');
    expect(seen.init?.method).toBe('POST');
    expect(String((seen.init?.headers as Record<string, string>)['content-type']))
      .toContain('application/x-www-form-urlencoded');
    expect(String(seen.init?.body)).toBe('a=1&b=x+y');
  });

  /**
   * 캐시 키는 ViewState 가 아니라 **논리 질의** 로 만든다. ViewState 는 요청마다
   * 달라서 그것을 키에 넣으면 캐시가 영원히 미스다.
   */
  it('같은 논리 질의는 ViewState 가 달라도 캐시 히트다', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const c = cfg();
    const base = {
      registry: 'ictrp', baseUrl: 'https://ictrp.example.test', path: '/AdvSearch.aspx',
      cacheKeyParams: { q: 'diabetes' }, cacheMode: 'use' as const, ratePerSec: 1000,
      decode: (t: string) => t,
    };
    await postForm(c, { ...base, form: { __VIEWSTATE: 'AAA' } }, { fetchImpl, sleep: async () => {} });
    const second = await postForm(c, { ...base, form: { __VIEWSTATE: 'BBB' } }, { fetchImpl, sleep: async () => {} });
    expect(calls).toBe(1);
    expect(second.cached).toBe(true);
  });
});
```

`cfg()` 헬퍼가 이 파일에 이미 있는지 확인하고, 없으면 파일 안의 기존 설정 리터럴을 그대로 쓴다.
`postForm` 을 import 목록에 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/runtime/http.test.ts`
Expected: FAIL — `postForm is not a function`

- [ ] **Step 3: 구현한다**

`src/runtime/http.ts` 에서 `getJson` 의 본문 중 **캐시 조회 → 재시도 루프 → 캐시 기록** 부분을
내부 함수로 뽑는다. 요청을 만드는 부분만 달라지므로 그것을 콜백으로 받는다:

```ts
type SharedOpts = {
  registry: string;
  cacheKey: string;
  cacheMode: CacheMode;
  ratePerSec: number;
  signal?: AbortSignal;
};

/**
 * 캐시·스로틀·재시도·타임아웃. `getJson` 과 `postForm` 이 함께 쓴다 — 이 루프가
 * 한 벌이어야 레지스트리마다 신뢰성이 갈리지 않는다. `send` 는 요청을 만드는 부분만
 * 다르므로 콜백으로 받는다.
 */
async function withReliability<T>(
  cfg: Config,
  o: SharedOpts,
  send: (signal: AbortSignal) => Promise<Response>,
  decode: (text: string) => Promise<T> | T,
  deps: HttpDeps,
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  // 기존 getJson 본문을 그대로 옮긴다. doFetch(url, {...}) 부분만 send(signal) 로 바꾼다.
}
```

그다음 `postForm` 을 더한다:

```ts
export type PostFormOpts<T> = {
  registry: string;
  baseUrl: string;
  path: string;
  /** 그대로 폼 인코딩되어 본문이 된다. ViewState 를 포함한다. */
  form: Record<string, string>;
  /**
   * 캐시 키를 만드는 데 쓰는 **논리 질의**. `form` 이 아니라 이것을 쓰는 이유는
   * ViewState 가 요청마다 달라서, 그것을 키에 넣으면 캐시가 영원히 미스이기 때문이다.
   */
  cacheKeyParams: Record<string, string | number>;
  cacheMode: CacheMode;
  ratePerSec: number;
  decode: (text: string) => T;
  accept?: string;
  signal?: AbortSignal;
};

export async function postForm<T>(
  cfg: Config,
  o: PostFormOpts<T>,
  deps: HttpDeps = {},
): Promise<{ value: T; fetchedAt: string; cached: boolean; warnings: Warning[] }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const url = o.baseUrl + o.path;
  const body = new URLSearchParams(o.form).toString();
  return withReliability(
    cfg,
    {
      registry: o.registry,
      cacheKey: cacheKey(o.registry, url, o.cacheKeyParams),
      cacheMode: o.cacheMode,
      ratePerSec: o.ratePerSec,
      ...(o.signal ? { signal: o.signal } : {}),
    },
    (signal) =>
      doFetch(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: o.accept ?? 'text/html',
        },
        body,
      }),
    async (text) => o.decode(text),
    deps,
  );
}
```

`getJson` 도 같은 `withReliability` 를 쓰도록 고친다. **시그니처는 건드리지 않는다.**

- [ ] **Step 4: 통과와 무회귀를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 통과. `getJson` 을 쓰는 기존 테스트가 하나도 빨개지지 않아야 한다 — 빨개지면
루프를 옮기면서 동작을 바꾼 것이다.

- [ ] **Step 5: 사보타주로 확인한다**

`postForm` 의 `method: 'POST'` 를 `'GET'` 으로 바꿔 첫 테스트가 빨개지는지, `cacheKeyParams`
대신 `o.form` 으로 키를 만들어 두 번째 테스트가 빨개지는지 본다. 확인 후 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/runtime/http.ts tests/runtime/http.test.ts
git commit -m "feat(runtime): add form POST sharing the reliability loop with getJson"
```

---

### Task 2: `ictrp` 키 등록과 ID 추론 제외

**Files:**
- Modify: `src/core/registry.ts`
- Test: `tests/core/registry.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `REGISTRY_KEYS` 에 `'ictrp'` 추가. `IdSpec` 에 `inferable: boolean` 필드.
  `parseTrialId('ICTRP:NCT01234567')` → `{ registry: 'ictrp', registryId: 'NCT01234567', id: 'ICTRP:NCT01234567' }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/core/registry.test.ts` 에 더한다(파일이 없으면 만들고, `parseTrialId`·`REGISTRY_KEYS` 를 import):

```ts
describe('ICTRP 의 ID', () => {
  /**
   * ICTRP 의 ID 는 20여 레지스트리의 형식이 섞여 있다(NCT…, ISRCTN…,
   * CTRI/2026/07/113311, JPRN-jRCT…, DRKS…). 접두사를 붙이면 그대로 통과해야 한다 —
   * 슬래시·하이픈이 들어 있어도 마찬가지다.
   */
  it('접두사를 붙이면 어떤 원문 ID 든 받는다', () => {
    for (const raw of ['NCT07749586', 'ISRCTN15819396', 'CTRI/2026/07/113311', 'JPRN-jRCT1031260225', 'DRKS00040777']) {
      const r = parseTrialId(`ICTRP:${raw}`);
      expect(r.registry).toBe('ictrp');
      expect(r.registryId).toBe(raw);
      expect(r.id).toBe(`ICTRP:${raw}`);
    }
  });

  /**
   * **접두사 없이는 절대 ICTRP 로 가지 않는다.** `parseTrialId` 의 추론은
   * `REGISTRY_KEYS.find(...)` 라 배열 순서대로 첫 매치가 이긴다. ICTRP 의 패턴이
   * 관대하면 맨 NCT 번호가 ctgov 대신 ICTRP 로 가거나(기존 호출자 전원의 동작이
   * 조용히 바뀐다), 지금 깔끔하게 exit 2 가 나는 입력이 ICTRP 로 갔다가 0건이 된다.
   */
  it('접두사 없는 ID 는 ICTRP 로 추론되지 않는다', () => {
    expect(parseTrialId('NCT01234567').registry).toBe('ctgov');
    expect(parseTrialId('12345678').registry).toBe('isrctn');
    // ICTRP 만 아는 형식이라도 접두사가 없으면 추론이 아니라 사용법 오류다.
    expect(() => parseTrialId('CTRI/2026/07/113311')).toThrow();
    expect(() => parseTrialId('DRKS00040777')).toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/core/registry.test.ts`
Expected: FAIL — `레지스트리 'ictrp' 어댑터가 없습니다`

- [ ] **Step 3: 구현한다**

`src/core/registry.ts`:

```ts
export const REGISTRY_KEYS = ['ctgov', 'isrctn', 'ictrp'] as const;
```

`IdSpec` 에 필드를 더한다:

```ts
type IdSpec = {
  pattern: RegExp;
  normalize: (s: string) => string;
  /**
   * 접두사 없는 입력을 이 레지스트리로 **추론해도 되는가.**
   *
   * 아래 추론은 `REGISTRY_KEYS.find(...)` 라 배열 순서대로 첫 매치가 이긴다. 자기
   * 형식이 뚜렷한 레지스트리는 안전하지만, **집계 레지스트리는 아니다** — ICTRP 의
   * ID 는 스무 곳의 형식이 섞여 있어 패턴이 관대해질 수밖에 없고, 그러면 맨
   * `NCT01234567` 이 ctgov 대신 그리로 가거나(기존 호출자 전원의 동작이 조용히
   * 바뀐다) 지금 exit 2 가 나는 입력이 0건으로 바뀐다.
   *
   * 매치되지 않는 정규식으로 같은 효과를 낼 수 있지만 그것은 트릭이라, 다음 사람이
   * 버그로 알고 "고칠" 위험이 있다. 이유를 그 자리에 남기는 것이 이 저장소의 규율이다.
   */
  inferable: boolean;
};
```

기존 두 항목에 `inferable: true` 를 더하고 ICTRP 를 추가한다:

```ts
  /**
   * ICTRP 는 집계자라 원문 ID 가 원 레지스트리의 것이다 — `NCT…`, `ISRCTN…`,
   * `CTRI/2026/07/113311`, `JPRN-jRCT…`, `DRKS…`. 형식을 열거할 수 없으므로 패턴은
   * "비어 있지 않은 것" 이고, 그래서 **추론에 참여하지 않는다**(`inferable: false`).
   * `ICTRP:` 접두사가 언제나 필요하다.
   *
   * 귀결: 같은 시험이 `CTGOV:NCT07749586` 과 `ICTRP:NCT07749586` 두 개의 ctreg id 를
   * 갖는다. 「연계하지 않는다」 는 설계의 직접적 귀결이고, 의도된 것이다.
   */
  ictrp: { pattern: /^\S+$/, normalize: (s) => s.trim(), inferable: false },
```

추론 줄을 고친다:

```ts
  const inferred = REGISTRY_KEYS.find(
    (key) => ID_PATTERNS[key].inferable && ID_PATTERNS[key].pattern.test(trimmed),
  );
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 통과.

`registries` 커맨드가 이제 ICTRP 를 "어댑터 없음" 으로 다루는지도 확인한다:

```bash
npm run build && node dist/cli/bin.js registries --format json | grep -c ictrp
```

- [ ] **Step 5: 사보타주로 확인한다**

`inferable` 검사를 추론 줄에서 지운다(`ID_PATTERNS[key].pattern.test(trimmed)` 만 남긴다).
`'접두사 없는 ID 는 ICTRP 로 추론되지 않는다'` 가 빨개져야 한다. 그리고 `REGISTRY_KEYS` 에서
`ictrp` 를 맨 앞으로 옮겨도 그 테스트가 잡는지 본다. 확인 후 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/core/registry.ts tests/core/registry.test.ts
git commit -m "feat(core): register ictrp and keep aggregator ids out of inference"
```

---

### Task 3: 가드가 신고된 값 부분집합을 강제한다

**Files:**
- Modify: `src/cli/guard.ts`
- Test: `tests/cli/guard.test.ts`, `tests/cli/commands.test.ts`

**Interfaces:**
- Consumes: `usedSearchAxes` (이미 있다)
- Produces: `assertSupported` 가 요청 값이 `cap.search[axis].values` 밖이면 exit 3 을 던진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/cli/guard.test.ts` 의 `describe('capability 가드', ...)` 안에 더한다:

```ts
  /**
   * 지금까지 두 어댑터는 닫힌 어휘를 **전부 신고하거나 축을 끄거나** 둘 중 하나였다.
   * ICTRP 는 진부분집합을 신고하는 첫 어댑터다(`status` 는 `['recruiting']` 하나).
   * 그대로 두면 `--status completed` 가 파싱과 가드를 통과한 뒤 필터가 조용히
   * 사라진다 — 이 CLI 가 없애려는 실패 그 자체다.
   */
  it('신고하지 않은 값으로 필터하면 exit 3 이다', () => {
    const subset: Capability = {
      ...CTGOV_CAPABILITY,
      search: {
        ...CTGOV_CAPABILITY.search,
        status: { ...CTGOV_CAPABILITY.search.status, values: ['recruiting'] },
      },
    };
    expect(() => assertSupported(subset, { status: ['recruiting'] }, fetchOpts)).not.toThrow();
    expectUnsupported(() => assertSupported(subset, { status: ['completed'] }, fetchOpts), 'completed');
  });

  it('거절할 때 그 레지스트리가 받는 값을 말한다 — 막기만 하면 복구 경로가 없다', () => {
    const subset: Capability = {
      ...CTGOV_CAPABILITY,
      search: {
        ...CTGOV_CAPABILITY.search,
        status: { ...CTGOV_CAPABILITY.search.status, values: ['recruiting'] },
      },
    };
    try {
      assertSupported(subset, { status: ['completed'] }, fetchOpts);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect(`${(e as CtregError).message} ${(e as CtregError).hint}`).toContain('recruiting');
    }
  });

  it('여러 값 중 하나만 밖이어도 잡는다', () => {
    const subset: Capability = {
      ...CTGOV_CAPABILITY,
      search: {
        ...CTGOV_CAPABILITY.search,
        status: { ...CTGOV_CAPABILITY.search.status, values: ['recruiting'] },
      },
    };
    expectUnsupported(() => assertSupported(subset, { status: ['recruiting', 'completed'] }, fetchOpts), 'completed');
  });

  it('자유 텍스트 축은 이 검사의 대상이 아니다 — values 가 null 이면 목록이 없다는 뜻이다', () => {
    expect(() => assertSupported(CTGOV_CAPABILITY, { condition: '아무거나' }, fetchOpts)).not.toThrow();
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/cli/guard.test.ts`
Expected: FAIL — `던져야 한다` 가 도달된다(지금은 안 던진다).

- [ ] **Step 3: 구현한다**

`src/cli/guard.ts` 의 `assertSupported` 안, 미지원 축 검사 루프 **바로 뒤**에 더한다:

```ts
  /**
   * 축은 지원되는데 **그 값** 을 안 받는 경우. `values` 는 "받아들여지는 값의 목록"
   * 이므로 그 밖의 값으로 거는 필터는 조회 자체가 불가능하다는 뜻이고, 축 미지원과
   * 같은 exit 3 이다 — 사용자 입장에서 같은 사실이기 때문이다: 결과가 없는 것이
   * 아니라 그렇게 물어볼 수 없다.
   *
   * `values === null` 은 자유 텍스트 축의 모양이라 대상이 아니다(목록이 없다는 뜻이지
   * 아무 값도 안 받는다는 뜻이 아니다).
   */
  const requested: [keyof Capability['search'], string[]][] = [
    ['status', q.status ?? []],
    ['phase', q.phase ?? []],
    ['studyType', q.studyType === undefined ? [] : [q.studyType]],
  ];
  for (const [axis, values] of requested) {
    const declared = cap.search[axis].values;
    if (declared === null || values.length === 0) continue;
    const strays = values.filter((v) => !declared.includes(v));
    if (strays.length === 0) continue;
    throw unsupportedError(
      `${cap.name} 은 '${axis}' 를 ${strays.join(', ')} 로 거를 수 없습니다`,
      `이 레지스트리가 받는 값: ${declared.join(', ')}. ` +
        'ctreg registries 로 축마다 받는 값을 확인하세요. 결과가 없는 것이 아니라 그렇게 물어볼 수 없습니다.',
    );
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 통과. 기존 테스트가 빨개지면 안 된다 — 두 어댑터 다 전체를 신고하거나
축을 껐으므로 이 검사에 걸릴 것이 없다.

- [ ] **Step 5: 부르는 자리를 사보타주한다**

이 검사는 `assertSupported` 안에 있고 `search`·`count` 가 그 함수를 부른다(`get` 도 부르지만
질의로 `{}` 를 넘겨 이 검사가 무효다). **함수 안이 아니라
부르는 자리**를 겨눈다 — 봉투까지 도달하는지 `tests/cli/commands.test.ts` 에 고정한다:

```ts
describe('신고하지 않은 값은 커맨드에서도 막힌다', () => {
  const subsetCap = (): Capability => ({
    ...CTGOV_CAPABILITY,
    search: {
      ...CTGOV_CAPABILITY.search,
      status: { ...CTGOV_CAPABILITY.search.status, values: ['recruiting'] },
    },
  });

  it('search 는 unsupported 로 표시하고 exit 3 이다', async () => {
    const env = await runSearch(
      parseCliArgs(['search', '--condition', 'X', '--status', 'completed']),
      stubAdapter({}, subsetCap()),
    );
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'unsupported' });
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });

  it('count 도 마찬가지다', async () => {
    const env = await runCount(
      parseCliArgs(['count', '--condition', 'X', '--status', 'completed']),
      stubAdapter({}, subsetCap()),
    );
    expect(env.registries[0]).toMatchObject({ registry: 'ctgov', status: 'unsupported' });
    expect(exitFor(env)).toBe(EXIT.UNSUPPORTED);
  });
});
```

그다음 `guard.ts` 의 새 루프를 통째로 지우고 `npx vitest run` 을 돌린다. **guard.test.ts 와
commands.test.ts 가 둘 다** 빨개져야 한다. 확인 후 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/cli/guard.ts tests/cli/guard.test.ts tests/cli/commands.test.ts
git commit -m "feat(cli): reject filter values a registry does not declare"
```

---

### Task 4: 폼 파싱 — hidden 필드와 폼 본문

**Files:**
- Create: `src/adapters/ictrp/form.ts`
- Create: `tests/fixtures/ictrp/advsearch-form.html`
- Test: `tests/adapters/ictrp/form.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `hiddenFields(html: string): Record<string, string>`
  - `FIELD: Record<'title'|'condition'|'intervention'|'sponsor'|'secondaryId'|'country'|'phase'|'status'|'pageSize'|'search', string>` — 접두사 붙은 폼 필드 이름
  - `pagerTarget(pageIndex: number): string` — `pageIndex` 는 0-기반(1페이지 = 0)

- [ ] **Step 1: 픽스처를 만든다**

```bash
mkdir -p tests/fixtures/ictrp
curl -s -m 40 'https://trialsearch.who.int/AdvSearch.aspx' -o tests/fixtures/ictrp/advsearch-form.html
wc -c tests/fixtures/ictrp/advsearch-form.html   # 7만 바이트 이상이어야 한다
grep -c '__VIEWSTATE' tests/fixtures/ictrp/advsearch-form.html  # 1 이상
```

픽스처 파일 맨 위에 주석을 넣을 수 없으므로(HTML 원문 그대로 둔다) **어디서 언제 받았는지는
테스트 파일 상단 주석에 적는다.**

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`tests/adapters/ictrp/form.test.ts`:

```ts
/**
 * 픽스처는 `https://trialsearch.who.int/AdvSearch.aspx` 를 2026-08-26 에 받은 원문이다.
 * ICTRP 는 계약이 없는 HTML 표면이라, 이 픽스처가 낡으면 파싱이 실물과 어긋난다 —
 * 그 어긋남은 스위트가 아니라 `scripts/ictrp-field-test.ts` 가 잡는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELD, hiddenFields, pagerTarget } from '../../../src/adapters/ictrp/form.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');

describe('ICTRP 폼 파싱', () => {
  it('ViewState 세 개를 모두 거둔다 — 하나라도 빠지면 POST 가 거절된다', () => {
    const h = hiddenFields(form);
    expect(h['__VIEWSTATE']).toBeDefined();
    expect(h['__VIEWSTATE']!.length).toBeGreaterThan(1000);
    expect(h['__EVENTVALIDATION']).toBeDefined();
    expect(h['__VIEWSTATEGENERATOR']).toBeDefined();
  });

  it('값이 없는 hidden 도 빈 문자열로 거둔다 — 키가 빠지면 서버가 다르게 해석한다', () => {
    const h = hiddenFields('<input type="hidden" name="__EVENTTARGET" id="x" />');
    expect(h['__EVENTTARGET']).toBe('');
  });

  it('hidden 이 아닌 input 은 거두지 않는다', () => {
    const h = hiddenFields('<input type="text" name="txtTitle" value="암" />');
    expect(h['txtTitle']).toBeUndefined();
  });

  it('폼 필드 이름이 실제 문서의 것과 같다', () => {
    for (const name of Object.values(FIELD)) {
      expect(form, `'${name}' 이 실제 폼에 없습니다`).toContain(`name="${name}"`);
    }
  });

  /** 1페이지는 현재 페이지라 링크가 없다. 2페이지가 `ctl01` 이다(실측). */
  it('페이저 대상은 0-기반 인덱스로 만든다', () => {
    expect(pagerTarget(1)).toBe('ctl00$ContentPlaceHolder1$dlPager2$ctl01$lnkPageNo');
    expect(pagerTarget(9)).toBe('ctl00$ContentPlaceHolder1$dlPager2$ctl09$lnkPageNo');
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/form.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 4: 구현한다**

`src/adapters/ictrp/form.ts`:

```ts
/**
 * ICTRP 는 ASP.NET WebForms 다. 검색은 `AdvSearch.aspx` 에 폼을 POST 하는 것이고,
 * 그 POST 는 서버가 방금 내려 준 ViewState 를 그대로 되돌려 줘야 성립한다.
 *
 * HTML 파서를 의존성으로 들이지 않는 이유: 필요한 것이 hidden `<input>` 과 결과
 * `<tr>` 뿐이라 파서를 들일 값이 없다. 대신 **무엇을 못 잡는지** 를 적어 둔다 —
 * 정규식은 속성 순서가 바뀌거나 따옴표가 없어지면 놓친다. 그 경우를 조용한 0건이
 * 아니라 오류로 만드는 것이 `parse.ts` 의 자기 고장 감지다.
 */

const PREFIX = 'ctl00$ContentPlaceHolder1$';

/** 폼 필드 이름. 실제 문서에 이 이름이 있는지는 `form.test.ts` 가 픽스처로 검사한다. */
export const FIELD = {
  title: `${PREFIX}txtTitle`,
  condition: `${PREFIX}txtCondition`,
  intervention: `${PREFIX}txtIntervention`,
  sponsor: `${PREFIX}txtPrimarySponsor`,
  secondaryId: `${PREFIX}txtSecondaryID`,
  country: `${PREFIX}txtFreeCountry`,
  phase: `${PREFIX}ListBoxPhase`,
  status: `${PREFIX}ddlRecruitingStatus`,
  pageSize: `${PREFIX}ddlPageSize`,
  search: `${PREFIX}btnSearch`,
} as const;

/**
 * 페이지 postback 의 `__EVENTTARGET`. `pageIndex` 는 0-기반이고 1페이지(0)는 현재
 * 페이지라 링크가 없다 — 2페이지가 `ctl01` 이다(실측).
 */
export function pagerTarget(pageIndex: number): string {
  return `${PREFIX}dlPager2$ctl${String(pageIndex).padStart(2, '0')}$lnkPageNo`;
}

/**
 * `type="hidden"` 인 input 의 name/value 를 전부 거둔다.
 *
 * **값이 없는 hidden 도 빈 문자열로 담는다.** `__EVENTTARGET` 처럼 값 없이 나오는
 * 것들이 있고, 키가 통째로 빠지면 서버가 다르게 해석한다.
 */
export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type\s*=\s*"hidden"/i.test(tag)) continue;
    const name = /\bname\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    out[name] = /\bvalue\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
  }
  return out;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/form.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/adapters/ictrp/form.ts tests/adapters/ictrp tests/fixtures/ictrp
git commit -m "feat(ictrp): read the ViewState form fields the search POST needs"
```

---

### Task 5: 결과 파싱과 자기 고장 감지

**Files:**
- Create: `src/adapters/ictrp/parse.ts`
- Create: `tests/fixtures/ictrp/results-page1.html`
- Test: `tests/adapters/ictrp/parse.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type IctrpRow = { trialId: string; statusRaw: string; title: string; registeredOn: string }`
  - `type IctrpPage = { records: number; trials: number; rows: IctrpRow[] }`
  - `parseResults(html: string): IctrpPage` — 건수 > 0 인데 행이 0 이면 `upstreamError` 를 던진다

- [ ] **Step 1: 픽스처를 만든다**

```bash
python3 - <<'PY'
import re, urllib.request, urllib.parse
UA={'User-Agent':'ctreg fixture','Content-Type':'application/x-www-form-urlencoded'}
B='https://trialsearch.who.int/AdvSearch.aspx'
h=urllib.request.urlopen(urllib.request.Request(B,headers={'User-Agent':UA['User-Agent']}),timeout=60).read().decode('utf-8','replace')
d={}
for m in re.finditer(r'<input[^>]*type="hidden"[^>]*>', h):
    t=m.group(0); n=re.search(r'name="([^"]*)"',t); v=re.search(r'value="([^"]*)"',t)
    if n: d[n.group(1)]=v.group(1) if v else ''
d['ctl00$ContentPlaceHolder1$txtCondition']='diabetes'
d['ctl00$ContentPlaceHolder1$ddlRecruitingStatus']='ALL'
d['ctl00$ContentPlaceHolder1$btnSearch']='Search'
out=urllib.request.urlopen(urllib.request.Request(B,data=urllib.parse.urlencode(d).encode(),headers=UA),timeout=120).read()
open('tests/fixtures/ictrp/results-page1.html','wb').write(out)
print(len(out))
PY
grep -c 'TrialID=' tests/fixtures/ictrp/results-page1.html   # 10 이상
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`tests/adapters/ictrp/parse.test.ts`:

```ts
/**
 * 픽스처는 `condition=diabetes` · `ddlRecruitingStatus=ALL` 의 실제 결과 페이지다
 * (2026-08-26). 건수는 그날의 것이라 **값 자체를 고정하지 않는다** — 고정하면
 * 픽스처를 갱신할 때마다 무관하게 빨개진다. 대신 관계를 고정한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseResults } from '../../../src/adapters/ictrp/parse.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { CtregError } from '../../../src/runtime/errors.js';

const page1 = readFileSync(join(__dirname, '../../fixtures/ictrp/results-page1.html'), 'utf8');

describe('ICTRP 결과 파싱', () => {
  it('건수 두 개를 읽는다 — records 는 레코드 수, trials 는 묶인 뒤의 시험 수다', () => {
    const p = parseResults(page1);
    expect(p.records).toBeGreaterThan(0);
    expect(p.trials).toBeGreaterThan(0);
    // ICTRP 가 Secondary ID 로 레코드를 묶으므로 시험 수는 레코드 수를 넘지 않는다.
    expect(p.trials).toBeLessThanOrEqual(p.records);
  });

  it('행마다 ID·상태·제목·등록일을 읽는다', () => {
    const p = parseResults(page1);
    expect(p.rows.length).toBeGreaterThan(0);
    for (const r of p.rows) {
      expect(r.trialId.length).toBeGreaterThan(0);
      expect(r.statusRaw.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it('원 레지스트리가 섞인 ID 를 그대로 읽는다 — 슬래시·하이픈이 들어 있다', () => {
    const p = parseResults(page1);
    // 이 픽스처에 어떤 레지스트리가 섞였는지는 그날에 달렸으므로, 형식을 고정하지 않고
    // "공백이 없는 토큰" 이라는 것만 본다.
    for (const r of p.rows) expect(r.trialId).not.toMatch(/\s/);
  });

  /**
   * **이 어댑터의 안전장치.** 계약이 없는 HTML 표면이라 언제든 깨질 수 있는데,
   * 결과 페이지가 건수와 행을 둘 다 내므로 깨짐을 스스로 감지할 수 있다. 깨졌을 때
   * 0건 · exit 0 으로 나가면 "그런 시험이 없다" 로 읽힌다 — 이 CLI 가 없애려는
   * 실패 그 자체다.
   */
  it('건수가 있는데 행을 하나도 못 읽으면 업스트림 오류다', () => {
    const broken = page1.replace(/TrialID=/g, 'BROKEN=');
    try {
      parseResults(broken);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.UPSTREAM);
    }
  });

  it('건수가 0 이면 행이 없어도 정상이다 — 진짜 0건과 깨짐은 다르다', () => {
    const empty = '<html><body>0 records for 0 trials found</body></html>';
    const p = parseResults(empty);
    expect(p.records).toBe(0);
    expect(p.rows).toEqual([]);
  });

  /**
   * 못 잡는 것: 건수 **문구 자체** 의 형식이 바뀌면 건수도 행도 0 이 되어 진짜 0건과
   * 구별되지 않는다. 그 경우는 `scripts/ictrp-field-test.ts` 의 "알려진 질의가 0 이
   * 아니다" 검사가 잡는다 — 스텁으로는 원리상 못 잡는다.
   */
  it('건수 문구가 아예 없으면 0 으로 읽는다(위 주석의 한계)', () => {
    const p = parseResults('<html><body>아무것도 없음</body></html>');
    expect(p.records).toBe(0);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/parse.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 4: 구현한다**

`src/adapters/ictrp/parse.ts`:

```ts
import { upstreamError } from '../../runtime/errors.js';

export type IctrpRow = {
  /** 원 레지스트리의 ID 그대로. `NCT…`, `CTRI/2026/07/113311`, `JPRN-jRCT…` 등. */
  trialId: string;
  /** `Recruiting` / `Not Recruiting`. 매핑은 map.ts 의 몫이다. */
  statusRaw: string;
  title: string;
  /** 등록일(`YYYY-MM-DD`). 시험의 시작일이 **아니다**. */
  registeredOn: string;
};

export type IctrpPage = {
  /** 레코드 수. 같은 시험의 여러 등록이 각각 세어진다. */
  records: number;
  /** ICTRP 가 Secondary ID 로 묶은 뒤의 시험 수. `records` 이하다. */
  trials: number;
  rows: IctrpRow[];
};

const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 결과 페이지에서 건수와 행을 읽는다.
 *
 * **건수 > 0 인데 행이 0 이면 던진다.** 계약이 없는 HTML 표면이라 언제든 깨질 수
 * 있는데, 이 페이지가 건수와 행을 둘 다 내므로 깨짐을 스스로 감지할 수 있다. 깨졌을
 * 때 0건 · exit 0 으로 나가면 "그런 시험이 없다" 로 읽힌다 — 이 CLI 가 없애려는
 * 실패 그 자체다.
 *
 * 못 잡는 것: 건수 **문구 자체** 의 형식이 바뀌면 건수도 행도 0 이 되어 진짜 0건과
 * 구별되지 않는다. 그 경우는 필드테스트의 "알려진 질의가 0 이 아니다" 검사가 잡는다.
 */
export function parseResults(html: string): IctrpPage {
  const m = /([0-9,]+)\s+records\s+for\s+([0-9,]+)\s+trials\s+found/i.exec(strip(html));
  const num = (s: string | undefined) => (s === undefined ? 0 : Number(s.replace(/,/g, '')));
  const records = num(m?.[1]);
  const trials = num(m?.[2]);

  const rows: IctrpRow[] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = tr[1] ?? '';
    const idm = /TrialID=([^"'&]+)/i.exec(body);
    if (!idm) continue;
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1] ?? ''));
    const [statusRaw = '', , title = '', registeredOn = ''] = cells;
    rows.push({ trialId: decodeURIComponent(idm[1]!), statusRaw, title, registeredOn });
  }

  if (records > 0 && rows.length === 0) {
    throw upstreamError(
      `ICTRP 가 ${records}건이 있다고 했는데 목록을 하나도 읽지 못했습니다`,
      'ICTRP 는 공개 API 가 없어 결과 화면을 읽습니다. 화면 구조가 바뀌면 이 오류가 납니다 — ' +
        '조용한 0건 대신 오류로 냅니다. ctreg 를 갱신하거나 다른 레지스트리를 쓰세요.',
    );
  }
  return { records, trials, rows };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/parse.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 사보타주로 확인한다**

`if (records > 0 && rows.length === 0)` 블록을 지우고 `'건수가 있는데 행을 하나도 못 읽으면
업스트림 오류다'` 가 빨개지는지 본다. 확인 후 되돌린다.

- [ ] **Step 7: 커밋**

```bash
git add src/adapters/ictrp/parse.ts tests/adapters/ictrp/parse.test.ts tests/fixtures/ictrp/results-page1.html
git commit -m "feat(ictrp): parse the result page and fail loudly when it stops parsing"
```

---

### Task 6: 질의 조립과 어휘

**Files:**
- Create: `src/adapters/ictrp/query.ts`
- Test: `tests/adapters/ictrp/query.test.ts`

**Interfaces:**
- Consumes: `FIELD` (Task 4)
- Produces:
  - `ICTRP_FILTERABLE: { status: TrialStatus[]; phase: TrialPhase[]; studyType: StudyType[] }`
  - `buildForm(q: NormalizedQuery, pageSize: number): Record<string, string>`
  - `PHASE_OUT: Record<string, string>` — 공통 어휘 → ICTRP 값

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/adapters/ictrp/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildForm, ICTRP_FILTERABLE } from '../../../src/adapters/ictrp/query.js';
import { FIELD } from '../../../src/adapters/ictrp/form.js';

describe('ICTRP 질의 조립', () => {
  /**
   * **이 저장소에서 가장 중요한 한 줄이다.** `ddlRecruitingStatus` 에는 selected 속성이
   * 없어 기본 선택이 첫 항목(`1` = Recruiting)이고, 필드를 안 보내면 서버가 그것을
   * 쓴다. 실측: diabetes 가 6,844(모집중만) vs 36,264(ALL). 명시하지 않으면 모든
   * 질의가 조용히 좁혀지고 경고도 안 붙는다.
   */
  it('상태를 안 걸면 ALL 을 명시한다 — 안 보내면 모집중만 나온다', () => {
    const f = buildForm({ condition: 'diabetes' }, 20);
    expect(f[FIELD.status]).toBe('ALL');
  });

  it('--status recruiting 이면 1 을 보낸다', () => {
    const f = buildForm({ condition: 'diabetes', status: ['recruiting'] }, 20);
    expect(f[FIELD.status]).toBe('1');
  });

  it('자유 텍스트 축을 제자리에 넣는다', () => {
    const f = buildForm(
      { condition: 'c', intervention: 'i', title: 't', lead: 's', id: 'x', location: 'Korea' },
      20,
    );
    expect(f[FIELD.condition]).toBe('c');
    expect(f[FIELD.intervention]).toBe('i');
    expect(f[FIELD.title]).toBe('t');
    expect(f[FIELD.sponsor]).toBe('s');
    expect(f[FIELD.secondaryId]).toBe('x');
    expect(f[FIELD.country]).toBe('Korea');
  });

  it('쓰지 않은 축은 키를 만들지 않는다 — 빈 문자열도 서버에는 입력이다', () => {
    const f = buildForm({ condition: 'c' }, 20);
    expect(FIELD.title in f).toBe(false);
    expect(FIELD.intervention in f).toBe(false);
  });

  it('phase 를 ICTRP 값으로 옮긴다', () => {
    expect(buildForm({ phase: ['phase_3'] }, 20)[FIELD.phase]).toBe('Phase 3');
    // Phase 0 은 CT.gov 의 Early Phase 1 에 해당한다.
    expect(buildForm({ phase: ['early_phase_1'] }, 20)[FIELD.phase]).toBe('Phase 0');
  });

  /**
   * **페이지 크기를 검색 POST 에 실으면 안 된다(실측 2026-08-26).** `ddlPageSize` 는 결과
   * 페이지에만 렌더되므로, 그 이름을 검색 POST 에 담으면 ASP.NET 이 `__EVENTVALIDATION`
   * 으로 POST 를 거절해 **결과가 0건**이 된다(안 보내면 10행, 50/100 을 보내면 0행).
   * 조용히 틀린 답이 나가는 자리라 이 검사가 그것을 막는다.
   */
  it('페이지 크기를 검색 POST 에 싣지 않는다 — 실으면 결과가 0건이 된다', () => {
    expect(FIELD.pageSize in buildForm({ condition: 'c' }, 100)).toBe(false);
  });

  it('검색 버튼 이름을 함께 보낸다 — 없으면 서버가 검색으로 보지 않는다', () => {
    expect(buildForm({ condition: 'c' }, 20)[FIELD.search]).toBe('Search');
  });

  /** 신고하는 값은 CLI 가 받는 값이어야 한다. 계약 스위트도 같은 것을 검사한다. */
  it('신고 어휘는 na 를 담지 않는다 — ICTRP 목록에 자리가 없다', () => {
    expect(ICTRP_FILTERABLE.phase).not.toContain('na');
    expect(ICTRP_FILTERABLE.status).toEqual(['recruiting']);
    expect(ICTRP_FILTERABLE.studyType).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/query.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/adapters/ictrp/query.ts`:

```ts
import type { NormalizedQuery } from '../../core/query.js';
import type { StudyType, TrialPhase, TrialStatus } from '../../core/vocab.js';
import { FIELD } from './form.js';

/**
 * 공통 어휘 → ICTRP 의 `ListBoxPhase` 값.
 *
 * `na` 는 없다 — ICTRP 목록이 Phase 0~4 뿐이다. `early_phase_1` 을 `Phase 0` 에
 * 잇는 것은 CT.gov 의 Early Phase 1 이 Phase 0 의 후신이기 때문이다.
 */
export const PHASE_OUT: Partial<Record<TrialPhase, string>> = {
  early_phase_1: 'Phase 0',
  phase_1: 'Phase 1',
  phase_2: 'Phase 2',
  phase_3: 'Phase 3',
  phase_4: 'Phase 4',
};

/**
 * 이 레지스트리가 **받는** 값. capability 의 `values` 가 이것을 그대로 신고한다.
 *
 * `status` 가 하나뿐인 것은 `ddlRecruitingStatus` 가 상태 어휘가 아니라
 * "모집중만 / 전부" 토글이기 때문이다. `studyType` 은 폼에 자리가 없다.
 */
export const ICTRP_FILTERABLE: {
  status: TrialStatus[];
  phase: TrialPhase[];
  studyType: StudyType[];
} = {
  status: ['recruiting'],
  phase: Object.keys(PHASE_OUT) as TrialPhase[],
  studyType: [],
};

/**
 * `NormalizedQuery` 를 폼 본문으로 옮긴다. ViewState 는 여기서 다루지 않는다 —
 * 그것은 전송의 몫이고(`client.ts`) 이 함수는 순수하게 유지한다.
 *
 * **`ddlRecruitingStatus` 를 언제나 명시하는 것이 이 함수의 가장 중요한 일이다.**
 * 그 컨트롤에는 `selected` 속성이 없어 기본 선택이 첫 항목(`1` = Recruiting)이고,
 * 필드를 보내지 않으면 서버가 그 값을 쓴다. 실측(2026-08-26): `condition=diabetes` 가
 * 보내지 않으면 6,844건, `ALL` 이면 36,264건이다. 명시하지 않으면 **모든 질의가
 * 조용히 모집중만으로 좁혀지고 경고도 붙지 않는다.**
 *
 * 쓰지 않은 축은 키를 만들지 않는다. 빈 문자열도 서버에는 입력이다.
 */
export function buildForm(q: NormalizedQuery, pageSize: number): Record<string, string> {
  const f: Record<string, string> = {};
  const put = (name: string, v: string | undefined) => {
    if (v !== undefined && v !== '') f[name] = v;
  };

  put(FIELD.title, q.title);
  put(FIELD.condition, q.condition);
  put(FIELD.intervention, q.intervention);
  put(FIELD.sponsor, q.lead);
  put(FIELD.secondaryId, q.id);
  put(FIELD.country, q.location);

  const phases = (q.phase ?? []).map((p) => PHASE_OUT[p]).filter((v): v is string => v !== undefined);
  if (phases.length > 0) f[FIELD.phase] = phases.join(',');

  // 위 주석 참고 — 이 줄이 빠지면 모든 결과가 조용히 모집중만이 된다.
  f[FIELD.status] = (q.status ?? []).includes('recruiting') ? '1' : 'ALL';

  // `ddlPageSize` 는 **싣지 않는다.** 그 컨트롤은 결과 페이지에만 렌더되므로 검색 POST 에
  // 담으면 ASP.NET 이 __EVENTVALIDATION 으로 거절해 결과가 0건이 된다(실측 2026-08-26:
  // 안 보내면 10행, 50/100 을 보내면 각각 0행). 첫 페이지는 언제나 10행이고, 더 받으려면
  // 페이저 postback 으로 넘긴다. `pageSize` 인자는 이 함수의 시그니처에 남지만 폼에는 안 간다 —
  // 지우면 호출자가 `limits.maxPageSize` 와의 관계를 잃는다.
  void pageSize;
  f[FIELD.search] = 'Search';
  return f;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/query.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 사보타주로 확인한다**

`f[FIELD.status] = ...` 줄을 지우고 `'상태를 안 걸면 ALL 을 명시한다'` 가 빨개지는지 본다.
확인 후 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/adapters/ictrp/query.ts tests/adapters/ictrp/query.test.ts
git commit -m "feat(ictrp): build the search form, always naming the recruiting filter"
```

---

### Task 7: 매핑 — 행에서 레코드로

**Files:**
- Create: `src/adapters/ictrp/map.ts`
- Modify: `src/core/record.ts` (`sourceRefreshedAt` 선택 필드)
- Test: `tests/adapters/ictrp/map.test.ts`

**Interfaces:**
- Consumes: `IctrpRow` (Task 5)
- Produces: `mapRow(row: IctrpRow, fetchedAt: string): TrialRecord`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/adapters/ictrp/map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapRow } from '../../../src/adapters/ictrp/map.js';
import { TrialRecordSchema } from '../../../src/core/record.js';

const AT = '2026-08-26T00:00:00.000Z';
const row = (over: Partial<Parameters<typeof mapRow>[0]> = {}) => ({
  trialId: 'NCT07749586', statusRaw: 'Recruiting', title: '어떤 시험', registeredOn: '2026-07-17', ...over,
});

describe('ICTRP 행 매핑', () => {
  it('스키마를 만족하는 레코드를 만든다', () => {
    expect(() => TrialRecordSchema.parse(mapRow(row(), AT))).not.toThrow();
  });

  it('ID 는 ICTRP 접두사를 단다 — 원 레지스트리의 것이 아니다', () => {
    const r = mapRow(row(), AT);
    expect(r.id).toBe('ICTRP:NCT07749586');
    expect(r.registry).toBe('ictrp');
    expect(r.registryId).toBe('NCT07749586');
  });

  it('슬래시가 든 ID 도 그대로 담는다', () => {
    expect(mapRow(row({ trialId: 'CTRI/2026/07/113311' }), AT).registryId).toBe('CTRI/2026/07/113311');
  });

  it('Recruiting 은 공통 어휘의 recruiting 이다', () => {
    const r = mapRow(row({ statusRaw: 'Recruiting' }), AT);
    expect(r.status).toBe('recruiting');
    expect(r.statusRaw).toBe('Recruiting');
  });

  /**
   * `Not Recruiting` 은 ICTRP 가 아는 값이지만 완료·중단·모집종료를 한데 묶은 굵은
   * 통이라 여덟 개 중 어느 것과도 같지 않다. `completed` 로 접으면 거짓이 된다.
   * 어휘의 정의대로 `other`(매핑 없음)이고, `unknown`(레지스트리가 모른다)이 아니다.
   */
  it('Not Recruiting 은 other 로 접고 원문을 남긴다', () => {
    const r = mapRow(row({ statusRaw: 'Not Recruiting' }), AT);
    expect(r.status).toBe('other');
    expect(r.statusRaw).toBe('Not Recruiting');
  });

  it('모르는 상태 문자열도 other 로 접고 원문을 남긴다', () => {
    const r = mapRow(row({ statusRaw: '뭔가 새 값' }), AT);
    expect(r.status).toBe('other');
    expect(r.statusRaw).toBe('뭔가 새 값');
  });

  /**
   * 등록일은 **시험의 시작일이 아니다.** `dates.start` 에 넣으면 다른 것을 같은
   * 이름으로 신고하는 것이 된다 — 세 날짜 축을 전부 끈 것과 같은 이유다.
   */
  it('등록일을 dates.start 에 넣지 않는다', () => {
    const r = mapRow(row({ registeredOn: '2026-07-17' }), AT);
    expect(r.dates?.start).toBeUndefined();
  });

  it('URL 은 그 레코드를 실제로 여는 주소다', () => {
    expect(mapRow(row(), AT).url).toBe('https://trialsearch.who.int/Trial2.aspx?TrialID=NCT07749586');
  });

  it('행이 싣지 않는 것은 만들어 내지 않는다', () => {
    const r = mapRow(row(), AT);
    expect(r.conditions).toEqual([]);
    expect(r.phase).toBeUndefined();
    expect(r.enrollment).toBeUndefined();
    // 결과 행에는 수확일이 없다. get 이 열릴 때 채운다.
    expect(r.sourceRefreshedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/map.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 스키마에 자리를 만든다**

`src/core/record.ts` 의 `TrialRecordSchema` 에 더한다(`fetchedAt` 근처):

```ts
  /**
   * 이 레코드를 **이 레지스트리가 마지막으로 수확한 시각.** 집계 레지스트리에만
   * 의미가 있다 — ICTRP 는 다른 레지스트리의 사본을 주기적으로 거둬 오고, 그 수확일은
   * **시험이 갱신된 날이 아니다**(실측: ctgov 2022-03-14 → ICTRP 2022-03-21,
   * 2024-06-03 → 2024-06-10, 둘 다 7일 뒤). 그래서 `dates.lastUpdated` 에 넣지 않는다 —
   * `dates.*` 는 **시험의** 날짜를 담는 자리이고, 그 안에 넣으면 한 뭉치에 두 가지
   * 뜻이 섞인다.
   *
   * WHO ICTRP 이용 약관이 "데이터를 처리한 날짜를 명시" 하라고 요구하는 것도 이 자리다.
   * ctgov·ISRCTN 은 사본이 아니라 원본이므로 채우지 않는다.
   */
  sourceRefreshedAt: z.string().optional(),
```

- [ ] **Step 4: 매핑을 구현한다**

`src/adapters/ictrp/map.ts`:

```ts
import type { TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import type { IctrpRow } from './parse.js';

/**
 * ICTRP 결과 행의 상태 → 공통 어휘.
 *
 * 행이 싣는 값은 `Recruiting` / `Not Recruiting` **이진** 이다(실측). 후자를
 * `completed` 로 접으면 거짓이 된다 — 완료·중단·모집종료를 한데 묶은 굵은 통이라
 * 여덟 개 중 어느 것과도 같지 않다. 어휘의 정의대로 `other`(매핑 없음)이고,
 * `unknown`(레지스트리가 모른다)이 아니다. 원문은 `statusRaw` 가 보존한다.
 */
function toStatus(raw: string): TrialRecord['status'] {
  return raw.trim().toLowerCase() === 'recruiting' ? 'recruiting' : 'other';
}

/**
 * 결과 행 하나를 레코드로. **행이 싣지 않는 것은 만들어 내지 않는다** — 조건·단계·
 * 등록 인원은 이 화면에 없으므로 비운다. 등록일은 `dates.start` 에 넣지 않는다:
 * 그것은 **등록일**이지 시험의 시작일이 아니고, 세 날짜 축을 전부 끈 것과 같은
 * 이유다(다른 것을 같은 이름으로 신고하지 않는다).
 */
export function mapRow(row: IctrpRow, fetchedAt: string): TrialRecord {
  return {
    id: formatTrialId('ictrp', row.trialId),
    registry: 'ictrp',
    registryId: row.trialId,
    url: `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(row.trialId)}`,
    title: row.title,
    status: toStatus(row.statusRaw),
    ...(row.statusRaw ? { statusRaw: row.statusRaw } : {}),
    conditions: [],
    fetchedAt,
  };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 통과. `sourceRefreshedAt` 을 더해도 기존 어댑터 테스트가 빨개지면 안 된다
(선택 필드다).

- [ ] **Step 6: 커밋**

```bash
git add src/adapters/ictrp/map.ts src/core/record.ts tests/adapters/ictrp/map.test.ts
git commit -m "feat(ictrp): map result rows without inventing fields the page lacks"
```

---

### Task 8: 전송 — 폼을 받아 검색하고 페이지를 넘긴다

**Files:**
- Create: `src/adapters/ictrp/client.ts`
- Test: `tests/adapters/ictrp/client.test.ts`

**Interfaces:**
- Consumes: `postForm`/`getJson` (Task 1), `hiddenFields`·`pagerTarget`·`FIELD` (Task 4), `parseResults` (Task 5), `buildForm` (Task 6)
- Produces: `makeClient(cfg, ratePerSec, deps).search(q: NormalizedQuery, pageSize: number, page: number, cacheMode: CacheMode): Promise<{ page: IctrpPage; fetchedAt: string; warnings: Warning[] }>`
  — `page` 는 1-기반.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/adapters/ictrp/client.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { makeClient } from '../../../src/adapters/ictrp/client.js';
import { FIELD } from '../../../src/adapters/ictrp/form.js';

const form = readFileSync(join(__dirname, '../../fixtures/ictrp/advsearch-form.html'), 'utf8');
const results = readFileSync(join(__dirname, '../../fixtures/ictrp/results-page1.html'), 'utf8');

const cfg = () => ({
  cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ictrp-')),
  cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
  ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
  isrctnBaseUrl: 'https://isrctn.example.test',
  ictrpBaseUrl: 'https://ictrp.example.test',
});

/** GET 이면 폼을, POST 면 결과를 낸다. 실제 흐름과 같은 순서다. */
function stub() {
  const calls: { method: string; body?: string }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, ...(init?.body ? { body: String(init.body) } : {}) });
    return new Response(method === 'GET' ? form : results, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('ICTRP 전송', () => {
  it('폼을 먼저 받아 ViewState 를 실어 POST 한다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    const r = await c.search({ condition: 'diabetes' }, 20, 1, 'off');

    expect(r.page.rows.length).toBeGreaterThan(0);
    expect(s.calls[0]?.method).toBe('GET');
    expect(s.calls[1]?.method).toBe('POST');
    // ViewState 를 그대로 되돌려 보내지 않으면 서버가 거절한다.
    expect(s.calls[1]?.body).toContain('__VIEWSTATE=');
  });

  it('질의를 폼 본문에 싣는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 1, 'off');
    const body = new URLSearchParams(s.calls[1]?.body ?? '');
    expect(body.get(FIELD.condition)).toBe('diabetes');
    expect(body.get(FIELD.status)).toBe('ALL');
  });

  /**
   * 페이지 N 을 받으려면 검색을 처음부터 다시 몰아 그 페이지까지 postback 해야 한다 —
   * ICTRP 는 불투명 커서를 주지 않고, 프로세스가 매 호출마다 죽는 CLI 에서 세션을
   * 이어 붙일 방법이 없다. 요청 수가 페이지 수에 비례한다는 것이 그 대가다.
   */
  it('2페이지는 검색 뒤에 페이저 postback 을 한 번 더 한다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 2, 'off');

    expect(s.calls.map((x) => x.method)).toEqual(['GET', 'POST', 'POST']);
    expect(s.calls[2]?.body).toContain(encodeURIComponent('dlPager2$ctl01$lnkPageNo'));
  });

  it('1페이지는 페이저를 부르지 않는다', async () => {
    const s = stub();
    const c = makeClient(cfg(), 1000, { fetchImpl: s.fetchImpl, sleep: async () => {} });
    await c.search({ condition: 'diabetes' }, 20, 1, 'off');
    expect(s.calls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/adapters/ictrp/client.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: 설정에 베이스 URL 을 더한다**

`src/runtime/config.ts` 에 `ictrpBaseUrl` 을 더한다. 기존 `isrctnBaseUrl` 이 하는 것과 **똑같이**
하고(기본값 + `CTREG_ICTRP_BASE_URL` 오버라이드), 기본값은 `https://trialsearch.who.int` 다.
그 파일의 기존 테스트에 ICTRP 줄을 더한다.

- [ ] **Step 4: 전송을 구현한다**

`src/adapters/ictrp/client.ts`:

```ts
import type { Warning } from '../../core/capability.js';
import type { CacheMode, NormalizedQuery } from '../../core/query.js';
import type { Config } from '../../runtime/config.js';
import { getJson, postForm, type HttpDeps } from '../../runtime/http.js';
import { FIELD, hiddenFields, pagerTarget } from './form.js';
import { parseResults, type IctrpPage } from './parse.js';
import { buildForm } from './query.js';

const PATH = '/AdvSearch.aspx';

/**
 * ICTRP 에는 REST API 가 없다. 검색은 ASP.NET 폼 왕복이다:
 * 폼을 GET → ViewState 를 실어 POST → (필요하면) 페이저 postback.
 *
 * **폼 GET 은 캐시하지 않는다.** ViewState 는 만료될 수 있고, 만료된 것을 캐시에서
 * 꺼내 쓰면 POST 가 조용히 거절된다. 캐시하는 것은 **결과 페이지** 이고 키는
 * 사용자가 준 질의 + 페이지 번호다 — ViewState 를 키에 넣으면 요청마다 달라져
 * 캐시가 영원히 미스다.
 */
export function makeClient(cfg: Config, ratePerSec: number, deps: HttpDeps = {}) {
  const base = { registry: 'ictrp' as const, baseUrl: cfg.ictrpBaseUrl, ratePerSec };

  return {
    /** `page` 는 1-기반. 2 이상이면 검색 뒤에 페이저 postback 을 그만큼 더 한다. */
    async search(
      q: NormalizedQuery,
      pageSize: number,
      page: number,
      cacheMode: CacheMode,
    ): Promise<{ page: IctrpPage; fetchedAt: string; warnings: Warning[] }> {
      const warnings: Warning[] = [];

      const formPage = await getJson<string>(
        cfg,
        { ...base, path: PATH, params: {}, cacheMode: 'off', accept: 'text/html', decode: (t) => t },
        deps,
      );
      warnings.push(...formPage.warnings);

      const query = buildForm(q, pageSize);
      const cacheKeyParams = { ...query, page };

      let html = await postForm<string>(
        cfg,
        {
          ...base,
          path: PATH,
          form: { ...hiddenFields(formPage.value), ...query },
          cacheKeyParams,
          cacheMode,
          decode: (t) => t,
        },
        deps,
      );
      warnings.push(...html.warnings);

      for (let p = 2; p <= page; p++) {
        const next = await postForm<string>(
          cfg,
          {
            ...base,
            path: PATH,
            form: {
              ...hiddenFields(html.value),
              __EVENTTARGET: pagerTarget(p - 1),
              __EVENTARGUMENT: '',
            },
            cacheKeyParams: { ...cacheKeyParams, page: p },
            cacheMode,
            decode: (t) => t,
          },
          deps,
        );
        warnings.push(...next.warnings);
        html = next;
      }

      return { page: parseResults(html.value), fetchedAt: html.fetchedAt, warnings };
    },
  };
}
export type IctrpClient = ReturnType<typeof makeClient>;
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/adapters/ictrp/client.ts src/runtime/config.ts tests/adapters/ictrp/client.test.ts tests/runtime/config.test.ts
git commit -m "feat(ictrp): drive the ViewState form round trip for search and paging"
```

---

### Task 9: 어댑터와 capability, 배선, 계약 스위트

**Files:**
- Create: `src/adapters/ictrp/adapter.ts`
- Create: `tests/contract/ictrp.contract.test.ts`
- Modify: `src/adapters/index.ts`

**Interfaces:**
- Consumes: Task 4–8 전부
- Produces: `ICTRP_CAPABILITY: Capability`, `createIctrpAdapter(cfg, deps): RegistryAdapter`

- [ ] **Step 1: 계약 스위트를 붙인다(이것이 실패하는 테스트다)**

`tests/contract/ictrp.contract.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIctrpAdapter } from '../../src/adapters/ictrp/adapter.js';
import { runAdapterContract } from './adapter-contract.js';

const form = readFileSync(join(__dirname, '../fixtures/ictrp/advsearch-form.html'), 'utf8');
const results = readFileSync(join(__dirname, '../fixtures/ictrp/results-page1.html'), 'utf8');

/**
 * ICTRP 는 HTML 만 낸다. `wire` 가 선으로 나가는 바이트이고 `respond` 는 그것을
 * 자료로 본 모습이다 — 같은 픽스처에서 파생시켜 둘이 어긋날 일을 없앤다.
 *
 * 이 스위트는 GET 과 POST 를 구분하지 못하고 URL 만 준다. ICTRP 는 두 요청이 같은
 * 경로라, 폼과 결과를 URL 로 가를 수 없다. 그래서 **결과 페이지를 낸다** — 그 안에도
 * hidden 필드가 있어 폼 수확이 성립하고, 검색 결과도 담겨 있다.
 */
runAdapterContract('ictrp', {
  make: (fetchImpl) =>
    createIctrpAdapter(
      {
        cacheDir: mkdtempSync(join(tmpdir(), 'ctreg-ictrp-contract-')),
        cacheTtlSec: 3600, timeoutMs: 5000, maxRetries: 0, ratePerSec: 1000,
        ctgovBaseUrl: 'https://ctgov.example.test/api/v2',
        isrctnBaseUrl: 'https://isrctn.example.test',
        ictrpBaseUrl: 'https://ictrp.example.test',
      },
      { fetchImpl, sleep: async () => {} },
    ),
  respond: () => results,
  wire: () => ({ text: results, contentType: 'text/html' }),
  sampleId: 'ICTRP:NCT07749586',
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/contract/ictrp.contract.test.ts`
Expected: FAIL — `createIctrpAdapter` 가 없다

- [ ] **Step 3: 어댑터를 구현한다**

`src/adapters/ictrp/adapter.ts`. `isrctn/adapter.ts` 의 모양을 그대로 따르되 capability 는 이렇게:

```ts
const free = (scope: string): SearchAxis => ({ supported: true, values: null, exhaustive: null, scope });
const off = (scope: string): SearchAxis => ({ supported: false, values: null, exhaustive: null, scope });

export const ICTRP_CAPABILITY: Capability = {
  key: 'ictrp',
  name: 'WHO ICTRP',
  region: 'global (집계)',
  search: {
    condition: free('TRDS 의 조건 문자열. 동의어 처리가 ctgov 와 다르다 — 어느 쪽이 넓은지는 재지 않았다'),
    intervention: free('중재 문자열'),
    title: free('공개 제목'),
    lead: free('주 스폰서만 본다 — 공동 스폰서 자리가 폼에 없다'),
    id: free('Secondary ID 를 포함 검색한다. ICTRP 사본이 원 레지스트리보다 이 필드를 덜 실은 사례가 있다(표본 1건)'),
    location: free('국가만 본다 — 도시·기관 자리가 없다'),
    status: {
      supported: true,
      values: ICTRP_FILTERABLE.status,
      exhaustive: false,
      scope: '모집중인지 아닌지 둘뿐이다 — 완료·중단·모집종료를 가려낼 수 없다',
    },
    phase: {
      supported: true,
      values: ICTRP_FILTERABLE.phase,
      // 필드테스트가 실측한 값으로 바꾼다. 증명하지 못하면 false 로 둔다.
      exhaustive: false,
      scope: 'Phase 0~4. na 자리가 없어 단계를 신고하지 않은 시험은 어디에도 안 걸린다',
    },
    studyType: { supported: false, values: [], exhaustive: null, scope: '폼에 중재/관찰 구분이 없다' },
    sponsor: off('주 스폰서만 있다 — lead 로 신고한다'),
    term: off('본문 전반을 아우르는 자유 텍스트 축이 없다'),
    patient: off('없다'),
    outcomeQuery: off('없다'),
    geo: off('좌표를 받지 않는다 — 국가만 본다'),
    updatedRange: off('있는 날짜 범위는 등록일이다 — 갱신일이 아니라 다른 것을 같은 이름으로 신고하지 않는다'),
    startRange: off('있는 날짜 범위는 등록일이다 — 시험 시작일이 아니다'),
    completionRange: off('있는 날짜 범위는 등록일이다 — 완료일이 아니다'),
  },
  detail: {
    eligibilityText: { supported: false, scope: '검색 결과 화면에 없다' },
    outcomes: { supported: false, scope: '검색 결과 화면에 없다' },
    contacts: { supported: false, scope: '검색 결과 화면에 없다' },
  },
  count: { supported: true, scope: '결과 화면이 내는 시험 수(같은 시험의 여러 등록을 묶은 뒤의 수)' },
  results: { supported: false, scope: '구조화된 결과 데이터를 싣지 않는다' },
  limits: { maxPageSize: 10, ratePerSec: 1 },
};
```

네 메서드:

- `search`: `client.search(q, pageSize, page, cacheMode)` → `page.rows.map(mapRow)`.
  `total` 은 `page.trials`. `nextPageToken` 은 **다음 페이지 번호의 문자열**이고, 이번 페이지가
  마지막이면 만들지 않는다(`page * pageSize >= page.records`).
  `q.pageToken` 이 있으면 숫자로 읽어 페이지 번호로 쓴다.
- `count`: 같은 호출을 `pageSize` 최소로 하고 `page.trials` 만 낸다.
- `get`·`results`: `unsupportedError` 를 던진다. 문구는 `isrctn/adapter.ts` 의 같은 자리를 따른다.

`capability.get` 이 스키마에 없으므로, `get` 미지원은 **던지는 것**으로 신고한다 — `count.ts` 가
`cap.count.supported` 를 강제하는 것과 같은 자리 논리다.

- [ ] **Step 4: 배선한다**

`src/adapters/index.ts`:

```ts
  return {
    ctgov: createCtgovAdapter(cfg, deps),
    isrctn: createIsrctnAdapter(cfg, deps),
    ictrp: createIctrpAdapter(cfg, deps),
  };
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: 전부 통과. 계약 스위트가 세 어댑터에 대해 돈다.

- [ ] **Step 6: 실물로 확인한다**

```bash
node dist/cli/bin.js registries --registry ictrp --format json | head -40
node dist/cli/bin.js count --registry ictrp --condition diabetes --format json
node dist/cli/bin.js search --registry ictrp --condition diabetes --page-size 5 --format text
# 신고하지 않은 값은 exit 3 이어야 한다
node dist/cli/bin.js count --registry ictrp --condition diabetes --status completed; echo "exit=$?"
# 기존 동작이 안 바뀌었는지
node dist/cli/bin.js count --registry ctgov --condition diabetes --format json
```

`count --registry ictrp --condition diabetes` 가 **3만 건대**여야 한다. 6,844 근처면
`ddlRecruitingStatus` 가 안 실린 것이다(§1.1).

- [ ] **Step 7: 커밋**

```bash
git add src/adapters/ictrp/adapter.ts src/adapters/index.ts tests/contract/ictrp.contract.test.ts
git commit -m "feat(ictrp): declare the capability and wire the adapter in"
```

---

### Task 10: 필드테스트 스크립트

**Files:**
- Create: `scripts/ictrp-field-test.ts`
- Modify: `package.json` (`ictrp-field-test` 스크립트)

**Interfaces:**
- Consumes: `ICTRP_CAPABILITY`, `createIctrpAdapter`, `scripts/exhaustive.ts`
- Produces: 실행 가능한 스크립트. 문서 파일 하나를 낸다.

- [ ] **Step 1: 스크립트를 쓴다**

`scripts/isrctn-field-test.ts` 의 구조를 따른다. 재는 것 넷:

1. **모집 상태 기본값 불변식(가장 중요).** 같은 질의를 `--status` 없이와 `--status recruiting`
   으로 각각 세어, **두 수가 달라야 한다.** 같으면 `ddlRecruitingStatus` 가 안 실려 모든 질의가
   조용히 모집중만인 것이다(§1.1). 이 검사가 이 스크립트의 존재 이유다.
2. **알려진 질의가 0 이 아니다.** `condition=diabetes` 가 0건이면 파싱이 깨진 것이다 —
   `parse.ts` 의 자기 고장 감지가 못 잡는 유일한 경우(건수 문구 형식이 바뀐 때)를 여기서 잡는다.
3. **축별 양방향 확인.** `true` 로 신고한 축은 더했을 때 건수가 줄어야 하고, `false` 로 신고한
   축은 애초에 폼에 자리가 없다(`form.test.ts` 가 픽스처로 검사하므로 여기서는 생략).
4. **`phase` 의 `exhaustive`.** 값별 건수의 합을 전체와 대조한다. `judgeExhaustive` 와
   `compareDeclared` 를 그대로 쓴다. **선언은 `ICTRP_CAPABILITY` 에서 읽는다** — 리터럴을
   적으면 대조가 자기 자신을 검사한다.

`status` 는 값이 하나뿐이라 합/총계 대조가 성립하지 않는다. **재지 못한다고 적고** 넘어간다 —
`exhaustive: false` 는 "증명하지 못했으면 덜 신고한다" 는 규칙의 결과이지 실측이 아니다.

두 기존 스크립트가 그러듯 선언을 읽는 자리에 주석을 단다:

```ts
    // 선언은 **capability 에서 읽는다.** 여기에 리터럴을 적으면 이 대조는 자기 자신을
    // 검사하게 된다 — 그리고 이 이음매를 붙드는 테스트는 없다(스크립트가 네트워크를
    // 치므로 스위트가 부를 수 없다). 고칠 때 눈으로 지켜야 하는 줄이다.
    const declared = ICTRP_CAPABILITY.search[a.axis].exhaustive;
```

- [ ] **Step 2: 돌린다**

```bash
npm pkg set scripts.ictrp-field-test="bun run scripts/ictrp-field-test.ts"
bun run ictrp-field-test
```

- [ ] **Step 3: 실측을 capability 에 반영한다**

`phase.exhaustive` 를 실측 결과로 바꾼다. 실측이 판정 불가(`null`)면 **`false` 를 유지한다** —
`null` 로 신고하면 계약 스위트와 `compareDeclared` 가 둘 다 막는다(P1).

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run && npm run typecheck`
Expected: 전부 통과. `phase.exhaustive` 를 바꿨다면 계약 스위트가 여전히 초록인지 본다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/ictrp-field-test.ts package.json src/adapters/ictrp/adapter.ts docs
git commit -m "test(field): measure ICTRP declarations against the live portal"
```

---

### Task 11: 문서

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-26-ictrp-as-its-own-registry-design.md` (상태 표시)
- Modify: `docs/slice-2-prerequisites.md` (어댑터 #3 표시)

- [ ] **Step 1: README 를 고친다**

세 곳:

1. 「이 슬라이스의 범위」에 ICTRP 를 더하고 **무엇을 못 하는지**를 적는다 — `get`·`results`
   미지원, 국가 단위 위치, 상태는 모집중/아님 둘뿐, 페이지 N 을 받으려면 요청 N+1 번.
2. **약관 한 줄**: WHO ICTRP 데이터는 비상업 용도이고, 출처를 WHO ICTRP 로 표기해야 하며,
   주간으로 수확된 사본이다(실측: 원본보다 약 7일 뒤).
3. **같은 시험이 두 ctreg id 를 갖는다**는 것을 적는다 — `CTGOV:NCT07749586` 과
   `ICTRP:NCT07749586` 은 같은 시험의 서로 다른 사본이고, 이 도구는 둘을 묶지 않는다.

- [ ] **Step 2: 스펙과 정본에 완료를 표시한다**

스펙 머리말의 `상태` 를 `구현됨 — 커밋 <해시>` 로 바꾸고, `docs/slice-2-prerequisites.md` 의
「두 번째 어댑터 후보」 절에 어댑터 #3 이 붙었다는 줄을 더한다. **커밋 해시를 지어내지 않는다** —
앞 태스크들의 실제 해시를 `git log` 로 확인해 적는다.

- [ ] **Step 3: 확인하고 커밋한다**

```bash
npx vitest run && npm run typecheck
git add README.md docs
git commit -m "docs: say what ICTRP can and cannot do, and under which terms"
```

---

## 자기 검토 (계획을 쓴 뒤 확인한 것)

**스펙 커버리지**

| 스펙 절 | 태스크 |
| :-- | :-- |
| §1.1 모집 기본값 함정 | Task 6(구현·테스트), Task 10(불변식 1) |
| §2 축 매핑 | Task 9 |
| §2.1 phase | Task 6, Task 10 |
| §2.2 status + 레코드 매핑 | Task 3(가드), Task 7(매핑) |
| §3.1 검색 왕복 | Task 8 |
| §3.2 페이지 토큰 | Task 8, Task 9 |
| §3.3 get/results 미지원 | Task 9 |
| §4 필드테스트 | Task 10 |
| §5.0 http POST | Task 1 |
| §5.1 ID 추론 | Task 2 |
| §5.2 값 부분집합 가드 | Task 3 |
| §6 자기 고장 감지 | Task 5 |
| §7 약관·`sourceRefreshedAt` | Task 7(필드), Task 11(README) |
| §8 범위 | 전체 |
| §9 한계 | Task 9(`scope`), Task 11(README) |

**남겨 둔 것 하나:** `sourceRefreshedAt` 은 필드만 세우고 채우지 않는다. 결과 행에 수확일이
없기 때문이고(§7), 채우는 것은 `get` 이 열릴 때다. 계획이 이것을 숨기지 않도록 Task 7 의
테스트가 `toBeUndefined()` 로 **비어 있음을 명시적으로 고정**한다.
