/**
 * CTIS capability 선언을 **실물 API 에 대조한다.**
 *
 * 왜 계약 스위트로는 안 되는가. 계약 스위트는 스텁 트랜스포트로 돈다 — 무엇을 물어보든
 * 픽스처를 돌려주므로, EMA 가 검색 키를 바꾸거나 상세 응답의 구조를 옮겨도 초록이다.
 *
 * **이 어댑터는 다섯 중에서도 특히 위험하다.** 신고의 절반이 "조용히 무시된다" 를 막는
 * 것 위에 얹혀 있기 때문이다: 이 API 는 **모르는 검색 키를 조용히 버린다**(실측 —
 * 있지도 않은 `zzNoSuchKey` 를 보내도 전체가 그대로 온다). 그래서 우리는 헛소리 값으로
 * 건수가 변하는지를 재서 **실제로 거르는 다섯만** 신고했고, 나머지는 exit 3 으로 막았다.
 * 그 지형이 바뀌면 무엇 하나 오류를 내지 않는다:
 *
 * - 거르던 키가 무시되기 시작하면 → **좁혀지지 않은 결과가 좁혀진 것처럼** 나간다.
 * - 무시되던 키가 열리면 → 사용자에게 **근거 없이 exit 3** 을 주고 있다.
 * - `msc` 코드표가 어긋나면 → 오류가 아니라 **0건** 이다. "그 나라에 시험이 없다" 와
 *   출력상 구별되지 않는다.
 * - 상세 응답의 깊은 경로(`authorizedApplication.authorizedPartI…`)가 옮겨지면 →
 *   `get` 은 실패하지 않는다. **제목도 질환도 의뢰기관도 빈 레코드** 를 성실히 낸다.
 *
 * 넷 다 "조용히 틀린 답" 이고, 이 CLI 가 없애려는 실패가 바로 그것이다.
 *
 * 아홉을 본다.
 *
 * 1. **거른다고 신고한 다섯이 여전히 거른다.** `containAll`·`title`·`medicalCondition`·
 *    `sponsor`·`msc`. 각 축마다 **`0 < 건수 < 전체`** 를 함께 본다 — `> 0` 만 보면 키가
 *    통째로 무시되어 전체가 와도 통과한다(CRIS 필드테스트에서 첫 단언이 헐거워 한 번 걸렸다).
 * 2. **모르는 키가 여전히 조용히 무시된다.** 이것이 참이어야 우리가 좁게 신고한 것이
 *    정당하다. 동시에 **이 통과는 좋은 소식이 아니다** — 우리가 키 이름을 잘못 적어도
 *    아무 소리가 나지 않는다는 뜻이다.
 * 3. **`msc` 코드가 여전히 그 나라를 가리킨다.** 표본의 **모든** 결과가 그 나라를 담아야
 *    한다(공통 나라 하나만 보면 다른 코드와 뒤바뀐 것을 놓친다).
 * 4. **나라 이름과 알파벳 코드는 여전히 0건이다.** 이름 가드가 exit 3 으로 막는 근거다.
 * 5. **`retrieve/{id}` 가 상세를 아직 낸다.** 깊은 경로 하나하나를 본다 — 레코드가 왔다는
 *    것만 보면 안 된다. `registryId` 는 최상위에서 오므로 밑의 경로가 전부 무너져도
 *    번호 대조는 통과하고 **빈 레코드** 가 나간다.
 * 6. **없는 번호가 여전히 빈 응답이다.** 오류가 아니라 not_found 여야 한다.
 * 7. **접은 상태 코드 둘이 여전히 그 뜻이다.** 8→`Ended`, 11→`Not authorised`.
 *    2·3·4·5 가 아직도 갈리지 않는지도 함께 본다 — 갈리면 실패가 아니라 **열린 기회** 다.
 * 8. **번호를 자유 텍스트로 찾는 우회가 아직 된다.** `get` 이 이것 하나에 얹혀 있다.
 *    덤으로 **출처 표시** 가 살아 있는지 본다 — 빠지면 결함이 아니라 EMA 약관 위반이다.
 * 9. **`resultsFirstReceived` 가 아직 `Yes`/`No` 문자열이다.** 이름은 날짜처럼 생겼는데
 *    값은 불리언이다. 날짜로 바뀌면 `hasResults` 가 오류 없이 **전부 `undefined`** 가 된다 —
 *    "결과가 없다" 가 아니라 "모른다" 로 조용히 후퇴한다. 상세 쪽 `results` 키가 결과
 *    없는 시험에서 아직 `{}` 인지도 함께 본다.
 *
 * 결과는 docs/ctis-field-test-<날짜>.md 로 남는다. 우리 HTTP 층을 그대로 쓰므로
 * 재시도·타임아웃·요청률이 어댑터와 같다. **기준 건수를 못 받으면 측정하지 않고 멈춘다** —
 * 서버에 닿지 못한 채 돌리면 전 항목이 ⚠️ 인 채로 "정상 종료" 하고, 그건 아무것도 확인하지
 * 못한 초록이다.
 */
