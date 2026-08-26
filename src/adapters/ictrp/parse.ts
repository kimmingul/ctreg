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
 */
export function parseResults(html: string): IctrpPage {
  const m = /([0-9,]+)\s+records\s+for\s+([0-9,]+)\s+trials\s+found/i.exec(strip(html));
  const num = (s: string | undefined) => (s === undefined ? 0 : Number(s.replace(/,/g, '')));
  const records = num(m?.[1]);
  const trials = num(m?.[2]);

  const rows: IctrpRow[] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = tr[1] ?? '';
    const idm = /TrialID=([^"'&]+)/i.exec(body);
    if (!idm) continue;
    const trialId = decodeURIComponent(idm[1]!);
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1] ?? ''));

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
