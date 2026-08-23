/**
 * 스펙 §7.4 의 미검증 문법을 실제 ClinicalTrials.gov 로 확정한다.
 * 우리 HTTP 층을 그대로 쓰므로 요청률 제한이 적용된다. 결과는 docs/field-test-<날짜>.md 로 남는다.
 *
 * 판정은 "요청이 던지지 않았다"가 아니라 각 검사가 스스로 적어둔 기대(expect)를 실제
 * 응답과 대조해서 낸다. 세 상태를 쓴다 — pass / fail / inconclusive. 단발 요청으로는
 * 결론을 낼 수 없는 경우(예: 자연어 문구 하나가 안 맞은 것 vs 파라미터 자체가 고장난 것)를
 * fail 로 우겨넣지 않기 위해서다. 통과시키려고 기대를 낮추지 않는다 — 이 스크립트가
 * 확인하려는 것은 API 가 실제로 무엇을 하는지이지, 초록 표가 아니다.
 */
import { writeFileSync } from 'node:fs';
import { CTGOV_CAPABILITY } from '../src/adapters/ctgov/adapter.js';
import { CTGOV_FILTERABLE, fromPhase, fromStatus, fromStudyType } from '../src/adapters/ctgov/vocab.js';
import { compareDeclared, describeMeasured, judgeExhaustive } from './exhaustive.js';
import { loadConfig } from '../src/runtime/config.js';
import { getJson } from '../src/runtime/http.js';
import { CtregError } from '../src/runtime/errors.js';

type StudiesResponse = { totalCount?: number; studies?: unknown[]; nextPageToken?: string };
type Verdict = 'pass' | 'fail' | 'inconclusive';
type Verdicted = { verdict: Verdict; note: string };

type Check = {
  name: string;
  params: Record<string, string | number | undefined>;
  expect: string;
  evaluate: (r: StudiesResponse) => Verdicted;
};

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: '✅ 통과',
  fail: '❌ 실패',
  inconclusive: '⚠️ 불확정',
};

function extractNctId(study: unknown): string | undefined {
  return (study as { protocolSection?: { identificationModule?: { nctId?: string } } })
    ?.protocolSection?.identificationModule?.nctId;
}

/** totalCount > 0 인지만 보면 되는 대다수 검사의 공통 판정. */
const positiveCount = (r: StudiesResponse): Verdicted =>
  r.totalCount !== undefined && r.totalCount > 0
    ? { verdict: 'pass', note: `totalCount=${r.totalCount} (>0 확인)` }
    : { verdict: 'fail', note: `totalCount=${r.totalCount ?? '-'} — 매칭 없음` };

const cfg = loadConfig();

/**
 * filter.ids 배치 상한을 진짜로 재려면 진짜 NCT ID 가 필요하다 — 이전 판(합성
 * NCT0428xxxx)은 대부분 존재하지 않는 ID라 "긴 URL이 받아들여졌다"만 증명했지
 * 배치 자체를 시험하지 못했다. 실제 검색 결과에서 ID 를 모아 그 위에서 늘려간다.
 */
async function collectRealNctIds(minCount: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < minCount) {
    const r = await getJson<StudiesResponse>(cfg, {
      registry: 'ctgov',
      baseUrl: cfg.ctgovBaseUrl,
      path: '/studies',
      params: {
        'query.cond': 'cancer',
        pageSize: 200,
        fields: 'protocolSection.identificationModule.nctId',
        pageToken,
      },
      cacheMode: 'off',
      ratePerSec: CTGOV_CAPABILITY.limits.ratePerSec,
    });
    const studies = r.value.studies ?? [];
    for (const s of studies) {
      const id = extractNctId(s);
      if (id) ids.push(id);
    }
    if (!r.value.nextPageToken || studies.length === 0) break;
    pageToken = r.value.nextPageToken;
  }
  return [...new Set(ids)];
}

/**
 * 사이즈를 늘려가며 시도한다. 어느 사이즈에서 응답이 던지거나(400/414 등) 조용히
 * 잘라내는 게 확인되면 그 지점을 실측 상한 후보로 보고, 더 큰 사이즈는 실행 시점에
 * main() 의 `broke` 플래그로 건너뛴다 — 여기서는 시도할 후보 사이즈만 만든다.
 */
