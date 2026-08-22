/** 플러그인 스킬이 분기할 계약. 값을 바꾸면 downstream 이 깨진다. */
export const EXIT = {
  OK: 0,
  USAGE: 2,
  UNSUPPORTED: 3,
  UPSTREAM: 4,
  PARTIAL: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
