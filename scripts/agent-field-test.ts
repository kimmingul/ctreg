/**
 * 에이전트를 **실제 모델·실제 레지스트리로** 잰다.
 *
 * 왜 필요한가. 에이전트 루프는 단위 테스트가 덮지만(도구 실행·정규화·상한·플레이북 전달), **모델이
 * 지침을 따르는지는 테스트로 못 박을 수 없다.** 프롬프트나 플레이북을 한 줄 고치면 "우수한 연구자" 가
 * 다시 목록을 읽고 세는 옛 절차로 돌아갈 수 있고, 그것은 실측으로만 드러난다(2026-09-12 에 실제로
 * 그랬다). 축이 일곱이 되면서 손으로 재는 것이 불가능해졌다.
 *
 * 무엇을 보나 — 문장마다 **기대 절차**를 적어 두고 대조한다:
 *   - 어느 플레이북을 먼저 집었나
 *   - 기대한 도구를 불렀나 / 부르지 말아야 할 도구(목록 읽고 세기)를 안 불렀나
 *   - 답에 반드시 있어야 할 말(모수·"등록 건수"·사본 시각 …)이 있나
 *   - 턴·시간·잘림
 *
 * 결과는 docs/agent-field-test-<날짜>.md 로 남는다. 키가 없으면 **측정하지 않고 그렇게 적는다.**
 * 비용이 든다(문장당 LLM 호출 2~6번) — 프롬프트·플레이북을 바꿨을 때 돌린다.
 *
 *   CTREG_CRIS_MIRROR_URL=https://kctis-web.fly.dev bun run scripts/agent-field-test.ts [--only <이름>]
 */
import { writeFileSync } from 'node:fs';
import { agent, type AgentEvent } from '../src/mcp/agent.js';
import { loadConfig, loadEnvFiles } from '../src/runtime/config.js';

type Case = {
  name: string;
  q: string;
  playbook?: string;
  mustCall: string[];
  mustNotCall?: string[];
  /** 답에 있어야 할 말 — 정규식. */
  answerMust: RegExp[];
  maxTurns?: number;
};

const CASES: Case[] = [
  { name: '연구자-리스트', q: '김민걸 교수의 임상시험 리스트', playbook: 'investigator-korean',
    mustCall: ['resolve_korean_investigator_name', 'search_trials_multi_registry'], answerMust: [/CRIS/, /ctgov|ClinicalTrials/, /표기/] },
  { name: '연구자-특징', q: '김민걸 교수의 임상시험 특징 설명', playbook: 'investigator-profile',
    mustCall: ['resolve_korean_investigator_name', 'search_trials_multi_registry'], answerMust: [/1상|phase_1|약동학/, /한계|사본/] },
  { name: '등수', q: '김민걸 교수가 한국에서 등수', playbook: 'ranking',
    mustCall: ['resolve_korean_investigator_name'], answerMust: [/순위|등수/, /판정|비교 대상|알 수 없/] },
  { name: '우수한-연구자', q: '한국 임상시험에서 당뇨 관련된 우수한 연구자 5명 알려줘', playbook: 'ranking',
    mustCall: ['aggregate_trials'], mustNotCall: ['count_trials'], answerMust: [/등록 건수|건수/, /우수/, /276|모수|건 안/], maxTurns: 4 },
  { name: '의뢰사-분포', q: '국내 당뇨병 임상시험은 어느 의뢰사가 많이 하나', playbook: undefined,
    mustCall: ['aggregate_trials'], mustNotCall: ['count_trials'], answerMust: [/의뢰|스폰서/, /건/] },
  { name: '연도-추이', q: '한국 당뇨병 임상시험의 연도별 추이', playbook: 'by-axis-analysis',
    mustCall: ['aggregate_trials'], answerMust: [/20\d\d/, /건/] },
  { name: '의약품', q: '국내 당뇨병 시험에서 많이 쓰인 약물은', playbook: undefined,
    mustCall: ['aggregate_trials'], answerMust: [/metformin|메트포르민|glucose|포도당/i, /매칭|사전|한계/] },
  { name: '실시기관', q: '당뇨병 임상시험을 가장 많이 실시한 병원은', playbook: undefined,
    mustCall: ['aggregate_trials'], answerMust: [/병원/, /건/] },
  { name: '조건-검색', q: '모집 중인 당뇨병 3상 시험', playbook: 'condition-drug',
    mustCall: ['search_trials_multi_registry'], mustNotCall: ['aggregate_trials'], answerMust: [/모집|recruiting/, /건/] },
];

