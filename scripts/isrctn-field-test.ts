/**
 * ISRCTN capability 선언을 **실물 레지스트리에 대조한다.**
 *
 * 왜 계약 스위트로는 안 되는가. 계약 스위트는 스텁 트랜스포트로 돈다 — 무엇을 물어보든
 * 픽스처를 돌려주므로, 어댑터가 `condition:` 대신 `conditon:` 을 보내도 초록이다.
 * ISRCTN 은 그 오타에 400 이 아니라 **0건** 을 돌려주고, 그 0 은 "그런 시험이 없다" 와
 * 출력상 구별되지 않는다. 즉 이 종류의 오류는 실물에 쳐 보는 것 말고는 잡을 방법이 없다.
 *
 * 세 방향을 본다:
 *
 * 1. **true 로 신고한 축은 실제로 좁힌다.** 어댑터가 만든 질의를 그대로 보내 0건이
 *    아님을 확인한다. 건수는 시간이 지나면 변하므로 정확한 수를 고정하지 않는다.
 * 2. **false 로 신고한 축은 아직도 죽어 있다.** 이쪽이 더 중요하다 — 죽은 줄 알고 꺼
 *    둔 축이 나중에 살아나면 우리는 쓸 수 있는 기능을 영영 안 쓰게 되고, 반대로 우리가
 *    잘못 판단한 것이었다면 사용자에게 근거 없이 exit 3 을 주고 있는 것이다. 여기서
 *    "죽었다" 는 두 모양이다: 0건(필드명이 없다)과 **전체 건수**(필터가 통째로 무시된다).
 *    후자가 더 위험해서 따로 판정한다.
 * 3. **신고한 `exhaustive` 가 실측과 같다.** 값별 건수의 합을 총계와 대조하고, 그
 *    결과를 어댑터의 선언과 **맞춰 본다.** 어긋나면 실패다 — 여기서 대조하지 않으면
 *    `exhaustive` 는 출처 이야기를 걸친 손으로 적은 불리언에 지나지 않는다.
 *
 * 결과는 docs/isrctn-field-test-<날짜>.md 로 남는다. 우리 HTTP 층을 그대로 쓰므로
 * 요청률 제한(1 req/s)이 적용된다 — API 문서가 순차 실행을 명시적으로 요청한다.
 */
import { writeFileSync } from 'node:fs';
import { ISRCTN_CAPABILITY, createIsrctnAdapter } from '../src/adapters/isrctn/adapter.js';
import { ISRCTN_FILTERABLE } from '../src/adapters/isrctn/query.js';
import type { Capability, SearchAxis } from '../src/core/capability.js';
import type { NormalizedQuery } from '../src/core/query.js';
import { loadConfig } from '../src/runtime/config.js';
import { CtregError } from '../src/runtime/errors.js';
import { getJson } from '../src/runtime/http.js';
import { parseIsrctnXml } from '../src/adapters/isrctn/xml.js';
import { compareDeclared, describeMeasured, judgeExhaustive } from './exhaustive.js';

type Verdict = 'pass' | 'fail' | 'inconclusive';
const LABEL: Record<Verdict, string> = { pass: '✅ 통과', fail: '❌ 실패', inconclusive: '⚠️ 불확정' };

const cfg = loadConfig();
const adapter = createIsrctnAdapter(cfg);

const fetchOpts = {
  include: ['core' as const],
  caps: { locations: 10, eligibilityChars: 8000, outcomes: 20 },
  cacheMode: 'off' as const,
  raw: false,
};

/**
 * true 로 신고한 축마다, **그 축을 실제로 쓰는** 질의 하나. 조건이 하나뿐인 질의를
 * 쓰는 것이 핵심이다 — 다른 조건과 섞으면 그쪽이 결과를 만들어 죽은 축을 가려 준다.
 */
const AXIS_PROBE: Partial<Record<keyof Capability['search'], NormalizedQuery>> = {
  condition: { condition: 'diabetes' },
  intervention: { intervention: 'aspirin' },
  term: { term: 'covid' },
  title: { title: 'covid' },
  sponsor: { sponsor: 'University of Oxford' },
  outcomeQuery: { outcomeQuery: 'mortality' },
  phase: { phase: ['phase_3'] },
  studyType: { studyType: 'interventional' },
  updatedRange: { updatedSince: '2024-01-01' },
  completionRange: { completionAfter: '2020-01-01' },
};