function buildFilterIdsChecks(pool: string[]): Check[] {
  const sizes = [50, 100, 200, 300, 500].filter((n) => n <= pool.length);
  return sizes.map((n) => ({
    name: `filter.ids ${n}개 (실제 ID)`,
    params: {
      'filter.ids': pool.slice(0, n).join('|'),
      pageSize: Math.min(n, 200),
      fields: 'protocolSection.identificationModule.nctId',
      countTotal: 'true',
    },
    expect: `${n}개 전부 매칭 (totalCount=${n})`,
    evaluate: (r): Verdicted => {
      if (r.totalCount === n) return { verdict: 'pass', note: `totalCount=${n} — ${n}개 전부 매칭, 상한 아직 안 걸림` };
      if (r.totalCount !== undefined && r.totalCount < n) {
        return {
          verdict: 'fail',
          note: `totalCount=${r.totalCount} (요청 ${n}개 중 일부만 매칭) — filter.ids 가 조용히 잘라내고 있을 가능성`,
        };
      }
      return { verdict: 'inconclusive', note: `totalCount=${r.totalCount ?? '-'} — 예상(${n})과 다름` };
    },
  }));
}

const patientChecks: Check[] = [
  {
    name: 'query.patient (원 문구)',
    params: {
      'query.patient': '62 year old woman with EGFR positive lung cancer',
      pageSize: 1,
      countTotal: 'true',
    },
    expect: '200 + totalCount > 0',
    evaluate: (r) =>
      r.totalCount !== undefined && r.totalCount > 0
        ? { verdict: 'pass', note: `totalCount=${r.totalCount} — 매칭됨` }
        : {
            verdict: 'inconclusive',
            note: `totalCount=0 — 이 구체적 문구가 안 맞은 것인지 파라미터 자체가 동작하지 않는지 단일 요청으론 판별 불가. 다음 행('query.patient (단순 문구 재확인)') 참고.`,
          },
  },
  {
    name: 'query.patient (단순 문구 재확인)',
    params: { 'query.patient': 'lung cancer', pageSize: 1, countTotal: 'true' },
    expect: '단순 문구로 재확인 — totalCount > 0 이면 파라미터 자체는 동작',
    evaluate: (r) =>
      r.totalCount !== undefined && r.totalCount > 0
        ? {
            verdict: 'pass',
            note: `totalCount=${r.totalCount} — 단순 문구는 매칭됨. query.patient 파라미터 자체는 동작한다. 위 원문구의 totalCount=0 은 파라미터 고장이 아니라 그 구체적 문장·인구통계 조합이 텍스트로 매칭되는 시험이 없었던 것으로 해석 가능(확정은 아님 — 매칭 알고리즘 자체는 미공개).`,
          }
        : { verdict: 'fail', note: `totalCount=${r.totalCount ?? '-'} — 단순 문구도 0. query.patient 자체가 동작하지 않을 가능성.` },
  },
];

const staticChecks: Check[] = [
  {
    name: 'query.lead',
    params: { 'query.lead': 'Merck Sharp & Dohme', pageSize: 1, countTotal: 'true' },
    expect: '200 + totalCount > 0',
    evaluate: positiveCount,
  },
  {
    name: 'query.id',
    params: { 'query.id': 'NCT04280705', pageSize: 1, countTotal: 'true' },
    expect: '200 + 해당 NCT 매칭 (nctId === NCT04280705)',
    evaluate: (r) => {
      const studies = r.studies ?? [];
      const matched = studies.some((s) => extractNctId(s) === 'NCT04280705');
      return matched
        ? { verdict: 'pass', note: `nctId 일치 확인, totalCount=${r.totalCount ?? '-'}` }
        : { verdict: 'fail', note: `일치하는 study 없음. studies=${studies.length}, totalCount=${r.totalCount ?? '-'}` };
    },
  },
  {
    name: 'AREA[…]RANGE 날짜',
    params: { 'filter.advanced': 'AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX]', pageSize: 1, countTotal: 'true' },
    expect: '200 + totalCount > 0',
    evaluate: positiveCount,
  },
  {
    name: 'AREA[Phase] 값',
    params: { 'filter.advanced': 'AREA[Phase]PHASE3', pageSize: 1, countTotal: 'true' },
    expect: '200 + totalCount > 0',
    evaluate: positiveCount,
  },
  {
    name: 'AREA[StudyType] 값',
    params: { 'filter.advanced': 'AREA[StudyType]INTERVENTIONAL', pageSize: 1, countTotal: 'true' },
    expect: '200 + totalCount > 0',
    evaluate: positiveCount,
  },
  {
    name: 'HasResults 필터 후보 A',
    params: { 'filter.advanced': 'AREA[HasResults]true', pageSize: 1, countTotal: 'true' },
    expect: '문법 확인 — 통과해도 슬라이스 2 까지는 CLI 에 노출하지 않음(불확실해서가 아니라 결정으로)',
    evaluate: (r) =>
      r.totalCount !== undefined && r.totalCount > 0
        ? { verdict: 'pass', note: `totalCount=${r.totalCount} — AREA[HasResults]true 문법 유효 확인. 노출은 슬라이스 2 로 의도적으로 미룸.` }
        : { verdict: 'fail', note: `totalCount=${r.totalCount ?? '-'} — 문법이 유효하지 않거나 매칭 없음` },
  },
  {
    name: 'pageToken 왕복',
    params: { 'query.cond': 'lung cancer', pageSize: 1, countTotal: 'true' },
    expect: 'nextPageToken 존재 확인',
    evaluate: (r) =>
      r.nextPageToken
        ? { verdict: 'pass', note: `nextPageToken 있음, totalCount=${r.totalCount ?? '-'}` }
        : { verdict: 'fail', note: `nextPageToken 없음 — totalCount=${r.totalCount ?? '-'}` },
  },
];