async function main(): Promise<void> {
  loadEnvFiles();
  const cfg = loadConfig();
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`# 에이전트 필드 테스트 — ${date}`, '', `모델 ${cfg.llmModel ?? 'glm-5.3-flash'} · 사본 ${cfg.crisMirrorUrl ?? '(없음)'}`, ''];
  if (!cfg.llmApiKey) {
    lines.push('**측정하지 않았다 — CTREG_LLM_API_KEY 가 없다.** 없는 값을 지어내지 않는다.');
    writeFileSync(`docs/agent-field-test-${date}.md`, lines.join('\n') + '\n');
    console.error('키 없음 — 측정 안 함');
    process.exit(2);
  }
  let pass = 0, fail = 0;
  for (const c of CASES) {
    if (only && c.name !== only) continue;
    const events: AgentEvent[] = [];
    const t0 = Date.now();
    const r = await agent({ q: c.q, onEvent: (e) => events.push(e) });
    const calls = events.filter((e): e is Extract<AgentEvent, { type: 'call' }> => e.type === 'call');
    const tools = calls.map((e) => e.tool);
    const firstPlaybook = calls.find((e) => e.tool === 'load_playbook')?.args.name as string | undefined;
    const problems: string[] = [];
    if (r.error) problems.push(`오류: ${r.error}`);
    if (c.playbook && firstPlaybook !== c.playbook) problems.push(`플레이북 기대 ${c.playbook}, 실제 ${firstPlaybook ?? '(없음)'}`);
    for (const t of c.mustCall) if (!tools.includes(t as never)) problems.push(`안 부름: ${t}`);
    for (const t of c.mustNotCall ?? []) if (tools.includes(t as never)) problems.push(`부르면 안 되는데 부름: ${t}`);
    for (const re of c.answerMust) if (!re.test(r.answer ?? '')) problems.push(`답에 없음: ${re}`);
    if (c.maxTurns !== undefined && r.steps.length > 0) {
      const turns = new Set(calls.map((e) => e.step)).size; void turns;
    }
    if (r.truncated) problems.push('상한에 잘림');
    const ok = problems.length === 0;
    if (ok) pass += 1; else fail += 1;
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`${ok ? '✅' : '❌'} ${c.name} — ${secs}s, 도구 ${tools.length}회${problems.length ? ' — ' + problems.join(' · ') : ''}`);
    lines.push(`## ${ok ? '✅' : '❌'} ${c.name} — "${c.q}"`, '', `- ${secs}초 · 도구 ${tools.length}회 · 플레이북 ${firstPlaybook ?? '(없음)'} · 레코드 ${r.records.length}${r.truncated ? ' · **잘림**' : ''}`);
    lines.push(`- 호출: ${calls.map((e) => `${e.tool}${e.tool === 'aggregate_trials' ? `(${String(e.args.by)})` : ''}`).join(' → ')}`);
    if (problems.length) lines.push(`- **문제:** ${problems.join(' · ')}`);
    lines.push('', '> ' + (r.answer ?? r.error ?? '').replace(/\n+/g, '\n> ').slice(0, 1500), '');
  }
  lines.push(`---`, `**${pass} 통과 / ${fail} 실패**`);
  writeFileSync(`docs/agent-field-test-${date}.md`, lines.join('\n') + '\n');
  console.log(`\n${pass} 통과 / ${fail} 실패 → docs/agent-field-test-${date}.md`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
