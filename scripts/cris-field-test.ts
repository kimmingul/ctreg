/**
 * CRIS capability 선언을 **실물 API 에 대조한다.**
 *
 * 왜 계약 스위트로는 안 되는가. 계약 스위트는 스텁 트랜스포트로 돈다 — 무엇을 물어보든
 * 픽스처를 돌려주므로, 공공데이터포털이 파라미터 이름을 바꾸거나 상세 응답에서 필드를
 * 빼도 초록이다. 이 어댑터는 특히 그렇다: **`--investigator` 가 상세 응답의
 * `scientific_name_kr` 하나에 얹혀 있다.** 그 필드가 사라지면 이 축은 오류가 아니라
 * **0건** 을 낸다 — "그런 연구가 없다" 와 출력상 구별되지 않는 실패다.
 *
 * 다섯을 본다.
 *
 * 1. **알려진 질의가 0 이 아니다.** API 가 살아 있고 `srchWord` 가 여전히 문자열을 문다.
 * 2. **`srchWord` 가 실제로 좁힌다.** 검색어 없이 부른 총계보다 작아야 한다. 같으면
 *    검색어가 통째로 무시되는 것이고, 그때 결과는 "검색된 것" 이 아니라 "앞에서부터 N 건" 이다.
 * 3. **상세가 연구책임자를 아직 낸다.** `--investigator` 의 유일한 근거다.
 * 4. **미지원으로 신고한 것이 아직도 미지원이다.** 목록에 없는 파라미터(`charge_name`,
 *    `recruitment_status`)를 보내 **건수가 변하지 않는지** 본다. 변하면 우리가 못 쓴다고
 *    신고해 둔 기능이 실제로는 열려 있다는 뜻이고, 사용자에게 근거 없이 exit 3 을 주고 있다.
 *    **여기서 "무시된다" 는 것 자체도 위험 신호다** — 포털이 모르는 파라미터를 조용히
 *    버리므로, 우리가 이름을 잘못 적어도 아무 소리가 안 난다.
 * 5. **선언한 한계가 맞다.** `maxPageSize` 50, 없는 번호는 `03`(NODATA), 상세의 날짜가
 *    슬래시로 온다는 것까지.
 *
 * 결과는 docs/cris-field-test-<날짜>.md 로 남는다. 우리 HTTP 층을 그대로 쓰므로
 * 재시도·타임아웃·요청률이 어댑터와 같다. 인증키가 없으면 **측정하지 않고 그렇게 적는다** —
 * 없는 값을 지어내지 않는다.
 */
import { writeFileSync } from 'node:fs';
import { CRIS_CAPABILITY, createCrisAdapter } from '../src/adapters/cris/adapter.js';
import { CRIS_PI_ROLE } from '../src/adapters/cris/map.js';
import type { NormalizedQuery } from '../src/core/query.js';
import { loadConfig, loadEnvFile } from '../src/runtime/config.js';
import { CtregError } from '../src/runtime/errors.js';
import { getJson } from '../src/runtime/http.js';

loadEnvFile(`${process.cwd()}/.env`);

type Verdict = 'pass' | 'fail' | 'inconclusive';
const LABEL: Record<Verdict, string> = { pass: '✅ 통과', fail: '❌ 실패', inconclusive: '⚠️ 불확정' };

const cfg = loadConfig();
const adapter = createCrisAdapter(cfg);

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

/** 날것으로 한 번 부른다. 어댑터가 감싸지 않은 응답을 봐야 하는 검사가 있다. */
async function raw(
  path: '/list' | '/detail',
  params: Record<string, string | number>,
): Promise<Record<string, unknown>> {
  const r = await getJson<Record<string, unknown>>(
    cfg,
    {
      registry: 'cris',
      baseUrl: cfg.crisBaseUrl,
      path,
      params: { serviceKey: cfg.crisServiceKey ?? '', resultType: 'json', ...params },
      redactParams: ['serviceKey'],
      cacheMode: 'off',
      ratePerSec: CRIS_CAPABILITY.limits.ratePerSec,
    },
    {},
  );
  return r.value;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? NaN));

