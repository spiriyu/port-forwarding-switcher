export const ExitCode = {
  OK: 0,
  GENERIC: 1,
  BAD_INVOCATION: 2,
  DAEMON_UNREACHABLE: 3,
  DAEMON_ERROR: 4,
  EACCES_PRIVILEGED_PORT: 5,
  CONFLICT: 6,
  VALIDATION: 7,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