import { writeFileSync } from 'node:fs';
import { CTIS_CAPABILITY, CTIS_MAX_PAGE_SIZE, createCtisAdapter } from '../src/adapters/ctis/adapter.js';
import { CTIS_MSC_CODES } from '../src/adapters/ctis/countries.js';
import { CTIS_ATTRIBUTION, type CtisItem } from '../src/adapters/ctis/map.js';
import { loadConfig, loadEnvFile } from '../src/runtime/config.js';
import { CtregError } from '../src/runtime/errors.js';
import { getJson, postJson } from '../src/runtime/http.js';

loadEnvFile(`${process.cwd()}/.env`);

type Verdict = 'pass' | 'fail' | 'inconclusive';
const LABEL: Record<Verdict, string> = { pass: '✅ 통과', fail: '❌ 실패', inconclusive: '⚠️ 불확정' };

const cfg = loadConfig();
const adapter = createCtisAdapter(cfg);

const fetchOpts = {
  include: ['core' as const],
  caps: { locations: 10, eligibilityChars: 8000, outcomes: 20 },
  cacheMode: 'off' as const,
  raw: false,
};

const rows: string[] = [];
const tally: Record<Verdict, number> = { pass: 0, fail: 0, inconclusive: 0 };

function record(what: string, verdict: Verdict, measured: string, why: string): void {
  tally[verdict] += 1;
  rows.push(`| ${what} | ${LABEL[verdict]} | ${measured} | ${why} |`);
  console.error(`${LABEL[verdict]}  ${what} — ${measured}`);
}

const fails = (what: string, e: unknown): void =>
  record(what, 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));

type Page = {
  data?: CtisItem[];
  pagination?: { totalRecords?: number };
};

/**
 * 날것으로 부른다. **어댑터를 거치면 이 검사들이 성립하지 않는다** — 어댑터는 실제로
 * 거르는 키만 싣도록 만들어져 있어서, 무시되는 키를 보내 보는 검사가 불가능하다.
 * 여기서 재는 것은 어댑터가 아니라 **어댑터가 딛고 선 API 의 성질** 이다.
 */
async function search(criteria: Record<string, unknown>, size = 1): Promise<Page> {
  const r = await postJson<Page>(
    cfg,
    {
      registry: 'ctis',
      baseUrl: cfg.ctisBaseUrl,
      path: '/search',
      body: { pagination: { page: 1, size }, searchCriteria: criteria },
      cacheMode: 'off',
      ratePerSec: CTIS_CAPABILITY.limits.ratePerSec,
    },
    {},
  );
  return r.value;
}

const total = (p: Page): number => p.pagination?.totalRecords ?? NaN;

async function retrieve(id: string): Promise<Record<string, unknown>> {
  const r = await getJson<Record<string, unknown>>(
    cfg,
    {
      registry: 'ctis',
      baseUrl: cfg.ctisBaseUrl,
      path: `/retrieve/${encodeURIComponent(id)}`,
      params: {},
      cacheMode: 'off',
      ratePerSec: CTIS_CAPABILITY.limits.ratePerSec,
    },
    {},
  );
  return r.value;
}

