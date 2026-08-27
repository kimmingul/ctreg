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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 결과 페이지에서 **본 그리드의 행** 만 잘라 낸다.
 *
 * 두 가지가 함께 틀렸었다.
 *
 * 1. **비탐욕 정규식으로 행을 자를 수 없다.** 여러 곳에 등록된 시험은 접히는 패널을
 *    다는데 그 패널이 중첩 `<table>` 이다. `/<tr>([\s\S]*?)<\/tr>/` 는 안쪽 표의
 *    `</tr>` 에서 먼저 닫혀 행이 도중에 잘리고, 뒤따르는 제목·등록일 칸이 사라진다.
 *    게다가 이 페이지에는 닫히지 않은 `<tr>` 도 있다(실측: 65 열림 / 64 닫힘).
 *    그래서 `<table>` 깊이를 세면서, 같은 깊이의 `</tr>`·다음 `<tr>`·`</table>`
 *    셋 중 먼저 오는 것에서 행을 닫는다.
 *
 * 2. **`TrialID` 가 든 행이 곧 결과 행은 아니다.** 그 패널 안에는 **같은 시험의 다른
 *    등록** 이 또 `TrialID` 링크를 달고 들어 있다. 그것까지 세면 한 시험이 여러 건으로
 *    부풀어 보인다(실측 2026-08-27: 시험 10개짜리 페이지가 16건으로 나왔고 그중 4건은
 *    제목이 비어 있었다). 포털이 본 그리드 행에만 붙이는 `GridViewSearch_ctlNN_Label1`
 *    을 **정확히 하나** 가진 행이 결과 행이다 — 전체를 감싸는 행은 열 개를 갖고, 패널
 *    안의 등록은 하나도 갖지 않는다.
 *
 * 컨트롤 이름에 기대는 것이 이 함수의 약점이다. 다만 포털이 이름을 바꾸면 행이 0이 되고,
 * `parseResults` 가 「건수는 있는데 행이 없다」로 **소리 내어 실패한다** — 조용히 틀린
 * 목록을 내는 것보다 낫다.
 */
const ROW_LABEL = /GridViewSearch_ctl\d+_Label1/g;

function rowBodies(html: string): string[] {
  const TAG = /<(\/?)(table|tr)\b[^>]*>/gi;
  const spans: { start: number; end: number }[] = [];
  const open: { start: number; depth: number }[] = [];
  let depth = 0;

  const closeTo = (d: number, end: number): void => {
    while (open.length > 0 && open[open.length - 1]!.depth >= d) {
      spans.push({ start: open.pop()!.start, end });
    }
  };

  for (let m = TAG.exec(html); m !== null; m = TAG.exec(html)) {
    const closing = m[1] === '/';
    if (m[2]!.toLowerCase() === 'table') {
      if (!closing) {
        depth += 1;
        continue;
      }
      closeTo(depth, m.index);
      depth -= 1;
      continue;
    }
    closeTo(depth, m.index);
    if (!closing) open.push({ start: m.index + m[0].length, depth });
  }
  closeTo(0, html.length);

  return spans
    .sort((a, b) => a.start - b.start)
    .map((s) => html.slice(s.start, s.end))
    .filter((body) => (body.match(ROW_LABEL) ?? []).length === 1);
}

/**
 * 한 행의 칸들. 중첩 표(접히는 패널) 안의 글자는 이 행의 데이터가 아니므로 지운 뒤 읽는다 —
 * 안 지우면 패널의 열 이름("Recruitment status Main ID Public title …")이 제목으로 뽑힌다.
 */
function rowCells(row: string): string[] {
  const withoutPanels = row.replace(/<table\b[\s\S]*?<\/table>/gi, ' ');
  return [...withoutPanels.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1] ?? ''));
}

/**
 * 결과 페이지에서 건수와 행을 읽는다.
 *
 * **건수 > 0 인데 행이 0 이면 던진다.** 계약이 없는 HTML 표면이라 언제든 깨질 수
 * 있는데, 이 페이지가 건수와 행을 둘 다 내므로 깨짐을 스스로 감지할 수 있다. 깨졌을
 * 때 0건 · exit 0 으로 나가면 "그런 시험이 없다" 로 읽힌다 — 이 CLI 가 없애려는
 * 실패 그 자체다.
 *
 * **행은 읽혔는데 제목이 하나도 없어도 던진다.** 열이 통째로 밀리면 행 수는 그대로인
 * 채 내용만 조용히 틀려진다 — 실제로 있었던 버그다(제목 칸에 시험 ID 가 다시 들어가고
 * 등록일 칸은 비었다). 모든 행의 제목이 비었다는 것은 열 추출 자체가 깨졌다는 신호이므로
 * 이것도 업스트림 오류로 낸다.
 *
 * 못 잡는 것: (1) 건수 **문구 자체** 의 형식이 바뀌면 건수도 행도 0 이 되어 진짜 0건과
 * 구별되지 않는다 — 필드테스트의 "알려진 질의가 0 이 아니다" 검사가 잡는다. (2) 일부
 * 행만 제목이 비고 나머지는 정상이면 여전히 못 잡는다 — "전부 비었다" 만 보기 때문이다.
 * 행별 부분 오염은 원리상 이 자기 고장 감지의 사각지대다.
 *
 * **(2) 는 실제로 물렸다**(2026-08-27). 중첩 표 때문에 16행 중 4행이 제목과 등록일을
 * 잃었는데 나머지 12행이 멀쩡해서 이 감지가 조용히 통과했다. 사람이 CLI 를 써 보다가
 * 빈 제목을 눈으로 보고서야 드러났다. 행 추출을 고쳐 원인은 없앴지만 **감지의 사각지대
 * 자체는 그대로다** — 다음 번 부분 오염도 같은 방식으로만 발견된다.
 */
