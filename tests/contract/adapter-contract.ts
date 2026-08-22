import { describe, expect, it } from 'vitest';
import { CapabilitySchema, type Capability, type RegistryAdapter } from '../../src/core/capability.js';
import { CAPS, type FetchOpts, type NormalizedQuery } from '../../src/core/query.js';
import { TrialRecordSchema } from '../../src/core/record.js';
import { assertSupported } from '../../src/cli/guard.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const fetchOpts: FetchOpts = {
  include: ['core'],
  caps: { locations: CAPS.locations.default, eligibilityChars: CAPS.eligibilityChars.default, outcomes: CAPS.outcomes.default },
  cacheMode: 'off', raw: false,
};

/**
 * 새 어댑터를 만들 때 이 스위트를 통과시키는 것이 계약 준수의 정의다.
 * 두 번째 레지스트리는 여기에 한 줄(`runAdapterContract('ictrp', …)`)을 더하면 된다.
 */
export function runAdapterContract(name: string, makeAdapter: () => RegistryAdapter): void {
  describe(`어댑터 계약: ${name}`, () => {
    it('capability 선언이 스키마를 통과한다', () => {
      expect(() => CapabilitySchema.parse(makeAdapter().capability())).not.toThrow();
    });

    it('key 와 capability.key 가 일치한다', () => {
      const a = makeAdapter();
      expect(a.capability().key).toBe(a.key);
    });

    it('limits 는 양수다', () => {
      const l = makeAdapter().capability().limits;
      expect(l.maxPageSize).toBeGreaterThan(0);
      expect(l.ratePerSec).toBeGreaterThan(0);
      expect(l.maxBatchIds).toBeGreaterThan(0);
    });

    /**
     * get() 은 배치 하나당 요청을 딱 한 번만 보내고 그 응답을 페이지네이션하지
     * 않는다(review 발견, task-16a). CT.gov 의 filter.ids 자체는 500개 이상도
     * 받지만, buildIdsParams 가 pageSize 를 Math.min(ids.length, CAPS.pageSize.max)
     * 로 잡으므로 배치가 CAPS.pageSize.max 보다 크면 그 초과분이 요청은 됐지만
     * 응답에는 실리지 않은 채 조용히 사라진다 — get() 입장에서는 아무것도
     * 실패하지 않았으니 warnings 도 안 남는다. maxBatchIds 가 이 상한을 넘는
     * 순간 capability 의 "한 번에 N개 처리 가능" 선언이 거짓이 된다.
     */
    it('maxBatchIds 는 한 페이지로 전부 읽을 수 있는 범위를 넘지 않는다', () => {
      const l = makeAdapter().capability().limits;
      if (l.maxBatchIds > CAPS.pageSize.max) {
        expect.fail(
          `maxBatchIds(${l.maxBatchIds}) 가 CAPS.pageSize.max(${CAPS.pageSize.max}) 를 초과합니다. ` +
            `get() 은 배치당 요청을 한 번만 보내고 응답을 페이지네이션하지 않으므로, 이 값을 올리면 ` +
            `pageSize 상한을 넘는 ID 들이 조용히 응답에서 빠집니다 — 호출자는 실패 신호나 경고 없이 ` +
            `부분 결과를 전체로 오인합니다. get() 이 배치 내부 페이지네이션을 구현하기 전까지는 ` +
            `maxBatchIds 를 CAPS.pageSize.max 이하로 유지하세요.`,
        );
      }
    });

    it('신고하지 않은 축으로 요청하면 빈 결과가 아니라 exit 3 이 나온다', () => {
      const cap = makeAdapter().capability();

      const expectExit3 = (probe: NormalizedQuery, using: Capability, label: string) => {
        try {
          assertSupported(using, probe, fetchOpts);
          expect.unreachable(`'${label}' 은 exit 3 을 던져야 한다`);
        } catch (e) {
          expect((e as { exit?: number }).exit).toBe(EXIT.UNSUPPORTED);
        }
      };

      const unsupported = (Object.keys(cap.search) as (keyof Capability['search'])[])
        .filter((k) => k !== 'geoNeedsCoords' && cap.search[k] === false);

      if (unsupported.length === 0) {
        // 전부 지원하는 어댑터라면 반대 방향으로 검증한다: 가짜로 하나를 끄면 반드시 걸려야 한다.
        expectExit3({ condition: 'x' }, { ...cap, search: { ...cap.search, condition: false } }, 'condition');
        return;
      }
      for (const axis of unsupported) {
        const probe: NormalizedQuery =
          axis === 'geo' ? { near: { lat: 0, lon: 0 } } : ({ [axis]: 'x' } as NormalizedQuery);
        expectExit3(probe, cap, axis);
      }
    });

    it('신고한 detail 섹션은 가드를 통과한다', () => {
      const cap = makeAdapter().capability();
      const include: FetchOpts['include'] = ['core'];
      if (cap.detail.eligibilityText) include.push('eligibility');
      if (cap.detail.outcomes) include.push('outcomes');
      expect(() => assertSupported(cap, {}, { ...fetchOpts, include })).not.toThrow();
    });

    it('TrialRecordSchema 가 이 어댑터의 registry 키를 안다', () => {
      const a = makeAdapter();
      const probe = {
        id: `${a.key.toUpperCase()}:X1`, registry: a.key, registryId: 'X1',
        url: 'https://example.test/X1', title: 'T', status: 'unknown',
        conditions: [], fetchedAt: '2026-08-22T00:00:00.000Z',
      };
      expect(() => TrialRecordSchema.parse(probe)).not.toThrow();
    });
  });
}
