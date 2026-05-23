import * as fs from 'fs/promises';
import * as path from 'path';
import { LogEntry, LogLevel, LogCategory } from '@portswitch/shared';

export type { LogEntry, LogLevel, LogCategory };

export interface LoggerOptions {
  logDir: string;
  maxFileBytes?: number;
  maxFiles?: number;
  minLevel?: LogLevel;
  onEntry?: (entry: LogEntry) => void;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private readonly logDir: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly minLevel: LogLevel;
  private readonly onEntry?: (entry: LogEntry) => void;

  private activeFile: string;
  private pending: string[] = [];
  private draining = false;
  private currentBytes = 0;
  private closed = false;

  constructor(opts: LoggerOptions) {
    this.logDir = opts.logDir;
    this.maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 10;
    this.minLevel = opts.minLevel ?? 'info';
    this.onEntry = opts.onEntry;
    this.activeFile = path.join(this.logDir, 'daemon.log.jsonl');
  }

  async open(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    try {
      const stat = await fs.stat(this.activeFile);
      this.currentBytes = stat.size;
    } catch {
      this.currentBytes = 0;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  log(partial: Omit<LogEntry, 'ts'>): void {
    if (LEVEL_RANK[partial.level] < LEVEL_RANK[this.minLevel]) return;
    const entry: LogEntry = { ts: new Date().toISOString(), ...partial };
    const line = JSON.stringify(entry) + '\n';
    this.pending.push(line);
    this.onEntry?.(entry);
    if (!this.draining) {
      this.draining = true;
      setImmediate(() => void this.flush());
    }
  }

  info(category: LogCategory, msg: string, ctx?: Record<string, unknown>, mappingId?: string): void {
    this.log({ level: 'info', category, msg, ...(ctx && { ctx }), ...(mappingId && { mappingId }) });
  }

  debug(category: LogCategory, msg: string, ctx?: Record<string, unknown>, mappingId?: string): void {
    this.log({ level: 'debug', category, msg, ...(ctx && { ctx }), ...(mappingId && { mappingId }) });
  }

  warn(category: LogCategory, msg: string, ctx?: Record<string, unknown>, mappingId?: string): void {
    this.log({ level: 'warn', category, msg, ...(ctx && { ctx }), ...(mappingId && { mappingId }) });
  }

  error(category: LogCategory, msg: string, err?: Error, ctx?: Record<string, unknown>, mappingId?: string): void {
    const errField = err
      ? { code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN', message: err.message }
      : undefined;
    this.log({
      level: 'error',
      category,
      msg,
      ...(errField && { err: errField }),
      ...(ctx && { ctx }),
      ...(mappingId && { mappingId }),
    });
  }

  private async flush(): Promise<void> {
    while (this.pending.length > 0) {
      const lines = this.pending.splice(0);
      const content = lines.join('');
      const bytes = Buffer.byteLength(content, 'utf-8');
      try {
        await fs.appendFile(this.activeFile, content, 'utf-8');
        this.currentBytes += bytes;
        if (this.currentBytes >= this.maxFileBytes) {
          await this.rotate();
        }
      } catch {
        // Don't crash the daemon if logging fails — put entries back
        this.pending.unshift(...lines);
        break;
      }
    }
    this.draining = false;
  }

  private async rotate(): Promise<void> {
    const base = path.join(this.logDir, 'daemon.log');

    // Remove oldest if already at max rotated files
    await fs.unlink(`${base}.${this.maxFiles}.jsonl`).catch(() => undefined);

    // Shift rotated files up: N-1 → N, ..., 1 → 2
    for (let n = this.maxFiles - 1; n >= 1; n--) {
      await fs.rename(`${base}.${n}.jsonl`, `${base}.${n + 1}.jsonl`).catch(() => undefined);
    }

    // Active → .1
    await fs.rename(this.activeFile, `${base}.1.jsonl`).catch(() => undefined);

    this.currentBytes = 0;
  }

  // Returns log file paths in chronological order: oldest rotated first, then active
  static logFilePaths(logDir: string, maxFiles: number): string[] {
    const base = path.join(logDir, 'daemon.log');
    const rotated = Array.from({ length: maxFiles }, (_, i) => `${base}.${maxFiles - i}.jsonl`);
    return [...rotated, `${base}.jsonl`];
  }
}
