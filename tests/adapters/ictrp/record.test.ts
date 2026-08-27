/**
 * 레코드 페이지(`Trial2.aspx`) 파싱. 픽스처는 2026-08-27 에 받은 원문이다.
 *
 * 검색 결과 행이 싣는 것은 모집상태·ID·제목·등록일 넷뿐인데, 레코드 페이지는 WHO TRDS
 * 24항목을 싣는다. 그래서 `get` 으로 온 레코드는 `search` 로 온 레코드보다 충실하다 —
 * 특히 **상태가 다르다**: 결과 행은 `Recruiting`/`Not Recruiting` 이진이고 레코드
 * 페이지는 레지스트리가 신고한 값 그대로(`Completed`·`Pending`·`Not yet recruiting`…)다.
 *
 * **빈 껍데기 페이지가 실재한다.** `ISRCTN11928588` 은 200 을 내면서 섹션 제목만 있고
 * 내용이 하나도 없다(정확히 23,501바이트, 같은 크기의 고정 페이지). 표본 11건 중 2건이
 * 그랬고 둘 다 ISRCTN 이었지만 다른 ISRCTN 둘은 내용이 있었다 — 레지스트리 전체가 아니라
 * 시험별이다. 이 경우 레코드를 지어내면 안 된다: 제목 없는 레코드는 스키마도 어기고,
 * 무엇보다 "그 시험은 이렇다" 는 거짓말이 된다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRecord } from '../../../src/adapters/ictrp/record.js';

const nct = readFileSync(join(__dirname, '../../fixtures/ictrp/record-nct.html'), 'utf8');
const empty = readFileSync(join(__dirname, '../../fixtures/ictrp/record-empty.html'), 'utf8');

describe('ICTRP 레코드 페이지 파싱', () => {
  it('내용이 없는 껍데기는 undefined 다 — 레코드를 지어내지 않는다', () => {
    expect(parseRecord(empty)).toBeUndefined();
  });

  it('TRDS 항목을 읽는다', () => {
    const r = parseRecord(nct)!;
    expect(r.publicTitle).toBe('Adaptive COVID-19 Treatment Trial (ACTT)');
    expect(r.scientificTitle).toContain('A Multicenter, Adaptive, Randomized');
    expect(r.primarySponsor).toBe('National Institute of Allergy and Infectious Diseases (NIAID)');
    expect(r.studyType).toBe('Interventional');
    expect(r.phase).toBe('Phase 3');
    expect(r.targetSampleSize).toBe('1062');
  });

  /**
   * 이 값이 `search` 경로와 갈리는 자리다. 결과 행이었다면 `Not Recruiting` 이었을
   * 시험이 여기서는 `Completed` 로 온다.
   */
  it('모집 상태를 레지스트리가 신고한 값 그대로 읽는다 — 이진이 아니다', () => {
    expect(parseRecord(nct)!.recruitmentStatus).toBe('Completed');
  });

  /** 약관이 요구하는 처리일. 검색 결과 행에는 없어서 지금까지 비어 있던 값이다. */
  it('ICTRP 가 사본을 수확한 날을 읽는다', () => {
    expect(parseRecord(nct)!.lastRefreshedOn).toBe('21 March 2022');
  });

  it('시작일과 등록일을 구별해 읽는다 — 서로 다른 날짜다', () => {
    const r = parseRecord(nct)!;
    expect(r.firstEnrolment).toBe('February 21, 2020');
    expect(r.dateOfRegistration).toBe('20/02/2020');
  });

  it('모집 국가를 목록으로 읽는다', () => {
    const c = parseRecord(nct)!.countries;
    expect(c).toContain('Japan');
    expect(c).toContain('Korea, Republic of');
    // 다음 섹션 제목(Contacts)이 목록에 섞이면 안 된다.
    expect(c).not.toContain('Contacts');
  });

  it('조건과 중재를 읽는다', () => {
    const r = parseRecord(nct)!;
    expect(r.conditions).toContain('COVID-19');
    expect(r.interventions.join(' ')).toContain('Remdesivir');
  });

  /** 없는 항목은 비운다 — 지어내지 않는다. */
  it('픽스처에 없는 항목은 undefined 로 남는다', () => {
    const r = parseRecord(nct)!;
    expect(r.publicTitle.length).toBeGreaterThan(0);
    // 이 시험에는 `Main ID` 가 있다. 없는 페이지에서는 undefined 여야 한다.
    expect(parseRecord('<html><body>Public title:\n<br>제목만</body></html>')?.mainId).toBeUndefined();
  });
});
