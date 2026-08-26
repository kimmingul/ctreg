/**
 * ICTRP capability 선언을 **실물 포털에 대조한다.**
 *
 * 왜 계약 스위트로는 안 되는가. 계약 스위트는 스텁 트랜스포트로 돈다 — 무엇을 물어보든
 * 픽스처를 돌려주므로, `buildForm` 이 `ddlRecruitingStatus` 를 빠뜨려도, `txtFreeCountry`
 * 가 서버에서 조용히 무시되어도 초록이다. ICTRP 는 공개 API 가 없는 ASP.NET WebForms
 * 화면이라 이런 종류의 오류는 실물에 쳐 보는 것 말고는 잡을 방법이 없다.
 *
 * 재시도/백오프는 이 스크립트가 새로 만들지 않는다 — `runtime/http.ts` 의 `getJson`/
 * `postForm` 이 이미 429/500/502/503/504 를 지수 백오프로 재시도하고, 요청률 제한도
 * `ICTRP_CAPABILITY.limits.ratePerSec`(1/s) 를 어댑터가 그대로 쓴다. 오늘(2026-08-26)도
 * 사이트가 502·타임아웃을 반복해서 냈다 — 그 재시도를 다 쓰고도 실패하면, 이 스크립트는
 * 그 측정을 **통과도 실패도 아닌 "측정 못함"** 으로 적는다. 없는 값을 지어내지 않는다.
 *
 * 넷을 잰다(우선순위 순):
 *
 * 1. **모집 상태 기본값 불변식 — 이 스크립트의 존재 이유.** `ddlRecruitingStatus` 를
 *    안 실으면 서버가 "Recruiting only" 를 기본값으로 쓴다(§1.1). 같은 질의를 필터
 *    없이와 `--status recruiting` 으로 각각 세어 **두 수가 달라야** 한다. 같으면 그
 *    필드가 안 실리고 있다는 뜻이고, 모든 ICTRP 결과가 조용히 모집중만으로 좁혀지고
 *    있다는 뜻이다 — 경고 하나 없이.
 * 2. **알려진 질의가 0 이 아니다.** `parse.ts` 는 "N records for M trials found" 문구가
 *    없으면 `records = 0` 으로 읽고, 자기 고장 감지는 `records > 0` 일 때만 걸린다.
 *    그 문구 형식 자체가 바뀌는 경우를 잡는 것은 이 검사뿐이다.
 * 3. **축별 양방향 확인.** `true` 로 신고한 축마다 그 축만 쓴 질의가 무필터 기준선보다
 *    좁혀야 한다. 좁히지 못하는 축은 신고와 실제가 어긋난 것이다.
 * 4. **`phase` 의 `exhaustive` 를 실측한다.** 값별 합을 총계와 대조해 `judgeExhaustive` /
 *    `compareDeclared` 로 판정한다(두 로직은 그대로 쓴다 — `exhaustive.ts` 참고).
 *    `status` 는 값이 하나뿐이라 합/총계 대조가 성립하지 않는다 — **재지 못했다고
 *    적을 뿐** 판정을 지어내지 않는다.
 *
 * 덧붙여 둘을 살핀다(선언과 무관해 집계에 넣지 않는다):
 * - **딥 페이징**: 2~4페이지는 이미 확인됐다. 보이는 페이저 링크 창(2~10, 그리고
 *   "Last") 너머로도 순차 postback 이 버티는지를 본다.
 * - **retrospective 플래그 열**: 지금까지 본 모든 행에서 이 열이 비어 있었다. 실제로
 *   찬 행이 있으면 `parse.ts` 의 "첫 비어있지 않은 셀이 제목" 규칙이 그 값을 제목으로
 *   잘못 읽을 수 있다(§ parse.ts 주석). 표본을 넓혀 찾아본다.
 *
 * 결과는 docs/ictrp-field-test-<날짜>.md 로 남는다.
 */
