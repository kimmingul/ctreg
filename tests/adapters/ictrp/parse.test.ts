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
    const synthetic = `
      <table>
        <tr>
          <td>Recruiting</td><td></td>
          <td><a href="Trial2.aspx?TrialID=CTRI/2026/07/113311">CTRI/2026/07/113311</a></td>
          <td></td>
          <td>A Synthetic Study On Slash-Bearing Trial IDs</td>
          <td>2026-08-06</td><td></td>
        </tr>
        <tr>
          <td>Not Recruiting</td><td></td>
          <td><a href="Trial2.aspx?TrialID=JPRN-jRCT1031260225">JPRN-jRCT1031260225</a></td>
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
   * 못 잡는 것: 건수 **문구 자체** 의 형식이 바뀌면 건수도 행도 0 이 되어 진짜 0건과
   * 구별되지 않는다. 그 경우는 `scripts/ictrp-field-test.ts` 의 "알려진 질의가 0 이
   * 아니다" 검사가 잡는다 — 스텁으로는 원리상 못 잡는다.
   */
  it('건수 문구가 아예 없으면 0 으로 읽는다(위 주석의 한계)', () => {
    const p = parseResults('<html><body>아무것도 없음</body></html>');
    expect(p.records).toBe(0);
  });
});
