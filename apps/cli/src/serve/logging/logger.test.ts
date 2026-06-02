import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from './logger';
import { LogEntry } from '@portswitch/shared';

let logDir: string;
let logger: Logger;

beforeEach(async () => {
  logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-logger-test-'));
});

afterEach(async () => {
  await logger?.close().catch(() => undefined);
  await fs.rm(logDir, { recursive: true, force: true }).catch(() => undefined);
});

async function readActiveLog(): Promise<LogEntry[]> {
  const raw = await fs.readFile(path.join(logDir, 'daemon.log.jsonl'), 'utf-8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
}

async function readLog(n: number): Promise<LogEntry[]> {
  const raw = await fs.readFile(path.join(logDir, `daemon.log.${n}.jsonl`), 'utf-8').catch(() => '');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry);
}

describe('Logger', () => {
  it('writes entries to the active log file', async () => {
    logger = new Logger({ logDir });
    await logger.open();

    logger.info('daemon', 'startup');
    await logger.close();

    const entries = await readActiveLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('startup');
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.category).toBe('daemon');
    expect(typeof entries[0]?.ts).toBe('string');
  });

  it('filters out entries below minLevel', async () => {
    logger = new Logger({ logDir, minLevel: 'warn' });
    await logger.open();

    logger.debug('daemon', 'verbose');
    logger.info('daemon', 'ignored');
    logger.warn('daemon', 'kept');
    await logger.close();

    const entries = await readActiveLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('warn');
  });

  it('includes ctx and mappingId when provided', async () => {
    logger = new Logger({ logDir });
    await logger.open();

    logger.info('mapping', 'listenerBound', { sourcePort: 8080 }, 'abc123');
    await logger.close();

    const entries = await readActiveLog();
    expect(entries[0]?.mappingId).toBe('abc123');
    expect(entries[0]?.ctx?.['sourcePort']).toBe(8080);
  });

  it('includes err field from error() calls', async () => {
    logger = new Logger({ logDir });
    await logger.open();

    logger.error('daemon', 'oops', new Error('boom'));
    await logger.close();

    const entries = await readActiveLog();
    expect(entries[0]?.err?.message).toBe('boom');
  });

  it('rotates when active file exceeds maxFileBytes', async () => {
    logger = new Logger({ logDir, maxFileBytes: 100, maxFiles: 3 });
    await logger.open();

    // Write enough entries to exceed 100 bytes and trigger rotation
    for (let i = 0; i < 5; i++) {
      logger.info('daemon', `entry-${i}`);
    }
    await logger.close();

    // At least one rotated file should exist
    const rotated = await readLog(1);
    expect(rotated.length).toBeGreaterThan(0);
  });

  it('keeps at most maxFiles rotated files', async () => {
    logger = new Logger({ logDir, maxFileBytes: 80, maxFiles: 2 });
    await logger.open();

    // Write many entries to force multiple rotations
    for (let i = 0; i < 20; i++) {
      logger.info('daemon', `msg-${i.toString().padStart(3, '0')}`);
    }
    await logger.close();

    // daemon.log.3.jsonl should not exist (maxFiles=2)
    const exists = await fs.stat(path.join(logDir, 'daemon.log.3.jsonl')).catch(() => null);
    expect(exists).toBeNull();
  });

  it('calls onEntry callback synchronously with each entry', async () => {
    const received: LogEntry[] = [];
    logger = new Logger({ logDir, onEntry: (e) => received.push(e) });
    await logger.open();

    logger.info('daemon', 'one');
    logger.info('daemon', 'two');

    // onEntry is called synchronously inside log()
    expect(received).toHaveLength(2);
    expect(received[0]?.msg).toBe('one');
    expect(received[1]?.msg).toBe('two');

    await logger.close();
  });

  it('logFilePaths returns files in chronological order', () => {
    const paths = Logger.logFilePaths('/logs', 3);
    expect(paths).toEqual([
      '/logs/daemon.log.3.jsonl',
      '/logs/daemon.log.2.jsonl',
      '/logs/daemon.log.1.jsonl',
      '/logs/daemon.log.jsonl',
    ]);
  });

  it('open() picks up existing file size to track rotation correctly', async () => {
    // Pre-create a file near the rotation threshold
    const activeFile = path.join(logDir, 'daemon.log.jsonl');
    const filler = JSON.stringify({ ts: new Date().toISOString(), level: 'info', category: 'daemon', msg: 'pre' }) + '\n';
    await fs.writeFile(activeFile, filler.repeat(3));

    logger = new Logger({ logDir, maxFileBytes: filler.length * 3 + 1 });
    await logger.open();

    // One more entry should tip us over and trigger rotation
    logger.info('daemon', 'triggers rotation');
    await logger.close();

    const rotated = await readLog(1);
    expect(rotated.length).toBeGreaterThan(0);
  });
});