/** 실측 2026-08-30 에 상세 응답의 모든 경로가 채워져 있는 것을 확인한 표본. */
const SAMPLE_ID = '2022-501417-31-00';

async function main(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);

  /**
   * **기준부터.** 조건 없이 부른 전체 건수가 이 스크립트의 자다 — "거른다" 도 "무시된다" 도
   * 전부 이 수와의 비교다. 이것을 못 받으면 나머지는 재는 시늉일 뿐이므로 앞에서 멈춘다.
   */
  let baseline = NaN;
  try {
    baseline = total(await search({}));
  } catch (e) {
    console.error(`기준 건수를 받지 못했습니다: ${(e as Error).message}`);
  }
  if (!Number.isFinite(baseline) || baseline <= 0) {
    console.error(
      'CTIS 공개 API 에 닿지 못했습니다. 이 스크립트는 실물에 대조하는 것이 전부이므로 ' +
        '측정하지 않고 끝냅니다 — 서버 없이 낸 결과는 전 항목 ⚠️ 인 채로 정상 종료하는, ' +
        '아무것도 확인하지 않은 초록입니다.',
    );
    process.exit(2);
  }
  console.error(`기준(조건 없음) ${baseline}건\n`);

  // 1. 거른다고 신고한 다섯이 여전히 거른다.
  const FILTERING: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ['containAll', { containAll: 'melanoma' }, '--term'],
    ['title', { title: 'melanoma' }, '--title'],
    ['medicalCondition', { medicalCondition: 'melanoma' }, '--condition'],
    ['sponsor', { sponsor: 'Pfizer' }, '--sponsor'],
    ['msc', { msc: [CTIS_MSC_CODES.Spain] }, '--location'],
  ];
  for (const [key, criteria, axis] of FILTERING) {
    try {
      const n = total(await search(criteria));
      /**
       * **두 경계를 함께 본다.** `n > 0` 만 보면 키가 통째로 무시되어 전체가 돌아와도
       * 통과한다 — 그게 정확히 이 API 의 실패 방식이다. `n < baseline` 만 보면 축이
       * 죽어 0건이 되는 쪽을 놓친다.
       */
      record(
        `${key} 가 여전히 거른다 (${axis})`,
        n > 0 && n < baseline ? 'pass' : 'fail',
        `${n} (기준 ${baseline})`,
        '기준과 같으면 이 키가 조용히 무시되기 시작한 것이고, 좁혀지지 않은 결과가 좁혀진 것처럼 나간다. 0이면 축이 죽었다',
      );
    } catch (e) {
      fails(`${key} 가 여전히 거른다 (${axis})`, e);
    }
  }

  // 2. 모르는 키가 여전히 조용히 무시된다 — 좁게 신고한 것의 근거.
  const IGNORED: readonly (readonly [string, unknown])[] = [
    ['zzNoSuchKey', 'zzzz'],
    ['trialPhase', 'zzzz'],
    ['ctStatus', 'zzzz'],
    ['ageGroup', 'zzzz'],
    ['country', 'zzzz'],
    ['product', 'zzzz'],
    ['therapeuticArea', 'zzzz'],
    ['ctNumber', SAMPLE_ID],
  ];
  for (const [key, value] of IGNORED) {
    try {
      const n = total(await search({ [key]: value }));
      record(
        `${key} 가 아직도 조용히 무시된다`,
        n === baseline ? 'pass' : 'fail',
        `${n} (기준 ${baseline})`,
        '건수가 달라지면 우리가 못 한다고 신고해 둔 축이 실제로는 열려 있다는 뜻이다 — 근거 없이 exit 3 을 주고 있다',
      );
    } catch (e) {
      fails(`${key} 가 아직도 조용히 무시된다`, e);
    }
  }

  // 3. msc 코드가 여전히 그 나라를 가리킨다.
  const SPOT_CHECK = ['Austria', 'France', 'Germany', 'Italy', 'Spain', 'Sweden'] as const;
  for (const name of SPOT_CHECK) {
    const code = CTIS_MSC_CODES[name]!;
    try {
      const page = await search({ msc: [code] }, 20);
      const items = page.data ?? [];
      /**
       * **공통 나라 하나로 판정하지 않는다.** 표를 만들 때는 교집합으로 뜻을 찾았지만,
       * 지키는 쪽에서는 **모든 결과가 그 나라를 담는지** 를 봐야 한다 — 코드 둘이
       * 뒤바뀌어도 두 나라가 자주 함께 도는 한 교집합에는 여전히 그 나라가 남는다.
       */
      const misses = items.filter(
        (it) => !(it.trialCountries ?? []).some((c) => c.split(':')[0]!.trim() === name),
      );
      record(
        `msc ${code} 가 아직 ${name} 다`,
        items.length > 0 && misses.length === 0 ? 'pass' : 'fail',
        `${total(page)}건 중 ${items.length}건 확인, 어긋남 ${misses.length}`,
        '코드가 어긋나면 오류가 아니라 다른 나라의 결과가 나온다. 표가 밀리면 사용자는 그것을 알 방법이 없다',
      );
    } catch (e) {
      fails(`msc ${code} 가 아직 ${name} 다`, e);
    }
  }

  // 4. 나라 이름과 알파벳 코드는 여전히 0건이다 — 이름 가드의 근거.
  for (const bad of ['Spain', 'ES']) {
    try {
      const n = total(await search({ msc: [bad] }));
      record(
        `msc 에 '${bad}' 를 보내면 아직 0건이다`,
        n === 0 ? 'pass' : 'fail',
        String(n),
        '이 0건이 나라 이름 가드의 근거다. 이름을 받기 시작했다면 가드가 쓸데없이 막고 있는 것이고, 기준과 같아졌다면 필터가 통째로 증발한 것이다',
      );
    } catch (e) {
      fails(`msc 에 '${bad}' 를 보내면 아직 0건이다`, e);
    }
  }

  // 5. retrieve/{id} 가 상세를 아직 낸다 — 깊은 경로 하나하나.
  try {
    const got = await adapter.get([`CTIS:${SAMPLE_ID}`], fetchOpts);
    const rec = got.data[0];
    if (rec === undefined) {
      record(
        '상세가 아직 온다',
        'fail',
        `not_found (${got.warnings.map((w) => w.code).join(', ')})`,
        '표본이 사라졌거나 번호 대조가 깨졌다. 어느 쪽이든 get 이 아무 시험도 내지 못한다',
      );
    } else {
      /**
       * **레코드가 왔다는 것만 보면 안 된다.** `registryId` 는 응답 최상위의 `ctNumber`
       * 에서 오므로, 그 밑의 `authorizedApplication.authorizedPartI…` 가 통째로
       * 옮겨져도 번호 대조는 통과한다. 그러면 `get` 은 실패하지 않고 **제목도 질환도
       * 의뢰기관도 빈 레코드** 를 낸다 — 오류보다 나쁘다.
       */
      const paths: readonly (readonly [string, boolean, string])[] = [
        ['제목(trialDetails.clinicalTrialIdentifiers)', rec.title !== '', rec.title],
        ['문자열 상태(ctStatus)', rec.statusRaw !== undefined, rec.statusRaw ?? '없음'],
        ['질환(medicalConditions[])', rec.conditions.length > 0, rec.conditions.join(' / ')],
        [
          '의뢰기관(sponsors[].publicContacts[].organisation.name)',
          rec.sponsor?.lead !== undefined,
          rec.sponsor?.lead ?? '없음',
        ],
        ['참여국(memberStatesConcerned[].mscName)', (rec.locations?.length ?? 0) > 0, String(rec.locations?.length ?? 0)],
        ['대상자 수(rowSubjectCount)', (rec.enrollment?.count ?? 0) > 0, String(rec.enrollment?.count ?? 0)],
      ];
      for (const [what, ok, measured] of paths) {
        record(
          `상세가 ${what} 를 아직 낸다`,
          ok ? 'pass' : 'fail',
          measured.slice(0, 60),
          '이 경로가 옮겨지면 get 은 오류가 아니라 그 자리가 빈 레코드를 낸다 — 번호 대조는 최상위 ctNumber 로 통과하기 때문이다',
        );
      }
      record(
        '레코드마다 출처 표시가 실린다',
        rec.attribution === CTIS_ATTRIBUTION ? 'pass' : 'fail',
        rec.attribution ?? '없음',
        'EMA 법적 고지가 each copy 에 요구하는 것이다 — 빠지면 결함이 아니라 이용 조건 위반이다',
      );
    }
  } catch (e) {
    fails('상세가 아직 온다', e);
  }

  // 6. 없는 번호가 여전히 빈 응답이다.
  try {
    const none = await retrieve('2099-999999-99-00');
    record(
      '없는 번호는 아직 빈 응답이다',
      Object.keys(none).length === 0 ? 'pass' : 'fail',
      `HTTP 200, 키 ${Object.keys(none).length}개`,
      '빈 응답이라 번호 대조에서 걸려 not_found 가 된다. 404 나 오류로 바뀌면 없는 시험이 레지스트리 장애로 보고된다',
    );
    const got = await adapter.get(['CTIS:2099-999999-99-00'], fetchOpts);
    record(
      '없는 번호가 오류가 아니라 not_found 다',
      got.data.length === 0 && got.warnings.some((w) => w.code === 'not_found') ? 'pass' : 'fail',
      `레코드 ${got.data.length}건, 경고 ${got.warnings.map((w) => w.code).join(', ') || '없음'}`,
      '"그런 시험이 없다" 와 "레지스트리가 고장났다" 가 같은 출력이 되면 안 된다',
    );
  } catch (e) {
    fails('없는 번호는 아직 빈 응답이다', e);
  }

  // 7. 접은 상태 코드 둘이 여전히 그 뜻이다.
  try {
    const page = await search({ containAll: 'melanoma' }, CTIS_MAX_PAGE_SIZE);
    const items = page.data ?? [];
    record(
      `maxPageSize ${CTIS_MAX_PAGE_SIZE} 를 요청하면 그만큼 온다`,
      items.length === CTIS_MAX_PAGE_SIZE ? 'pass' : 'fail',
      `${CTIS_MAX_PAGE_SIZE} 를 요청해 ${items.length}건 (전체 ${total(page)}건)`,
      '적게 오면 페이지 계산이 어긋나 뒷쪽을 건너뛴다 — 조용히 빠진 시험이 생긴다',
    );

    /** 검색의 숫자 코드를 상세의 문자열과 맞춰 본다. 표를 만들 때 쓴 방법 그대로다. */
    const seen = new Map<string, string>();
    for (const it of items) {
      const code = String(it.ctStatus ?? '');
      const num = (it.ctNumber ?? '').trim();
      if (code !== '' && num !== '' && !seen.has(code)) seen.set(code, num);
    }
    const EXPECT: Readonly<Record<string, string>> = { '8': 'Ended', '11': 'Not authorised' };
    /**
     * **표본에 안 나온 코드는 조용히 넘기지 않는다.** 이 쪽에 코드 11 이 없는 회차가
     * 흔한데(드문 값이다), 그때 검사가 안 돈 것과 통과한 것이 출력상 같아지면 안 된다.
     * 표본에 나온 것만 보고 초록이라고 적는 것이 이 스크립트가 막으려는 실패 그 자체다.
     */
    for (const code of Object.keys(EXPECT)) {
      if (!seen.has(code)) {
        record(
          `상태 코드 ${code} 이 아직 '${EXPECT[code]!}' 다`,
          'inconclusive',
          '이 표본 쪽에 나오지 않았다',
          '검사가 돌지 않았다는 뜻이지 통과했다는 뜻이 아니다. 드문 코드라 다른 질의에서 다시 재야 한다',
        );
      }
    }
    const authorised: string[] = [];
    for (const [code, id] of [...seen].sort()) {
      const text = String((await retrieve(id)).ctStatus ?? '');
      const want = EXPECT[code];
      if (want !== undefined) {
        record(
          `상태 코드 ${code} 이 아직 '${want}' 다`,
          text === want ? 'pass' : 'fail',
          `${id} → '${text}'`,
          '이 둘만 공통 어휘로 접는다. 뜻이 바뀌면 끝난 시험을 다른 상태로 신고하게 된다',
        );
      } else {
        authorised.push(`${code}→'${text}'`);
      }
    }
    if (authorised.length > 0) {
      /**
       * 2·3·4·5 는 상세에서도 전부 `Authorised` 라 갈리지 않는다(실측, 네 필드 확인).
       * 갈리기 시작하면 **실패가 아니라 열린 기회** 다 — 그때 `unknown` 을 풀 수 있다.
       */
      const allSame = authorised.every((s) => s.endsWith("→'Authorised'"));
      record(
        '접지 못한 코드들이 아직 갈리지 않는다',
        allSame ? 'pass' : 'inconclusive',
        authorised.join(', '),
        "전부 'Authorised' 이면 unknown 으로 둔 판단이 여전히 옳다. 갈리기 시작했다면 실패가 아니라 표를 넓힐 기회다",
      );
    }
  } catch (e) {
    fails('상태 코드가 아직 그 뜻이다', e);
  }

  // 8. 번호를 자유 텍스트로 찾는 우회가 아직 된다 — get 이 이것 하나에 얹혀 있다.
  try {
    const page = await search({ containAll: SAMPLE_ID }, 5);
    const nums = (page.data ?? []).map((it) => (it.ctNumber ?? '').trim());
    record(
      '자유 텍스트에 번호를 넣으면 그 한 건이 나온다',
      total(page) === 1 && nums[0] === SAMPLE_ID ? 'pass' : 'fail',
      `${total(page)}건: ${nums.join(', ') || '없음'}`,
      'ctNumber 로 거는 자리가 없어 get 이 이 우회에 얹혀 있다. 여러 건이 오면 대조가 첫 건을 버리게 되고, 0건이면 get 이 통째로 죽는다',
    );
  } catch (e) {
    fails('자유 텍스트에 번호를 넣으면 그 한 건이 나온다', e);
  }

  // 9. resultsFirstReceived 가 아직 Yes/No 문자열이다 — hasResults 의 유일한 근거.
  try {
    const page = await search({}, CTIS_MAX_PAGE_SIZE);
    const items = page.data ?? [];
    const vals = new Set(items.map((it) => String(it.resultsFirstReceived ?? '')));
    const known = [...vals].filter((v) => v === 'Yes' || v === 'No');
    const strays = [...vals].filter((v) => v !== 'Yes' && v !== 'No');
    /**
     * **날짜로 바뀌면 오류가 아니라 침묵이다.** 매퍼는 `Yes`/`No` 가 아닌 값을 모두
     * `undefined` 로 두므로(모르는 것을 `false` 로 접지 않기 위해서다), 형식이 바뀌면
     * `hasResults` 가 통째로 사라지고 아무도 그것을 알아채지 못한다.
     */
    record(
      'resultsFirstReceived 가 아직 Yes/No 문자열이다',
      known.length > 0 && strays.length === 0 ? 'pass' : 'fail',
      `${items.length}건에서 본 값: ${[...vals].map((v) => `'${v}'`).join(', ')}`,
      '이름은 날짜처럼 생겼는데 값은 불리언이다. 형식이 바뀌면 hasResults 가 오류 없이 전부 사라진다 — 없다가 아니라 모른다로 조용히 후퇴한다',
    );

    const yes = items.find((it) => it.resultsFirstReceived === 'Yes');
    const no = items.find((it) => it.resultsFirstReceived === 'No');
    /** 검색이 낸 유무와 상세의 `results` 가 **같은 말을 하는가.** 갈리면 어느 쪽도 못 믿는다. */
    for (const [label, item, want] of [
      ['결과 있음', yes, true],
      ['결과 없음', no, false],
    ] as const) {
      if (item === undefined) {
        record(
          `상세의 results 가 검색과 일치한다 (${label})`,
          'inconclusive',
          '이 표본 쪽에 없었다',
          '검사가 돌지 않았다는 뜻이지 통과했다는 뜻이 아니다',
        );
        continue;
      }
      const d = await retrieve((item.ctNumber ?? '').trim());
      const r = d.results;
      const present = r !== undefined && r !== null && typeof r === 'object';
      const len = (k: string): number => {
        const v = present ? (r as Record<string, unknown>)[k] : undefined;
        return Array.isArray(v) ? v.length : 0;
      };
      const n = len('summaryResults') + len('laypersonResults');
      record(
        `상세의 results 가 검색과 일치한다 (${label})`,
        present && (n > 0) === want ? 'pass' : 'fail',
        `${item.ctNumber ?? ''} → results ${present ? `문서 ${n}건` : '키 없음'}`,
        '검색의 Yes/No 와 상세의 results 가 갈리면 어느 쪽도 못 믿는다. 상세의 키는 결과가 없어도 {} 로 있어야 한다 — 사라지면 모른다가 된다',
      );
    }
  } catch (e) {
    fails('resultsFirstReceived 가 아직 Yes/No 문자열이다', e);
  }

  const md = [
    `# CTIS 필드 테스트 — ${stamp}`,
    '',
    '`CTIS_CAPABILITY` 의 선언을 EMA 공개 API 의 실물에 대조한 결과.',
    '계약 스위트는 스텁으로 돌기 때문에 이런 종류의 어긋남을 원리상 잡지 못한다.',
    '',
    '**이 어댑터의 신고는 "조용히 무시된다" 위에 얹혀 있다.** 이 API 는 모르는 검색 키를',
    '버리면서 아무 소리도 내지 않으므로, 어느 키가 진짜로 거르는지를 헛소리 값으로 재서',
    '다섯만 신고하고 나머지는 exit 3 으로 막았다. 그 지형이 바뀌면 **오류가 아니라 조용히',
    '틀린 답** 이 나간다 — 좁혀지지 않은 결과가 좁혀진 것처럼, 또는 열려 있는 축이 막힌 채로.',
    '',
    '**「아직도 조용히 무시된다」 줄이 통과하는 것은 좋은 소식이 아니다.** 우리가 키 이름을',
    '잘못 적어도 아무 소리가 나지 않는다는 뜻이기도 하다.',
    '',
    '**「상세가 … 를 아직 낸다」 줄들이 이 파일에서 가장 조용한 실패를 지킨다.** `registryId`',
    '는 응답 최상위에서 오므로 그 밑의 깊은 경로가 통째로 옮겨져도 번호 대조는 통과하고,',
    '`get` 은 실패하지 않은 채 **빈 레코드** 를 낸다.',
    '',
    '| 무엇 | 판정 | 실측 | 왜 보나 |',
    '| :-- | :-- | :-- | :-- |',
    ...rows,
    '',
    `통과 ${tally.pass} / 실패 ${tally.fail} / 불확정 ${tally.inconclusive}`,
    '',
  ].join('\n');

  const path = `docs/ctis-field-test-${stamp}.md`;
  writeFileSync(path, md);
  console.error(`\n${path} 에 기록했습니다. 통과 ${tally.pass} / 실패 ${tally.fail} / 불확정 ${tally.inconclusive}`);
  process.exit(tally.fail > 0 ? 1 : 0);
}

void main().catch((e: unknown) => {
  console.error(e instanceof CtregError ? `${e.message}\n${e.hint ?? ''}` : e);
  process.exit(1);
});