import { writeFileSync } from 'node:fs';
import { ICTRP_CAPABILITY, createIctrpAdapter } from '../src/adapters/ictrp/adapter.js';
import { ICTRP_FILTERABLE } from '../src/adapters/ictrp/query.js';
import type { Capability, SearchAxis } from '../src/core/capability.js';
import type { NormalizedQuery } from '../src/core/query.js';
import { loadConfig } from '../src/runtime/config.js';
import { CtregError } from '../src/runtime/errors.js';
import { compareDeclared, describeMeasured, judgeExhaustive } from './exhaustive.js';

type Verdict = 'pass' | 'fail' | 'inconclusive';
const LABEL: Record<Verdict, string> = { pass: '✅ 통과', fail: '❌ 실패', inconclusive: '⚠️ 측정 못함/불확정' };

const cfg = loadConfig();
const adapter = createIctrpAdapter(cfg);

const fetchOpts = {
  include: ['core' as const],
  caps: { locations: 10, eligibilityChars: 8000, outcomes: 20 },
  cacheMode: 'off' as const,
  raw: false,
};

/** `adapter.count` 를 감싸 실패를 예외가 아니라 값으로 돌려준다 — 사이트가 502/타임아웃을 낼 때 이 스크립트가 죽지 않고 "측정 못함" 으로 적기 위해서다. */
async function safeCount(q: NormalizedQuery): Promise<{ ok: true; n: number } | { ok: false; detail: string }> {
  try {
    const { data } = await adapter.count(q, fetchOpts);
    return { ok: true, n: data };
  } catch (e) {
    const detail = CtregError.is(e) ? `${e.code}: ${e.message}` : String(e);
    return { ok: false, detail };
  }
}

/**
 * true 로 신고한 축마다, **그 축을 실제로 쓰는** 질의 하나. 다른 조건과 섞으면 그쪽이
 * 결과를 만들어 죽은 축을 가려 준다 — ISRCTN 스크립트와 같은 이유다.
 *
 * `location` 은 한 번 죽어 있던 축이다 — `txtFreeCountry` 만 채우면 그 값이
 * `lstCountriesSelected` 로 옮겨지지 않아 필터가 서버에 도달하지 않았고, 이 스크립트가
 * 그것을 잡아(나라 셋이 전부 무필터 기준선과 같은 수) 축이 꺼졌다. 그 뒤 `butAdd` 왕복이
 * 실제로 필터를 건다는 것을 실측해(기준선 36,264 → `Japan` 2,981) 되살렸다.
 *
 * 그래서 아래 3절에서 이 축이 다시 "기준선과 같음" 으로 나오면 그것은 왕복이 빠졌다는
 * 뜻이다 — 그 진단을 실패 문구가 그대로 달고 있다.
 */
const AXIS_PROBE: Partial<Record<keyof Capability['search'], NormalizedQuery>> = {
  condition: { condition: 'diabetes' },
  intervention: { intervention: 'aspirin' },
  title: { title: 'covid' },
  lead: { lead: 'National Cancer Institute' },
  id: { id: 'NCT04280705' },
  location: { location: 'Zimbabwe' },
  status: { status: ['recruiting'] },
  phase: { phase: ['phase_3'] },
};