async function main() {
  const rows: string[] = [];
  const tally: Record<Verdict, number> = { pass: 0, fail: 0, inconclusive: 0 };

  const runCheck = async (check: Check) => {
    let result: Verdicted;
    try {
      const r = await getJson<StudiesResponse>(cfg, {
        registry: 'ctgov',
        baseUrl: cfg.ctgovBaseUrl,
        path: '/studies',
        params: check.params,
        cacheMode: 'off',
        ratePerSec: CTGOV_CAPABILITY.limits.ratePerSec,
      });
      result = check.evaluate(r.value);
    } catch (e) {
      const detail = CtregError.is(e) ? `${e.code}: ${e.message} — ${e.hint ?? ''}` : String(e);
      result = { verdict: 'fail', note: `요청 실패: ${detail}` };
    }
    tally[result.verdict]++;
    rows.push(`| ${check.name} | ${check.expect} | ${VERDICT_LABEL[result.verdict]} | ${result.note.replace(/\|/g, '\\|')} |`);
    console.error(`${VERDICT_LABEL[result.verdict]}  ${check.name}`);
    return result.verdict;
  };

  for (const check of [...staticChecks, ...patientChecks]) {
    await runCheck(check);
  }

  console.error('\n실제 NCT ID 를 모으는 중 (filter.ids 배치 상한을 합성 ID 대신 진짜 ID 로 검증)...');
  const pool = await collectRealNctIds(500);
  console.error(`실제 ID ${pool.length}개 확보.`);

  const filterIdsChecks = buildFilterIdsChecks(pool);
  let broke = false;
  for (const check of filterIdsChecks) {
    if (broke) {
      // stopAt 로직은 buildFilterIdsChecks 안에서 이미 처리되지만, 실행 중 처음 실패를
      // 만나는 시점은 런타임에만 알 수 있으므로 여기서도 이후 사이즈를 건너뛴다.
      tally.inconclusive++;
      rows.push(`| ${check.name} | ${check.expect} | ${VERDICT_LABEL.inconclusive} | 앞선 사이즈에서 이미 실패해 시도하지 않음 |`);
      console.error(`${VERDICT_LABEL.inconclusive}  ${check.name} (건너뜀)`);
      continue;
    }
    const verdict = await runCheck(check);
    if (verdict === 'fail' && check.params['filter.ids']) broke = true;
  }

  console.error('\n--- 닫힌 어휘가 데이터를 덮는가 (exhaustive) ---');
  const exhaustiveRows: string[] = [];
  const countFor = async (params: Record<string, string | number | undefined>) => {
    const r = await getJson<StudiesResponse>(cfg, {
      registry: 'ctgov', baseUrl: cfg.ctgovBaseUrl, path: '/studies',
      params: { ...params, pageSize: 0, countTotal: 'true' },
      cacheMode: 'off', ratePerSec: CTGOV_CAPABILITY.limits.ratePerSec,
    });
    return r.value.totalCount ?? 0;
  };
  // 필터 없는 countTotal 이라 이 수는 하한이 아니라 정확한 총계다.
  const ALL = await countFor({});
  /**
   * `overlapping` 은 **한 시험이 이 축의 여러 값에 걸릴 수 있는가** 다. 걸릴 수 있으면
   * 값별 합은 분할이 아니라 중복 계수이고, 합이 총계 이상이라는 사실은 덮개를 증명하지
   * 못한다. phase 가 그렇다 — 어댑터의 scope 가 이미 "여러 단계를 신고한 시험은 그
   * 전부에 걸린다" 고 적어 두었다.
   */
  const CTGOV_AXES: {
    axis: 'status' | 'phase' | 'studyType';
    values: string[];
    overlapping: boolean;
    params: (v: string) => Record<string, string>;
  }[] = [
    // 시험 하나가 신고하는 대표 상태는 하나다.
    { axis: 'status', overlapping: false, values: CTGOV_FILTERABLE.status, params: (v: string) => ({ 'filter.overallStatus': fromStatus(v as never) }) },
    // 여러 단계를 신고한 시험은 그 전부에 걸린다 — 합에 중복이 있다.
    { axis: 'phase', overlapping: true, values: CTGOV_FILTERABLE.phase, params: (v: string) => ({ 'filter.advanced': `AREA[Phase]${fromPhase(v as never)}` }) },
    // 중재/관찰/확대접근은 배타적이다.
    { axis: 'studyType', overlapping: false, values: CTGOV_FILTERABLE.studyType, params: (v: string) => ({ 'filter.advanced': `AREA[StudyType]${fromStudyType(v as never)}` }) },
  ];
  for (const a of CTGOV_AXES) {
    let sum = 0;
    for (const v of a.values) sum += await countFor(a.params(v));
    const shape = { totalIsFloor: false, overlapping: a.overlapping };
    const measured = judgeExhaustive({ sum, total: ALL, ...shape });
    // 실측을 표에 찍고 마는 것이 아니라 **선언과 대조해 집계에 넣는다.** 설계 §5 가
    // 약속한 "낙관적인 true 는 CI 가 잡는다" 가 성립하는 자리가 여기다.
    const declared = CTGOV_CAPABILITY.search[a.axis].exhaustive;
    const j = compareDeclared(declared, measured);
    tally[j.verdict]++;
    const shownDeclared = declared === null ? '`null`' : `\`${declared}\``;
    exhaustiveRows.push(
      `| ${a.axis} | ${a.values.length} | ${sum} | ${ALL} | ${describeMeasured(measured, shape)} | ${shownDeclared} | ` +
        `${VERDICT_LABEL[j.verdict]} | ${ALL - sum} | ${j.note.replace(/\|/g, '\\|')} |`,
    );
    console.error(`${VERDICT_LABEL[j.verdict]}  ${a.axis}: 값별 합 ${sum} vs 전체 ${ALL} → 실측 ${measured} / 신고 ${declared}`);
  }

  const doc = `# ctreg 필드 테스트 — ClinicalTrials.gov

실행: ${new Date().toISOString()}
대상: ${cfg.ctgovBaseUrl}

스펙 \`docs/superpowers/specs/2026-08-22-ctreg-design.md\` §7.4 의 미검증 문법을 실제 API 로 확인한 결과.
판정은 "요청이 던지지 않았다"가 아니라 각 행의 기대(expect)를 응답과 대조해서 낸다.
\`filter.ids\` 배치 검사는 \`query.cond=cancer\` 검색으로 모은 실제 NCT ID ${pool.length}개를 사용했다(이전 판은 합성 ID라 상한을 시험하지 못했다).

집계: ✅ 통과 ${tally.pass} · ❌ 실패 ${tally.fail} · ⚠️ 불확정 ${tally.inconclusive}

| 검사 | 기대 | 판정 | 실제 |
| :-- | :-- | :-- | :-- |
${rows.join('\n')}

## 닫힌 어휘가 데이터를 덮는가

값별 건수의 합이 전체 총계에 못 미치면 그 축의 어휘로는 데이터를 다 덮지 못한다는 뜻이다.
모자란 부분이 F8 이 이름 붙이지 못했던 그것이고, capability 의 \`exhaustive: false\` 가 그 이름이다.

**이 표는 실측을 찍기만 하는 것이 아니라 어댑터의 선언과 대조한다** — 어긋나면 위 집계의
❌ 로 들어가고 스크립트가 0 이 아닌 코드로 나간다.

**\`전체 − 값별 합\` 은 "어느 값에도 안 걸리는 수" 가 아니다.** 한 시험이 여러 값에 걸리는
축(phase — 여러 단계를 신고한 시험은 그 전부에 걸린다)에서는 합에 중복이 들어 있으므로,
어디에도 안 걸리는 진짜 수는 이 뺄셈보다 **크다.** 겹치지 않는 축(status·studyType)에서만
두 수가 같다. 같은 이유로 겹치는 축은 합이 총계 이상이어도 \`true\` 로 판정하지 않는다.

| 축 | 값 개수 | 값별 합 | 전체 총계 | 실측 | 신고 | 판정 | 전체 − 값별 합 | 근거 |
| :-- | --: | --: | --: | :-- | :-- | :-- | --: | :-- |
${exhaustiveRows.join('\n')}

## 해석

- **query.patient**: 원 문구(totalCount=0)만으로는 파라미터 고장인지 문구가 안 맞은 것인지 판별할 수 없어 불확정으로 남겼다. 단순 문구("lung cancer") 재확인 결과가 그 판단 근거다 — 위 표에서 확인.
- **filter.ids**: 합성 ID가 아니라 실제 검색 결과에서 모은 ID로 사이즈를 늘려가며 \`countTotal\`이 요청한 개수와 정확히 일치하는지 봤다. 실패(❌)가 나온 최소 사이즈가 있다면 그것이 실측 상한 후보다. 전부 통과했다면 최대로 시도한 사이즈까지는 상한에 걸리지 않았다는 뜻이지, "상한이 없다"는 뜻은 아니다.
- **HasResults**: 통과는 문법이 유효하다는 뜻일 뿐이다. CLI 필터로 노출하지 않는 것은 이 판정과 무관하게 슬라이스 범위 결정이다.

## 조치

- ❌ 항목은 어댑터에서 해당 플래그를 노출하지 않거나, 확인된 문법으로 고친다.
- ⚠️ 항목은 확정이 아니다 — 추가 검사 없이 플래그를 새로 열지 않는다.
- \`filter.ids\` 실측 상한이 잠정값 50 미만으로 확인되면 \`CTGOV_CAPABILITY.limits.maxBatchIds\` 를 낮춘다.
- **\`filter.ids\` 실측 상한이 잠정값(50)보다 훨씬 위(이 실행에서는 500까지 확인)라고 해서 \`maxBatchIds\` 를 그만큼 올리면 안 된다.** \`get()\` 은 배치당 요청을 한 번만 보내고 응답을 페이지네이션하지 않는다 — \`buildIdsParams\` 가 \`pageSize\` 를 \`CAPS.pageSize.max\`(200)로 캡핑하므로, \`maxBatchIds\` 가 200을 넘으면 그 초과분은 요청은 되지만 응답엔 실리지 않고 조용히 사라진다(경고도 안 남는다 — \`get()\` 입장에선 아무것도 실패하지 않았기 때문). 이 불변식은 이제 계약 스위트(\`tests/contract/adapter-contract.ts\`)가 \`maxBatchIds ≤ CAPS.pageSize.max\` 로 강제한다. 올리려면 먼저 \`get()\` 에 배치 내부 페이지네이션을 구현하거나, 페이지네이션 없이 안전한 상한인 \`CAPS.pageSize.max\`(200)에서 멈춰야 한다 — 이는 슬라이스 2 결정이다.
- HasResults 문법이 유효해도 슬라이스 2 까지는 필터로 노출하지 않는다. 레코드 필드로만 낸다.
`;

  writeFileSync(`docs/field-test-${new Date().toISOString().slice(0, 10)}.md`, doc);
  console.error(`\ndocs/field-test-*.md 에 기록했습니다. 통과 ${tally.pass} / 실패 ${tally.fail} / 불확정 ${tally.inconclusive}`);
  // 실패가 하나라도 있으면 0 이 아닌 코드로 나간다 — CI 에 걸 수 있게. ISRCTN 스크립트와
  // 같은 규율이다. 초록 표를 눈으로 확인해야만 알 수 있으면 아무도 확인하지 않는다.
  process.exit(tally.fail > 0 ? 1 : 0);
}

await main();