export function parseResults(html: string): IctrpPage {
  const m = /([0-9,]+)\s+records\s+for\s+([0-9,]+)\s+trials\s+found/i.exec(strip(html));
  const num = (s: string | undefined) => (s === undefined ? 0 : Number(s.replace(/,/g, '')));
  const records = num(m?.[1]);
  const trials = num(m?.[2]);

  const rows: IctrpRow[] = [];
  for (const body of rowBodies(html)) {
    const idm = /TrialID=([^"'&]+)/i.exec(body);
    if (!idm) continue;
    /**
     * 홀로 선 `%` 가 있으면 `decodeURIComponent` 가 `URIError` 를 던진다. 그대로 새어
     * 나가면 `CtregError` 가 아니라 커맨드 루프가 삼키지 않고 크래시가 되는데, 이 CLI 는
     * 실패도 파싱 가능한 봉투로 내는 것이 규칙이다(F7 이 같은 부류였다).
     *
     * 포털이 href 를 인코딩해 내므로 이 일이 실제로 일어난다면 포털이 깨진 것이고, 그때
     * 오류를 내는 것은 맞다 — 다만 **어떤 오류인지** 는 우리가 정한다.
     */
    let trialId: string;
    try {
      trialId = decodeURIComponent(idm[1]!);
    } catch {
      throw upstreamError(
        `ICTRP 가 낸 시험 ID '${idm[1]!}' 를 읽지 못했습니다`,
        '결과 화면의 링크가 올바르게 인코딩되어 있지 않습니다. 포털 쪽 문제일 수 있으니 ' +
          '잠시 뒤 다시 시도하거나 다른 레지스트리를 쓰세요.',
      );
    }
    const cells = rowCells(body);

    /**
     * 열 위치가 아니라 내용의 모양으로 찾는다. 실측(2026-08-26 픽스처): 행마다 셀이
     * 7개인데 그중 빈 셀이 섞여 있어 위치가 고정이 아니고, ID 가 제목 칸의 링크
     * href 뿐 아니라 별도 라벨 칸에도 그대로 찍혀 나온다. 위치를 인덱스로 박아 두면
     * (`cells[2]` 를 제목으로 읽는 식) 그 라벨 칸을 제목으로 잘못 읽는다 — 실제로
     * 있었던 버그다. 다른 행 종류(페이지네이션 등)에서도 이 모양이 유지되는지는
     * 검증하지 못했다.
     */
    const nonEmpty = cells.filter((c) => c.length > 0);
    const statusRaw = nonEmpty[0] ?? '';
    const registeredOn = nonEmpty.find((c) => DATE_RE.test(c)) ?? '';
    const title = nonEmpty.find((c) => c !== statusRaw && c !== trialId && c !== registeredOn) ?? '';

    rows.push({ trialId, statusRaw, title, registeredOn });
  }

  if (records > 0 && rows.length === 0) {
    throw upstreamError(
      `ICTRP 가 ${records}건이 있다고 했는데 목록을 하나도 읽지 못했습니다`,
      'ICTRP 는 공개 API 가 없어 결과 화면을 읽습니다. 화면 구조가 바뀌면 이 오류가 납니다 — ' +
        '조용한 0건 대신 오류로 냅니다. ctreg 를 갱신하거나 다른 레지스트리를 쓰세요.',
    );
  }
  if (rows.length > 0 && rows.every((r) => r.title === '')) {
    throw upstreamError(
      `ICTRP 결과 행을 ${rows.length}개 읽었는데 제목을 하나도 읽지 못했습니다`,
      'ICTRP 는 공개 API 가 없어 결과 화면을 읽습니다. 화면 구조가 바뀌면 열이 통째로 밀려 ' +
        '이 오류가 납니다 — 조용히 틀린 제목 대신 오류로 냅니다. ctreg 를 갱신하거나 다른 ' +
        '레지스트리를 쓰세요.',
    );
  }
  return { records, trials, rows };
}