async function main() {
  const tally: Record<Verdict, number> = { pass: 0, fail: 0, inconclusive: 0 };
  const record = (v: Verdict) => { tally[v]++; };

  console.error('--- 1&2. 모집 상태 기본값 불변식 + 알려진 질의가 0 이 아니다 ---');
  const invariantRows: string[] = [];
  const diabetesAll = await safeCount({ condition: 'diabetes' });
  const diabetesRecruiting = await safeCount({ condition: 'diabetes', status: ['recruiting'] });

  let v1: Verdict;
  let note1: string;
  if (!diabetesAll.ok || !diabetesRecruiting.ok) {
    v1 = 'inconclusive';
    note1 = `요청 실패로 측정 못함 — 전체: ${diabetesAll.ok ? diabetesAll.n : diabetesAll.detail}, 모집중: ${diabetesRecruiting.ok ? diabetesRecruiting.n : diabetesRecruiting.detail}`;
  } else if (diabetesAll.n === diabetesRecruiting.n) {
    v1 = 'fail';
    note1 = `**두 수가 같습니다(전체 ${diabetesAll.n}건 = 모집중만 ${diabetesRecruiting.n}건).** ` +
      '`ddlRecruitingStatus` 가 서버에 실리지 않아 모든 ICTRP 질의가 조용히 모집중만으로 좁혀지고 있다는 뜻입니다 — 경고도 없이.';
  } else if (diabetesAll.n > diabetesRecruiting.n) {
    v1 = 'pass';
    note1 = `전체 ${diabetesAll.n}건, 모집중만 ${diabetesRecruiting.n}건 — 서로 다릅니다(기본값 불변식 확인).`;
  } else {
    v1 = 'fail';
    note1 = `전체(${diabetesAll.n}) < 모집중만(${diabetesRecruiting.n}) — 모집중이 전체의 부분집합이어야 하는데 반대입니다.`;
  }
  record(v1);
  invariantRows.push(`| 모집 상태 기본값 불변식 | \`condition=diabetes\`, 필터 없음 vs \`--status recruiting\` | ${LABEL[v1]} | ${note1} |`);
  console.error(`${LABEL[v1]}  모집 상태 기본값 불변식 — ${note1}`);

  let v2: Verdict;
  let note2: string;
  if (!diabetesAll.ok) {
    v2 = 'inconclusive';
    note2 = `요청 실패로 측정 못함: ${diabetesAll.detail}`;
  } else if (diabetesAll.n > 0) {
    v2 = 'pass';
    note2 = `${diabetesAll.n}건 — 0 이 아님을 확인. \`parse.ts\` 가 건수 문구를 여전히 읽고 있다는 뜻입니다.`;
  } else {
    v2 = 'fail';
    note2 = '**0건입니다.** `condition=diabetes` 가 실제로 없을 리 없으니, "N records for M trials found" 문구 형식이 바뀌어 `parse.ts` 가 못 읽고 있을 가능성이 높습니다.';
  }
  record(v2);
  invariantRows.push(`| 알려진 질의가 0 이 아니다 | \`condition=diabetes\` (필터 없음) | ${LABEL[v2]} | ${note2} |`);
  console.error(`${LABEL[v2]}  알려진 질의가 0 이 아니다 — ${note2}`);

  /**
   * 3. **비표준 나라 표기는 거절돼야 한다.**
   *
   * 이 검사가 있는 이유: 목록에 없는 이름은 오류도 0건도 아니라 **조용히 좁혀진 수** 를
   * 낸다(실측 2026-08-26: `South Korea` 94건 vs 표준 이름 `Korea, Republic of` 713건).
   * 어댑터가 폼의 목록으로 걸러 내는데, 그 검증이 빠지면 사용자는 713건 대신 94건을 받고
   * 그것이 답이라고 믿는다 — 스텁 스위트는 목록이 실물에서 온다는 사실을 검사할 수 없다.
   */
  const bogus = await safeCount({ condition: 'diabetes', location: 'South Korea' });
  let v3: Verdict;
  let note3: string;
  if (!bogus.ok && /unsupported/.test(bogus.detail)) {
    v3 = 'pass';
    note3 = '거절됨(exit 3) — 표준 표기가 아닌 이름이 조용히 좁혀진 수를 내지 않습니다.';
  } else if (!bogus.ok) {
    v3 = 'inconclusive';
    note3 = `거절이 아닌 다른 이유로 실패해 판정 못함: ${bogus.detail}`;
  } else {
    v3 = 'fail';
    note3 = `**${bogus.n}건이 돌아왔습니다.** 표준 표기가 아닌 이름이 통과했다는 뜻이라, 나라 검증이 빠졌을 가능성이 높습니다 — 그 수는 진짜 답보다 작습니다.`;
  }
  record(v3);
  invariantRows.push(`| 비표준 나라 표기는 거절된다 | \`--location "South Korea"\` | ${LABEL[v3]} | ${note3} |`);
  console.error(`${LABEL[v3]}  비표준 나라 표기는 거절된다 — ${note3}`);

  console.error('\n--- 3. 지원한다고 신고한 축이 실제로 좁히는가 ---');
  const axisRows: string[] = [];
  const baseline = await safeCount({});
  if (!baseline.ok) {
    console.error(`기준선(무필터) 측정 실패: ${baseline.detail} — 3절 전체를 건너뜁니다.`);
  }
  const declaredSupported = Object.entries(ICTRP_CAPABILITY.search)
    .filter(([, axis]) => (axis as SearchAxis).supported) as [keyof Capability['search'], SearchAxis][];

  const axisResults: Record<string, { ok: true; n: number } | { ok: false }> = {};
  for (const [axis] of declaredSupported) {
    const probe = AXIS_PROBE[axis];
    if (!probe) {
      record('fail');
      axisRows.push(`| ${axis} | (프로브 없음) | - | - | ${LABEL.fail} | **축을 지원한다고 신고했는데 이 표에 증명이 없습니다.** AXIS_PROBE 에 추가하세요. |`);
      console.error(`${LABEL.fail}  ${axis} — 프로브 없음`);
      continue;
    }
    if (!baseline.ok) {
      record('inconclusive');
      axisRows.push(`| ${axis} | \`${JSON.stringify(probe)}\` | - | - | ${LABEL.inconclusive} | 기준선(무필터) 측정이 실패해 대조할 수 없습니다. |`);
      continue;
    }
    const narrowed = await safeCount(probe);
    axisResults[axis] = narrowed;
    let v: Verdict;
    let note: string;
    if (!narrowed.ok) {
      v = 'inconclusive';
      note = `요청 실패로 측정 못함: ${narrowed.detail}`;
    } else if (narrowed.n === 0) {
      v = 'fail';
      note = '**0건** — 필드명이나 값 어휘가 틀렸을 수 있습니다.';
    } else if (narrowed.n === baseline.n) {
      v = 'fail';
      note = `**${narrowed.n}건 = 기준선과 같음** — 필터가 서버에 반영되지 않고 있습니다.` +
        (axis === 'location' ? ' `butAdd`/`lstCountriesSelected` postback 이 빠져 있습니다(위 AXIS_PROBE 주석 참고).' : '');
    } else if (narrowed.n < baseline.n) {
      v = 'pass';
      note = `${narrowed.n}건 (기준선 ${baseline.n}건보다 좁음)`;
    } else {
      v = 'fail';
      note = `**${narrowed.n}건 > 기준선 ${baseline.n}건** — 필터가 좁히기는커녕 늘렸습니다. 정상이라면 있을 수 없는 방향입니다.`;
    }
    record(v);
    axisRows.push(`| ${axis} | \`${JSON.stringify(probe)}\` | ${baseline.n} | ${narrowed.ok ? narrowed.n : '-'} | ${LABEL[v]} | ${note} |`);
    console.error(`${LABEL[v]}  ${axis} — ${note}`);
  }

  console.error('\n--- 4. phase 의 exhaustive 를 실측한다 ---');
  const phaseRows: string[] = [];
  let phaseVerdict: Verdict = 'inconclusive';
  let phaseNote = '';
  if (!baseline.ok) {
    phaseNote = '기준선(무필터) 측정이 실패해 대조할 수 없습니다.';
  } else {
    let sum = 0;
    let anyFailed = false;
    const perValue: string[] = [];
    for (const v of ICTRP_FILTERABLE.phase) {
      const r = await safeCount({ phase: [v] });
      if (!r.ok) {
        anyFailed = true;
        perValue.push(`${v}=측정못함(${r.detail})`);
        continue;
      }
      sum += r.n;
      perValue.push(`${v}=${r.n}`);
    }
    console.error(`  값별 건수: ${perValue.join(', ')}`);
    if (anyFailed) {
      phaseVerdict = 'inconclusive';
      phaseNote = '값 중 일부가 요청 실패로 측정되지 않아 합/총계 대조를 확정할 수 없습니다.';
    } else {
      /**
       * `overlapping` 을 `true` 로 두는 이유: 한 시험이 여러 단계를 신고할 수 있는지
       * (예: "Phase 2/Phase 3")를 측정하지 않았다 — 분할임을 증명하지 못했으면 분할로
       * 취급하지 않는다(ISRCTN/ctgov 필드테스트와 같은 규율).
       *
       * `totalIsFloor` 를 `false` 로 두는 이유: 이 기준선은 `q.status` 를 아예 안 줘서
       * `buildForm` 이 `ddlRecruitingStatus=ALL` 을 명시적으로 실은 결과다(query.ts).
       * ISRCTN 의 `lastEdited` 기준선과 달리, "필드가 없어서 빠지는 레코드" 가 없다 —
       * 상태와 무관하게 전부를 요청한 진짜 총계다.
       */
      const shape = { totalIsFloor: false, overlapping: true };
      const measured = judgeExhaustive({ sum, total: baseline.n, ...shape });
      // 선언은 **capability 에서 읽는다.** 여기에 리터럴을 적으면 이 대조는 자기 자신을
      // 검사하게 된다 — 그리고 이 이음매를 붙드는 테스트는 없다(스크립트가 네트워크를
      // 치므로 스위트가 부를 수 없다). 고칠 때 눈으로 지켜야 하는 줄이다.
      const declared = ICTRP_CAPABILITY.search.phase.exhaustive;
      const j = compareDeclared(declared, measured);
      phaseVerdict = j.verdict;
      const shownDeclared = declared === null ? '`null`' : `\`${declared}\``;
      phaseRows.push(
        `| phase | ${ICTRP_FILTERABLE.phase.length} | ${sum} | ${baseline.n} | ${describeMeasured(measured, shape)} | ${shownDeclared} | ${LABEL[j.verdict]} | ${baseline.n - sum} | ${j.note} |`,
      );
      phaseNote = `값별 합 ${sum} vs 총계 ${baseline.n} → 실측 ${measured} / 신고 ${declared}. ${j.note}`;
    }
  }
  record(phaseVerdict);
  console.error(`${LABEL[phaseVerdict]}  phase exhaustive — ${phaseNote}`);

  console.error('\n--- 심화 관찰 A: 딥 페이징 (집계에 넣지 않음) ---');
  let deepPagingMd: string;
  try {
    const q = { condition: 'diabetes' };
    const p1 = await adapter.search({ ...q, pageToken: '1' }, fetchOpts);
    const p11 = await adapter.search({ ...q, pageToken: '11' }, fetchOpts);
    const p12 = await adapter.search({ ...q, pageToken: '12' }, fetchOpts);
    const ids1 = new Set(p1.data.map((r) => r.registryId));
    const overlap11 = p11.data.filter((r) => ids1.has(r.registryId)).map((r) => r.registryId);
    const overlap12 = p12.data.filter((r) => ids1.has(r.registryId)).map((r) => r.registryId);
    deepPagingMd = [
      `\`condition=diabetes\`(총 ${p1.total}건, 2026-08-26 실측 기준 약 3만건대)로 1/11/12페이지를 직접 요청했다.`,
      '',
      `- 1페이지: ${p1.data.length}행`,
      `- 11페이지: ${p11.data.length}행, 1페이지와 겹침 ${overlap11.length}건`,
      `- 12페이지: ${p12.data.length}행, 1페이지와 겹침 ${overlap12.length}건`,
      '',
      p11.data.length === 10 && overlap11.length === 0
        ? '11페이지는 정상으로 보인다 — 10행, 1페이지와 겹치지 않는 새 시험들.'
        : `11페이지가 예상(10행, 겹침 0)과 다르다 — 행 ${p11.data.length}개, 겹침 ${overlap11.length}건.`,
      p12.data.length === 10 && overlap12.length === 0
        ? '12페이지도 정상으로 보인다 — 10행, 겹침 없음.'
        : `**12페이지가 이상하다** — 행 ${p12.data.length}개(기대 10개), 겹침 ${overlap12.length}건. ` +
          '순차 postback(`client.ts` 의 `pagerTarget`)이 페이지 11 부근에서 화면에 보이는 페이저 링크 창(2~10, "Last") 을 ' +
          '벗어난다는 뜻이다. 2026-08-26 실측: `condition=diabetes` 로는 이 지점에서 12페이지 요청이 전체 결과의 ' +
          '**마지막 페이지**(36,264건의 나머지 4행, 우연이라기엔 나머지 산술이 정확히 맞는다)로 조용히 건너뛰었고, ' +
          '`title=covid` 로는 같은 요청이 재현 가능하게 **20행(2페이지 분량)** 을 돌려주었다 — 실패 모양이 질의마다 다르다. ' +
          '두 경우 다 오류를 던지지 않고 틀린 페이지를 그대로 낸다. 페이지 11 이후는 신뢰할 수 없다고 보는 것이 안전하다.',
    ].join('\n');
  } catch (e) {
    const detail = CtregError.is(e) ? `${e.code}: ${e.message}` : String(e);
    deepPagingMd = `측정 실패: ${detail}`;
  }
  console.error(deepPagingMd.replace(/\n+/g, ' '));

  console.error('\n--- 심화 관찰 B: retrospective 플래그 열 (집계에 넣지 않음) ---');
  const RETRO_QUERIES: NormalizedQuery[] = [{}, { condition: 'malaria' }, { condition: 'tuberculosis' }, { condition: 'HIV' }];
  let rowsScanned = 0;
  const flagged: { trialId: string; flag: string; title: string }[] = [];
  let retroError: string | undefined;
  for (const q of RETRO_QUERIES) {
    try {
      const r = await adapter.search({ ...q, pageToken: '1' }, { ...fetchOpts, raw: true });
      const html = (r.data[0]?.source as string | undefined) ?? '';
      // parse.ts 는 행을 파싱해 IctrpRow 를 낸다. 여기서는 그 파싱과 **별도로**, 같은 원문에서
      // retrospective 플래그 셀의 원문 내용만 trialId 별로 뽑는다 — parse.ts 의 내부 표현을
      // 바꾸지 않고, 이 진단 전용 스크립트에만 필요한 최소 정규식을 로컬로 둔다.
      const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const flagByTrialId = new Map<string, string>();
      for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const body = tr[1] ?? '';
        const idm = /TrialID=([^"'&]+)/i.exec(body);
        if (!idm) continue;
        const trialId = decodeURIComponent(idm[1]!);
        const flagm = /lblRetrospectiveGrid"[^>]*>([\s\S]*?)<\/span>/i.exec(body);
        flagByTrialId.set(trialId, flagm ? strip(flagm[1] ?? '') : '');
      }
      rowsScanned += r.data.length;
      for (const row of r.data) {
        const flag = flagByTrialId.get(row.registryId) ?? '';
        if (flag) flagged.push({ trialId: row.registryId, flag, title: row.title });
      }
    } catch (e) {
      retroError = CtregError.is(e) ? `${e.code}: ${e.message}` : String(e);
      break;
    }
  }
  const retroMd = retroError
    ? `측정 실패: ${retroError}`
    : flagged.length === 0
      ? `${RETRO_QUERIES.length}개 질의, ${rowsScanned}행을 살펴봤지만 이 열이 채워진 행을 찾지 못했다(2026-08-26). ` +
        '위험(제목 오귀속)은 코드 주석에 남아 있는 가설일 뿐 아직 실측으로 재현되지 않았다 — 열린 물음으로 남긴다.'
      : flagged.map((f) => `- \`${f.trialId}\`: 플래그="${f.flag}", 파싱된 제목="${f.title}"`).join('\n');
  console.error(retroMd.replace(/\n+/g, ' '));

  const stamp = new Date().toISOString().slice(0, 10);
  const md = [
    `# ICTRP capability 실물 대조 — ${stamp}`,
    '',
    `- 통과 ${tally.pass} · 실패 ${tally.fail} · 측정못함/불확정 ${tally.inconclusive}`,
    baseline.ok ? `- 무필터 기준선: **${baseline.n}건**` : `- 무필터 기준선 측정 실패: ${baseline.detail}`,
    '',
    'ICTRP 는 공개 API 가 없는 ASP.NET 화면이라 계약 스위트(스텁)가 잡을 수 없는 오류가 있다.',
    '이 표는 "요청이 성공했다" 가 아니라 **"우리가 신고한 대로 포털이 실제로 동작한다"** 를 확인한다.',
    '',
    '## 1·2. 모집 상태 기본값 불변식 · 알려진 질의가 0 이 아니다',
    '',
    '전자가 이 스크립트의 존재 이유다: `ddlRecruitingStatus` 가 서버에 안 실리면 모든 결과가 조용히',
    '모집중만으로 좁혀지고, 경고도 없이 exit 0 으로 나간다. 후자는 `parse.ts` 의 자기 고장 감지가',
    '못 잡는 유일한 경우(건수 문구 형식 자체가 바뀐 때)를 잡는다.',
    '',
    '| 검사 | 프로브 | 판정 | 결과 |',
    '| :-- | :-- | :-- | :-- |',
    ...invariantRows,
    '',
    '## 3. 지원한다고 신고한 축이 실제로 좁히는가',
    '',
    '값이 기준선과 같으면 필터가 서버에 반영되지 않고 있는 것이고, 0건이면 필드명·어휘가 틀렸을',
    '가능성이 높다. 둘 다 exit 0 으로 나가므로 여기서 잡지 못하면 아무도 못 잡는다.',
    '',
    '| 축 | 프로브 | 기준선 | 결과 | 판정 | 비고 |',
    '| :-- | :-- | --: | --: | :-- | :-- |',
    ...axisRows,
    '',
    '## 4. phase 의 exhaustive',
    '',
    '값별 건수의 합이 총계에 못 미치면 그 축의 어휘로는 데이터를 다 덮지 못한다는 뜻이다.',
    '`phase` 의 scope 가 이미 적어 둔 대로(단계를 신고하지 않은 시험은 어디에도 안 걸린다) `false` 가',
    '예상되는 결과이지만, **이 표는 그 예상을 실측으로 대조한다.**',
    '',
    '`status` 는 값이 하나뿐이라(`ICTRP_FILTERABLE.status = [\'recruiting\']`) 값별 합/총계 대조',
    '자체가 성립하지 않는다. **재지 못했다고 적을 뿐** 판정을 지어내지 않는다 — `exhaustive: false`',
    '는 "증명하지 못했으면 덜 신고한다" 는 규칙의 결과이지 실측이 아니다.',
    '',
    '| 축 | 값 개수 | 값별 합 | 총계 | 실측 | 신고 | 판정 | 총계 − 값별 합 | 근거 |',
    '| :-- | --: | --: | --: | :-- | :-- | :-- | --: | :-- |',
    ...phaseRows,
    '',
    '## 심화 관찰 A — 딥 페이징 (집계 밖)',
    '',
    '2~4페이지는 이미(별도로) 겹침 없이 10행씩 정상 확인됐다. 여기서는 화면에 보이는 페이저 링크',
    '창(2~10, 그리고 "Last") 너머로 순차 postback 이 버티는지를 본다. 판정표에는 넣지 않는다 —',
    'capability 가 "11페이지 이후" 를 신고하지 않기 때문이다.',
    '',
    deepPagingMd,
    '',
    '## 심화 관찰 B — retrospective 플래그 열 (집계 밖)',
    '',
    '`parse.ts` 는 제목을 "상태·ID·날짜가 아닌 첫 비어있지 않은 셀" 로 찾는다. 지금까지 본 모든',
    '행에서 이 플래그 열이 비어 있었다 — 실제로 찬 행이 있으면 제목이 그 값으로 잘못 묶일 수',
    '있다는 것이 우려다. 판정표에는 넣지 않는다 — 아직 재현되지 않은 가설이기 때문이다.',
    '',
    retroMd,
    '',
  ].join('\n');

  const path = `docs/ictrp-field-test-${stamp}.md`;
  writeFileSync(path, md);
  console.error(`\n${path} 에 기록했습니다. 통과 ${tally.pass} / 실패 ${tally.fail} / 측정못함·불확정 ${tally.inconclusive}`);
  // 실패가 하나라도 있으면 0 이 아닌 코드로 나간다 — CI 에 걸 수 있게. 두 기존 스크립트와 같은 규율이다.
  process.exit(tally.fail > 0 ? 1 : 0);
}

void main();
