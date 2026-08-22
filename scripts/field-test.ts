/**
 * 스펙 §7.4 의 미검증 문법을 실제 ClinicalTrials.gov 로 확정한다.
 * 우리 HTTP 층을 그대로 쓰므로 요청률 제한이 적용된다. 결과는 docs/field-test-<날짜>.md 로 남는다.
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/runtime/config.js';
import { getJson } from '../src/runtime/http.js';
import { CtregError } from '../src/runtime/errors.js';

type Check = { name: string; params: Record<string, string | number | undefined>; expect: string };

const CHECKS: Check[] = [
  { name: 'query.lead', params: { 'query.lead': 'Merck Sharp & Dohme', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'query.id', params: { 'query.id': 'NCT04280705', pageSize: 1, countTotal: 'true' }, expect: '200 + 해당 NCT 매칭' },
  { name: 'query.patient', params: { 'query.patient': '62 year old woman with EGFR positive lung cancer', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'AREA[…]RANGE 날짜', params: { 'filter.advanced': 'AREA[LastUpdatePostDate]RANGE[2025-01-01, MAX]', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'AREA[Phase] 값', params: { 'filter.advanced': 'AREA[Phase]PHASE3', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'AREA[StudyType] 값', params: { 'filter.advanced': 'AREA[StudyType]INTERVENTIONAL', pageSize: 1, countTotal: 'true' }, expect: '200 + totalCount > 0' },
  { name: 'filter.ids 50개', params: { 'filter.ids': Array.from({ length: 50 }, (_, i) => `NCT0428${String(i).padStart(4, '0')}`).join('|'), pageSize: 50 }, expect: '200 (URL 길이 포함)' },
  { name: 'filter.ids 200개', params: { 'filter.ids': Array.from({ length: 200 }, (_, i) => `NCT0428${String(i).padStart(4, '0')}`).join('|'), pageSize: 200 }, expect: '상한 확인 — 실패해도 정보' },
  { name: 'HasResults 필터 후보 A', params: { 'filter.advanced': 'AREA[HasResults]true', pageSize: 1, countTotal: 'true' }, expect: '문법 확인 — 실패해도 정보' },
  { name: 'pageToken 왕복', params: { 'query.cond': 'lung cancer', pageSize: 1, countTotal: 'true' }, expect: 'nextPageToken 존재 확인' },
];

const cfg = loadConfig();
const rows: string[] = [];

for (const check of CHECKS) {
  let verdict: string;
  let detail: string;
  try {
    const r = await getJson<{ totalCount?: number; studies?: unknown[]; nextPageToken?: string }>(
      cfg,
      { registry: 'ctgov', baseUrl: cfg.ctgovBaseUrl, path: '/studies', params: check.params, cacheMode: 'off' },
    );
    verdict = '✅ 통과';
    detail = `totalCount=${r.value.totalCount ?? '-'}, studies=${r.value.studies?.length ?? 0}, nextPageToken=${r.value.nextPageToken ? '있음' : '없음'}`;
  } catch (e) {
    verdict = '❌ 실패';
    detail = CtregError.is(e) ? `${e.code}: ${e.message} — ${e.hint ?? ''}` : String(e);
  }
  rows.push(`| ${check.name} | ${check.expect} | ${verdict} | ${detail.replace(/\|/g, '\\|')} |`);
  console.error(`${verdict}  ${check.name}`);
}

const doc = `# ctreg 필드 테스트 — ClinicalTrials.gov

실행: ${new Date().toISOString()}
대상: ${cfg.ctgovBaseUrl}

스펙 \`docs/superpowers/specs/2026-08-22-ctreg-design.md\` §7.4 의 미검증 문법을 실제 API 로 확인한 결과.

| 검사 | 기대 | 판정 | 실제 |
| :-- | :-- | :-- | :-- |
${rows.join('\n')}

## 조치

- ❌ 항목은 어댑터에서 해당 플래그를 노출하지 않거나, 확인된 문법으로 고친다.
- \`filter.ids\` 상한이 50 미만으로 확인되면 \`CTGOV_CAPABILITY.limits.maxBatchIds\` 를 실제 값으로 낮춘다.
- HasResults 문법이 확인되지 않으면 슬라이스 2 로 미룬다. 레코드 필드로만 계속 낸다.
`;

writeFileSync(`docs/field-test-${new Date().toISOString().slice(0, 10)}.md`, doc);
console.error('\ndocs/field-test-*.md 에 기록했습니다.');