async function main(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);

  if (cfg.crisServiceKey === undefined || cfg.crisServiceKey.trim() === '') {
    console.error(
      'CTREG_CRIS_SERVICE_KEY 가 없습니다. 이 스크립트는 실물에 대조하는 것이 전부이므로 ' +
        '측정하지 않고 끝냅니다 — 키 없이 낸 결과는 아무것도 확인하지 않은 초록입니다.',
    );
    process.exit(2);
  }

  // 1. 알려진 질의가 0 이 아니다.
  let baseline = NaN;
  try {
    const all = await raw('/list', { numOfRows: 1, pageNo: 1 });
    baseline = num(all.totalCount);
    const known = await adapter.count({ term: '당뇨병' } as NormalizedQuery, fetchOpts);
    record(
      '알려진 질의가 0이 아니다',
      known.data > 0 ? 'pass' : 'fail',
      `당뇨병 ${known.data}건 / 전체 ${baseline}건`,
      '0이면 API 가 죽었거나 srchWord 가 더 이상 문자열을 물지 않는다',
    );

    // 2. srchWord 가 실제로 좁힌다.
    record(
      'srchWord 가 좁힌다',
      known.data < baseline ? 'pass' : 'fail',
      `${known.data} < ${baseline}`,
      '같으면 검색어가 통째로 무시되는 것이고, 결과는 검색된 것이 아니라 앞에서부터 N건이다',
    );
  } catch (e) {
    record('알려진 질의가 0이 아니다', 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));
  }

  // 3. 상세가 연구책임자를 아직 낸다 — --investigator 의 유일한 근거.
  try {
    const got = await adapter.get(['CRIS:KCT0000145'], fetchOpts);
    const rec = got.data[0];
    const pi = (rec?.contacts ?? []).filter((c) => c.role === CRIS_PI_ROLE);
    /**
     * **국문·영문을 둘 다 봐야 한다.** `pi.length > 0` 만 보면 한쪽이 사라져도 통과한다 —
     * 사보타주로 확인했다(국문을 지웠는데 영문이 남아 초록이었다). `--investigator` 는
     * 어느 표기로 물어도 걸리는 것이 약속이므로, 한쪽이 빠지면 그 표기로 찾는 쪽이 못 찾는다.
     * 이 표본(KCT0000145)은 둘 다 실려 있는 것을 실측했다: `김민걸` / `Min gul Kim`.
     */
    const hasKo = pi.some((c) => /[가-힣]/.test(c.name ?? ''));
    const hasEn = pi.some((c) => /[A-Za-z]/.test(c.name ?? ''));
    record(
      '상세가 연구책임자를 국문·영문 둘 다 낸다',
      hasKo && hasEn ? 'pass' : 'fail',
      pi.length > 0 ? `${pi.map((c) => c.name).join(', ')} (국문 ${hasKo}, 영문 ${hasEn})` : '연구책임자 연락처 없음',
      '이 필드가 사라지면 --investigator 는 오류가 아니라 0건을 낸다 — 그런 연구가 없다와 구별되지 않는다. 한쪽만 빠져도 그 표기로 찾는 쪽이 못 찾는다',
    );
    record(
      '상세가 모집현황을 낸다',
      rec?.statusRaw !== undefined ? 'pass' : 'fail',
      rec?.statusRaw ?? '없음',
      '없으면 get 의 status 가 search 와 같은 unknown 으로 되돌아간다',
    );
  } catch (e) {
    record('상세가 연구책임자를 낸다', 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));
  }

  // 4. 미지원으로 신고한 것이 아직도 미지원이다.
  for (const [name, value] of [
    ['charge_name', '김민걸'],
    ['recruitment_status', '모집 중'],
  ] as const) {
    try {
      const withParam = await raw('/list', { numOfRows: 1, pageNo: 1, [name]: value });
      const n = num(withParam.totalCount);
      record(
        `${name} 이 아직도 안 먹는다`,
        n === baseline ? 'pass' : 'fail',
        `${n} (기준 ${baseline})`,
        '건수가 달라지면 우리가 못 한다고 신고해 둔 기능이 열려 있다는 뜻이다 — 근거 없이 exit 3 을 주고 있다',
      );
    } catch (e) {
      record(`${name} 이 아직도 안 먹는다`, 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));
    }
  }

  // 5. 선언한 한계가 맞다.
  try {
    const over = await raw('/list', { srchWord: '당뇨병', numOfRows: 100, pageNo: 1 });
    const got = Array.isArray(over.items) ? over.items.length : 0;
    record(
      `maxPageSize 가 ${CRIS_CAPABILITY.limits.maxPageSize} 이다`,
      got === CRIS_CAPABILITY.limits.maxPageSize ? 'pass' : 'fail',
      `100 을 요청해 ${got}건`,
      '선언보다 많이 오면 페이지 계산이 어긋나고, 적게 오면 우리가 쓸 수 있는 것을 안 쓰고 있다',
    );
  } catch (e) {
    record('maxPageSize', 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));
  }

  try {
    const none = await raw('/detail', { crisNumber: 'KCT9999999' });
    record(
      '없는 번호는 03(NODATA)이다',
      none.resultCode === '03' ? 'pass' : 'fail',
      String(none.resultCode),
      '다른 코드로 바뀌면 어댑터가 그것을 오류로 다뤄, 없는 시험이 레지스트리 장애로 보고된다',
    );
  } catch (e) {
    record('없는 번호는 03(NODATA)이다', 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));
  }

  try {
    const d = await raw('/detail', { crisNumber: 'KCT0000145' });
    const reg = String(d.date_registration ?? '');
    record(
      '상세의 날짜가 아직 슬래시다',
      /^\d{4}\/\d{2}\/\d{2}$/.test(reg) ? 'pass' : 'inconclusive',
      reg,
      '목록은 하이픈, 상세는 슬래시다. 바뀌어도 map.ts 가 둘 다 받으므로 실패는 아니지만, 바뀌면 그 방어가 무의미해진다',
    );
  } catch (e) {
    record('상세의 날짜 형식', 'inconclusive', '요청 실패', (e as Error).message.slice(0, 80));
  }

  const md = [
    `# CRIS 필드 테스트 — ${stamp}`,
    '',
    '`CRIS_CAPABILITY` 의 선언을 공공데이터포털의 실물 API 에 대조한 결과.',
    '계약 스위트는 스텁으로 돌기 때문에 이런 종류의 어긋남을 원리상 잡지 못한다.',
    '',
    '**가장 중요한 줄은 「상세가 연구책임자를 낸다」이다.** `--investigator` 가 그 필드 하나에',
    '얹혀 있고, 필드가 사라지면 축은 오류가 아니라 0건을 낸다 — 이 CLI 가 없애려는 실패다.',
    '',
    '**「아직도 안 먹는다」 줄이 통과하는 것은 좋은 소식이 아니다.** 포털이 모르는 파라미터를',
    '조용히 버린다는 뜻이고, 그래서 우리가 이름을 잘못 적어도 아무 소리가 나지 않는다.',
    '`crisNumber` 를 찾는 데 11번 헛짚은 이유가 이것이다.',
    '',
    '| 무엇 | 판정 | 실측 | 왜 보나 |',
    '| :-- | :-- | :-- | :-- |',
    ...rows,
    '',
    `통과 ${tally.pass} / 실패 ${tally.fail} / 불확정 ${tally.inconclusive}`,
    '',
  ].join('\n');

  const path = `docs/cris-field-test-${stamp}.md`;
  writeFileSync(path, md);
  console.error(`\n${path} 에 기록했습니다. 통과 ${tally.pass} / 실패 ${tally.fail} / 불확정 ${tally.inconclusive}`);
  process.exit(tally.fail > 0 ? 1 : 0);
}

void main().catch((e: unknown) => {
  console.error(e instanceof CtregError ? `${e.message}\n${e.hint ?? ''}` : e);
  process.exit(1);
});
