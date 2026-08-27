import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /**
     * `dist/` 빌드를 **모든 테스트 파일보다 먼저 한 번** 돌린다. 예전에는
     * `runtime/throttle.process.test.ts` 의 beforeAll 이 빌드했는데, 파일이 병렬로 도는
     * 탓에 그 빌드가 `cli/epipe.test.ts` 의 dist 실행과 겹쳐 모듈 로드를 깨뜨렸다 —
     * O3·O4 로 세 번 기록된 "플레이크" 의 정체가 그것이다(tests/global-setup.ts 주석 참고).
     */
    globalSetup: ['tests/global-setup.ts'],
  },
});
