import type { TrialRecord } from '../../core/record.js';
import { formatTrialId } from '../../core/registry.js';
import type { IctrpRow } from './parse.js';

/**
 * ICTRP 결과 행의 상태 → 공통 어휘.
 *
 * 행이 싣는 값은 `Recruiting` / `Not Recruiting` **이진** 이다(실측). 후자를
 * `completed` 로 접으면 거짓이 된다 — 완료·중단·모집종료를 한데 묶은 굵은 통이라
 * 여덟 개 중 어느 것과도 같지 않다. 어휘의 정의대로 `other`(매핑 없음)이고,
 * `unknown`(레지스트리가 모른다)이 아니다. 원문은 `statusRaw` 가 보존한다.
 */
function toStatus(raw: string): TrialRecord['status'] {
  return raw.trim().toLowerCase() === 'recruiting' ? 'recruiting' : 'other';
}

/**
 * 결과 행 하나를 레코드로. **행이 싣지 않는 것은 만들어 내지 않는다** — 조건·단계·
 * 등록 인원은 이 화면에 없으므로 비운다. 등록일은 `dates.start` 에 넣지 않는다:
 * 그것은 **등록일**이지 시험의 시작일이 아니고, 세 날짜 축을 전부 끈 것과 같은
 * 이유다(다른 것을 같은 이름으로 신고하지 않는다).
 */
export function mapRow(row: IctrpRow, fetchedAt: string): TrialRecord {
  return {
    id: formatTrialId('ictrp', row.trialId),
    registry: 'ictrp',
    registryId: row.trialId,
    url: `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(row.trialId)}`,
    title: row.title,
    status: toStatus(row.statusRaw),
    ...(row.statusRaw ? { statusRaw: row.statusRaw } : {}),
    conditions: [],
    fetchedAt,
  };
}