/**
 * false 로 신고한 축이 어떤 원문 질의를 근거로 꺼져 있는지. 여기 적힌 질의가 살아나면
 * 그 축을 켤 수 있다는 뜻이다 — 그때 이 표가 근거가 된다.
 *
 * **프로브 값은 한 단어여야 한다.** 여러 단어를 인용해 넣으면 모르는 필드 접두사가
 * 떨어져 나가고 그 구절이 자유 텍스트로 검색된다 — 실측:
 * `zzzznonsense:"lung cancer"` 와 `location:"lung cancer"` 가 똑같이 378건이다.
 * 그러면 죽은 필드가 살아 있는 것처럼 보인다.
 */
const DEAD_FIELD_PROBE: { axis: string; q: string; why: string }[] = [
  { axis: 'status', q: 'trialStatus:"Ongoing"', why: '문서 3.2.1.1 이 값 목록까지 주지만 전부 0건' },
  { axis: 'status', q: 'recruitmentStatus:"Recruiting"', why: '문서 3.2.1.13, 역시 0건' },
  { axis: 'startRange', q: 'overallStartDate GE 2050-01-01T00:00:00', why: '문서 3.2.1.14, 필터가 무시되어 전체가 온다' },
  { axis: 'location', q: 'location:"Birmingham"', why: '문서의 23개 constraint 에 없는 이름 — 자유 문자열 장소를 받을 자리가 없다' },
  { axis: 'id', q: 'isrctn:96189403', why: '자기 번호조차 전용 축이 없다' },
  { axis: 'id', q: 'clinicalTrialsGovNumber:"NCT03831932"', why: '상호등록번호로도 못 찾는다' },
];

async function rawCount(q: string): Promise<number> {
  const res = await getJson<{ allTrials?: { '@totalCount'?: string } }>(cfg, {
    registry: 'isrctn',
    baseUrl: cfg.isrctnBaseUrl,
    path: '/api/query/format/default',
    params: { q, limit: 0 },
    cacheMode: 'off',
    ratePerSec: ISRCTN_CAPABILITY.limits.ratePerSec,
    accept: 'application/xml',
    decode: (text) => parseIsrctnXml(text) as { allTrials?: { '@totalCount'?: string } },
  });
  const n = Number(res.value.allTrials?.['@totalCount']);
  if (!Number.isFinite(n)) throw new Error('totalCount 를 읽지 못했습니다');
  return n;
}

