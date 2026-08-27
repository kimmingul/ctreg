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
      // 실제로 있었던 버그: 열이 하나씩 밀려서 title 칸에 trialId 가, registeredOn
      // 칸에 빈 문자열이 들어갔다. 길이만 보면 이 corruption 을 못 잡는다 — 내용을 본다.
      expect(r.title).not.toBe(r.trialId);
      expect(r.title.length).toBeGreaterThan(r.trialId.length);
      expect(r.registeredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('원 레지스트리가 섞인 ID 를 그대로 읽는다 — 슬래시·하이픈이 들어 있다', () => {
    // 이 픽스처에 마침 슬래시·하이픈이 든 ID 가 없으므로(그날의 검색 결과일 뿐이다),
    // 실제 레지스트리 형태(CTRI, JPRN)를 흉내낸 합성 행을 파서에 직접 먹여서 본다.
    // 파서가 본 그리드 행을 `GridViewSearch_ctlNN_Label1` 로 알아보므로 합성 행도 그
    // 구조를 갖춰야 한다 — 이 편이 실제 페이지에 더 가깝기도 하다.
    const synthetic = `
      <table>
        <tr>
          <td>Recruiting</td><td></td>
          <td><span id="ctl00_ContentPlaceHolder1_GridViewSearch_ctl02_Label1"><a href="Trial2.aspx?TrialID=CTRI/2026/07/113311">CTRI/2026/07/113311</a></span></td>
          <td></td>
          <td>A Synthetic Study On Slash-Bearing Trial IDs</td>
          <td>2026-08-06</td><td></td>
        </tr>
        <tr>
          <td>Not Recruiting</td><td></td>
          <td><span id="ctl00_ContentPlaceHolder1_GridViewSearch_ctl03_Label1"><a href="Trial2.aspx?TrialID=JPRN-jRCT1031260225">JPRN-jRCT1031260225</a></span></td>
          <td></td>
          <td>A Synthetic Study On Hyphen-Bearing Trial IDs</td>
          <td>2026-08-05</td><td></td>
        </tr>
      </table>
      <p>2 records for 2 trials found</p>`;
    const p = parseResults(synthetic);
    expect(p.rows.map((r) => r.trialId)).toEqual(['CTRI/2026/07/113311', 'JPRN-jRCT1031260225']);
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

  /**
   * 열이 통째로 밀려서 행은 읽혔는데 제목만 전부 빈 채로 나오는 경우 — 실제로 있었던
   * 버그의 재현이다. 행 수가 0 이 아니니 위의 자기 고장 감지로는 못 잡아서 따로 둔다.
   */
  it('행은 읽혔는데 전부 제목이 비면 업스트림 오류다 — 열 밀림 감지', () => {
    // 제목 앵커의 속 텍스트만 비운다 — href 의 `TrialID=` 는 그대로 두므로 행 자체는
    // 여전히 잡히고, 오직 제목만 사라진다. (이 페이지는 `TrialID=` 가 제목 칸의 링크
    // href 에 있다 — 실측.)
    const blankTitles = (html: string) => html.replace(/(<a[^>]*TrialID=[^>]*>)([\s\S]*?)(<\/a>)/gi, '$1$3');
    const broken = blankTitles(page1);
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
   * ID 에 홀로 선 `%` 가 있으면 `decodeURIComponent` 가 `URIError` 를 던진다. 그것이
   * 그대로 새어 나가면 `CtregError` 가 아닌 예외라 커맨드 루프가 삼키지 않고 크래시가
   * 된다 — 이 CLI 는 실패도 파싱 가능한 봉투로 내는 것이 규칙이다(F7 이 같은 부류였다).
   *
   * 실제로 일어날 일인지는 모른다. 포털이 href 를 인코딩해 내므로 홀로 선 `%` 는 포털이
   * 깨졌다는 뜻이고, 그때는 오류가 맞다 — 다만 **어떤 오류인지** 는 우리가 정해야 한다.
   */
  it('ID 를 디코드하지 못하면 크래시가 아니라 업스트림 오류다', () => {
    const bad = '<html><body>1 records for 1 trials found' +
      '<table><tr><td>Recruiting</td><td></td>' +
      '<td><a href="Trial2.aspx?TrialID=CTRI/2026%/113311">깨진 ID</a></td>' +
      '<td></td><td>제목</td><td>2026-01-01</td></tr></table></body></html>';
    try {
      parseResults(bad);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as CtregError).exit).toBe(EXIT.UPSTREAM);
    }
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

/**
 * 두 번째 픽스처는 `condition=gastric cancer` · `country=Korea, Republic of` 의 실제
 * 결과 페이지다(2026-08-27). 첫 픽스처와 **행의 모양이 다르다** — 일부 행이 접히는
 * 패널을 달고 나오는데 그 패널이 중첩 `<table>` 이다.
 *
 * 이것이 실제로 문 결함이다. `<tr>` 을 비탐욕 정규식으로 자르면 중첩 표의 **안쪽**
 * `</tr>` 에서 행이 먼저 끊겨 제목 칸이 잘려 나간다. 16행 중 4행이 제목 없이 나왔고,
 * 자기 고장 감지는 「전부 비었을 때」만 던지므로 조용히 통과했다 — parse.ts 의 주석이
 * 사각지대라고 적어 둔 바로 그 경우다.
 */
const nestedPanel = readFileSync(join(__dirname, '../../fixtures/ictrp/results-nested-panel.html'), 'utf8');

describe('ICTRP 결과 파싱 — 중첩 표를 단 행', () => {
  it('접히는 패널이 달린 행에서도 제목을 읽는다', () => {
    const p = parseResults(nestedPanel);
    expect(p.rows.length).toBeGreaterThan(0);
    const empty = p.rows.filter((r) => r.title.trim() === '');
    // 실패할 때 어느 행인지 보이게 한다 — 개수만 보면 다음 사람이 다시 파야 한다.
    expect(empty.map((r) => r.trialId)).toEqual([]);
  });

  it('중첩 표 안의 하위 등록을 결과 행으로 세지 않는다', () => {
    const p = parseResults(nestedPanel);
    // 포털이 한 페이지에 내는 시험 수는 10 이다 — 두 픽스처가 모두 그렇고, 페이지가
    // 스스로 붙이는 `GridViewSearch_ctlNN_Label1` 도 열 개다. 패널 안의 하위 등록까지
    // 세면 이 수가 부풀어(고치기 전 실측: 16), 사용자는 한 시험을 여러 건으로 본다.
    expect(p.rows.length).toBe(10);
    expect(new Set(p.rows.map((r) => r.trialId)).size).toBe(p.rows.length);
  });

  it('모든 행이 ID·상태·등록일을 갖춘다', () => {
    for (const r of parseResults(nestedPanel).rows) {
      expect(r.trialId.length).toBeGreaterThan(0);
      expect(r.statusRaw.length).toBeGreaterThan(0);
      expect(r.title).not.toBe(r.trialId);
      expect(r.registeredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
