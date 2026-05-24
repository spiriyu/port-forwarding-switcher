export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogCategory = 'daemon' | 'api' | 'mapping' | 'service' | 'config';

export interface LogEntryError {
  code: string;
  message: string;
  stack?: string;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  category: LogCategory;
  mappingId?: string;
  msg: string;
  ctx?: Record<string, unknown>;
  err?: LogEntryError;
}