async function main() {
  const rows: string[] = [];
  const deadRows: string[] = [];
  const tally: Record<Verdict, number> = { pass: 0, fail: 0, inconclusive: 0 };
  const record = (v: Verdict, line: string[], into: string[]) => {
    tally[v]++;
    into.push(`| ${line.join(' | ')} |`);
  };

  /**
   * 레지스트리 건수의 **하한.** 아래 "필터 무시" 판정의 기준선이다 — 필터가 무시되면
   * 이 수가 온다.
   *
   * 빈 `q` 로는 못 구한다(파라미터가 빠지면 400 이다). 대신 **작동이 확인된** 필드에
   * 모든 레코드를 포함하도록 범위를 넓게 건다 — `lastEdited` 는 실측에서 진짜로 좁히는
   * 축이므로(GE 2050 → 0건) 여기서 나오는 수는 "필터가 무시되어서" 가 아니라 정말로
   * 걸려서 나온 수다. 무시되는 필드를 기준선으로 삼으면 판정이 순환한다.
   *
   * **하한인 이유는 이 저장소가 다른 곳에서 계속 경고하는 그 규칙이다:** 날짜 필터는
   * 그 날짜를 기재한 레코드만 매칭한다. `lastEdited` 가 없는 레코드는 이 수에서
   * 빠진다. 그런 레코드가 실제로 있는지는 재지 못했다 — 없다고 단정할 방법이 없다.
   *
   * 그래서 이 수는 두 용도에서 성질이 다르다:
   * - **필터 무시 판정** — `n === 이 수` 는 여전히 유효한 신호다. 무시된 필터는 이
   *   기준선을 만든 것과 똑같은 질의로 되돌아가므로 똑같은 수가 온다.
   * - **덮개(exhaustive) 산술** — 하한일 뿐이다. 낮춰 잡힌 총계는 `합 >= 총계` 를
   *   **더 쉽게** 만들어 덮개를 부풀린다. 그래서 아래 3절은 이 수로 `true` 를
   *   결론짓지 않는다(`totalIsFloor: true`).
   */
  const REGISTRY_TOTAL_FLOOR = await rawCount('lastEdited GE 1900-01-01T00:00:00');
  console.error(`레지스트리 건수 하한: ${REGISTRY_TOTAL_FLOOR}건 (필터 무시 판정의 기준선)\n`);

  console.error('--- 1. 지원한다고 신고한 축이 실제로 좁히는가 ---');
  const declared = Object.entries(ISRCTN_CAPABILITY.search)
    .filter(([, axis]) => axis.supported) as [keyof Capability['search'], SearchAxis][];
  for (const [axis] of declared) {
    const probe = AXIS_PROBE[axis];
    if (!probe) {
      // 신고는 켜 뒀는데 이 스크립트에 프로브가 없다 — 증명되지 않은 신고다.
      record('fail', [axis, '(프로브 없음)', LABEL.fail, '**축을 지원한다고 신고했는데 이 표에 증명이 없습니다.** AXIS_PROBE 에 추가하세요.'], rows);
      console.error(`${LABEL.fail}  ${axis} — 프로브 없음`);
      continue;
    }
    try {
      const { data: n, warnings } = await adapter.count(probe, fetchOpts);
      const note =
        n === 0
          ? '**0건** — 필드명이나 값 어휘가 틀렸을 수 있습니다(ISRCTN 은 둘 다 0 으로 답합니다)'
          : n === REGISTRY_TOTAL_FLOOR
            ? `**${n}건 = 기준선과 같음** — 필터가 무시되고 있습니다`
            : `${n}건`;
      const v: Verdict = n > 0 && n !== REGISTRY_TOTAL_FLOOR ? 'pass' : 'fail';
      record(v, [axis, `\`${JSON.stringify(probe)}\``, LABEL[v], `${note}${warnings.length ? ` (경고 ${warnings.length}건)` : ''}`], rows);
      console.error(`${LABEL[v]}  ${axis} — ${note}`);
    } catch (e) {
      const detail = CtregError.is(e) ? `${e.code}: ${e.message}` : String(e);
      record('fail', [axis, `\`${JSON.stringify(probe)}\``, LABEL.fail, `요청 실패: ${detail}`], rows);
      console.error(`${LABEL.fail}  ${axis} — ${detail}`);
    }
  }

  console.error('\n--- 2. false 로 신고한 축이 아직도 죽어 있는가 ---');
  for (const p of DEAD_FIELD_PROBE) {
    try {
      const n = await rawCount(p.q);
      // 죽은 모양은 둘이다: 0건(그런 이름의 constraint 가 없다)과 전체 건수(constraint 는
      // 있는데 필터가 통째로 무시된다). 그 사이의 수는 **되살아났다는 뜻이 아니다** —
      // 모르는 필드에 여러 단어를 넣으면 접두사가 떨어지고 자유 텍스트로 검색되므로
      // 어중간한 수가 나온다(실측: zzzznonsense:"lung cancer" = location:"lung cancer" = 378).
      // 그 경우를 fail 로 우겨넣으면 이 스크립트가 늑대를 외치게 되므로 불확정으로 둔다.
      const shape = n === 0 ? '0건' : n === REGISTRY_TOTAL_FLOOR ? '전체 — 필터 무시' : `${n}건`;
      if (n === 0 || n === REGISTRY_TOTAL_FLOOR) {
        record('pass', [p.axis, `\`${p.q}\``, shape, LABEL.pass, p.why], deadRows);
        console.error(`${LABEL.pass}  ${p.axis}: ${p.q} → ${shape}`);
      } else {
        record('inconclusive', [p.axis, `\`${p.q}\``, shape, LABEL.inconclusive,
          '0 도 전체도 아닙니다. 되살아났을 수도 있고, 자유 텍스트로 새어 검색된 것일 수도 ' +
          '있습니다 — 같은 값을 `zzzznonsense:` 에 넣어 같은 수가 나오는지 대조하세요. ' +
          '같다면 그 필드는 여전히 죽은 것입니다.'], deadRows);
        console.error(`${LABEL.inconclusive}  ${p.axis}: ${p.q} → ${shape}`);
      }
    } catch (e) {
      record('inconclusive', [p.axis, `\`${p.q}\``, '-', LABEL.inconclusive, `요청 실패: ${String(e)}`], deadRows);
    }
  }

  console.error('\n--- 3. 닫힌 어휘가 데이터를 덮는가 (exhaustive) ---');
  const exhaustiveRows: string[] = [];
  /**
   * `overlapping` 은 **한 시험이 이 축의 여러 값에 걸릴 수 있는가** 다. 걸리면 값별 합은
   * 분할이 아니라 중복 계수이고, 합이 총계 이상이라는 사실이 덮개를 증명하지 못한다.
   * phase 를 겹치는 것으로 두는 이유는 ISRCTN 이 `Phase II/III` 같은 결합 값을 쓰는데
   * `phase:"Phase II"` 가 그 결합 값에도 걸리는지를 **재지 않았기** 때문이다 — 분할임을
   * 증명하지 못했으면 분할로 취급하지 않는다.
   */
  const AXES: { axis: 'phase' | 'studyType'; values: string[]; overlapping: boolean; probe: (v: string) => NormalizedQuery }[] = [
    { axis: 'phase', overlapping: true, values: ISRCTN_FILTERABLE.phase, probe: (v) => ({ phase: [v as never] }) },
    // primaryStudyDesign 은 시험당 값 하나다.
    { axis: 'studyType', overlapping: false, values: ISRCTN_FILTERABLE.studyType, probe: (v) => ({ studyType: v as never }) },
  ];
  for (const a of AXES) {
    if (a.values.length === 0) continue; // 축이 없으면 물음이 성립하지 않는다
    let sum = 0;
    for (const v of a.values) sum += (await adapter.count(a.probe(v), fetchOpts)).data;
    /**
     * 기준선은 **하한** 이다(위 REGISTRY_TOTAL_FLOOR 주석). 낮춰 잡힌 총계는 `합 >= 총계`
     * 를 더 쉽게 만들어 덮개를 부풀리므로, 이 수로는 `true` 를 결론짓지 않는다 —
     * `합 < 하한` 일 때만 확정 `false` 다. 편향은 언제나 **덜 신고하는 쪽** 으로 흐른다.
     * 오늘의 여유는 59건(studyType 28,533 vs 28,592)뿐이라, 하한이 그만큼만 낮춰
     * 잡혀도 부등호가 뒤집힌다.
     */
    const shape = { totalIsFloor: true, overlapping: a.overlapping };
    const measured = judgeExhaustive({ sum, total: REGISTRY_TOTAL_FLOOR, ...shape });
    // 실측을 표에 찍고 마는 것이 아니라 **선언과 대조해 집계에 넣는다.** 설계 §5 가
    // 약속한 "낙관적인 true 는 CI 가 잡는다" 가 성립하는 자리가 여기다.
    const declaredExhaustive = ISRCTN_CAPABILITY.search[a.axis].exhaustive;
    const j = compareDeclared(declaredExhaustive, measured);
    const shownDeclared = declaredExhaustive === null ? '`null`' : `\`${declaredExhaustive}\``;
    record(j.verdict, [
      a.axis,
      String(a.values.length),
      String(sum),
      String(REGISTRY_TOTAL_FLOOR),
      describeMeasured(measured, shape),
      shownDeclared,
      LABEL[j.verdict],
      String(REGISTRY_TOTAL_FLOOR - sum),
      j.note,
    ], exhaustiveRows);
    console.error(`${LABEL[j.verdict]}  ${a.axis}: 값별 합 ${sum} vs 하한 ${REGISTRY_TOTAL_FLOOR} → 실측 ${measured} / 신고 ${declaredExhaustive}`);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const md = [
    `# ISRCTN capability 실물 대조 — ${stamp}`,
    '',
    `- 레지스트리 건수 **하한**: **${REGISTRY_TOTAL_FLOOR}** (아래 "필터 무시" 판정의 기준선)`,
    '  — `lastEdited GE 1900-01-01` 로 잰 수라 그 필드가 없는 레코드는 빠진다. 정확한 총계가 아니다.',
    `- 통과 ${tally.pass} · 실패 ${tally.fail} · 불확정 ${tally.inconclusive}`,
    '',
    '이 표가 확인하는 것은 "요청이 성공했다" 가 아니라 **"우리가 신고한 대로 레지스트리가',
    '실제로 동작한다"** 이다. ISRCTN 은 틀린 질의에 오류를 내지 않으므로, 실물에 쳐 보는',
    '것 말고는 capability 선언이 참인지 확인할 방법이 없다.',
    '',
    '## 1. true 로 신고한 축 — 실제로 좁히는가',
    '',
    '0건이면 필드명이나 값 어휘가 틀린 것이고, 전체 건수가 나오면 필터가 무시되는 것이다.',
    '둘 다 exit 0 으로 나가므로 여기서 잡지 못하면 아무도 못 잡는다.',
    '',
    '| 축 | 프로브 | 판정 | 결과 |',
    '| :-- | :-- | :-- | :-- |',
    ...rows,
    '',
    '## 2. false 로 신고한 축 — 아직도 죽어 있는가',
    '',
    '꺼 둔 축이 살아나면 사용자에게 근거 없이 exit 3 을 주고 있는 것이다. 여기서 ❌ 가',
    '나오면 그 축을 켤 수 있다는 뜻이고, 이 표가 그 근거가 된다.',
    '',
    '| 축 | 원문 질의 | 결과 | 판정 | 비고 |',
    '| :-- | :-- | :-- | :-- | :-- |',
    ...deadRows,
    '',
    '## 3. 닫힌 어휘가 데이터를 덮는가',
    '',
    '값별 건수의 합이 전체 총계에 못 미치면 그 축의 어휘로는 데이터를 다 덮지 못한다는 뜻이다.',
    '모자란 부분이 F8 이 이름 붙이지 못했던 그것이고, capability 의 `exhaustive: false` 가 그 이름이다.',
    '',
    '**이 표는 실측을 찍기만 하는 것이 아니라 어댑터의 선언과 대조한다** — 어긋나면 위 집계의',
    '❌ 로 들어가고 스크립트가 0 이 아닌 코드로 나간다.',
    '',
    '**여기서 `true` 는 결론으로 나올 수 없다.** 비교 대상이 정확한 총계가 아니라 하한이라',
    '(`lastEdited` 가 없는 레코드는 빠진다) `합 >= 총계` 가 덮개를 증명하지 못하기 때문이다.',
    '낮춰 잡힌 총계는 덮개를 **부풀리는** 방향으로만 틀리므로, 이 스크립트는 `합 < 하한` 일',
    '때만 확정 `false` 를 내고 나머지는 판정 불가로 둔다. ISRCTN 의 축에 `true` 를 신고하려면',
    '먼저 진짜 총계를 얻는 방법이 필요하다.',
    '',
    '**`전체 − 값별 합` 은 "어느 값에도 안 걸리는 수" 가 아니다.** 한 시험이 여러 값에 걸릴 수',
    '있는 축에서는 합에 중복이 들어 있고, 총계가 하한이라 뺄셈이 양쪽에서 틀어진다.',
    '',
    '| 축 | 값 개수 | 값별 합 | 총계(하한) | 실측 | 신고 | 판정 | 전체 − 값별 합 | 근거 |',
    '| :-- | --: | --: | --: | :-- | :-- | :-- | --: | :-- |',
    ...exhaustiveRows,
    '',
  ].join('\n');

  const path = `docs/isrctn-field-test-${stamp}.md`;
  writeFileSync(path, md);
  console.error(`\n${path} 에 기록했습니다. 통과 ${tally.pass} / 실패 ${tally.fail} / 불확정 ${tally.inconclusive}`);
  // 실패가 하나라도 있으면 0 이 아닌 코드로 나간다 — CI 에 걸 수 있게.
  process.exit(tally.fail > 0 ? 1 : 0);
}

void main();
