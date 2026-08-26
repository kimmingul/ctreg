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

/**
 * 결과 페이지에서 건수와 행을 읽는다.
 *
 * **건수 > 0 인데 행이 0 이면 던진다.** 계약이 없는 HTML 표면이라 언제든 깨질 수
 * 있는데, 이 페이지가 건수와 행을 둘 다 내므로 깨짐을 스스로 감지할 수 있다. 깨졌을
 * 때 0건 · exit 0 으로 나가면 "그런 시험이 없다" 로 읽힌다 — 이 CLI 가 없애려는
 * 실패 그 자체다.
 *
 * 못 잡는 것: 건수 **문구 자체** 의 형식이 바뀌면 건수도 행도 0 이 되어 진짜 0건과
 * 구별되지 않는다. 그 경우는 필드테스트의 "알려진 질의가 0 이 아니다" 검사가 잡는다.
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
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1] ?? ''));
    const [statusRaw = '', , title = '', registeredOn = ''] = cells;
    rows.push({ trialId: decodeURIComponent(idm[1]!), statusRaw, title, registeredOn });
  }

  if (records > 0 && rows.length === 0) {
    throw upstreamError(
      `ICTRP 가 ${records}건이 있다고 했는데 목록을 하나도 읽지 못했습니다`,
      'ICTRP 는 공개 API 가 없어 결과 화면을 읽습니다. 화면 구조가 바뀌면 이 오류가 납니다 — ' +
        '조용한 0건 대신 오류로 냅니다. ctreg 를 갱신하거나 다른 레지스트리를 쓰세요.',
    );
  }
  return { records, trials, rows };
}
