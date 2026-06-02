import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import { LogEntry } from '@portswitch/shared';
import { Logger } from '../logging/logger';
import { DaemonContext } from '../server';

async function readEntriesFromFile(filePath: string): Promise<LogEntry[]> {
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as LogEntry; }
      catch { return null; }
    })
    .filter((e): e is LogEntry => e !== null);
}

export function createLogsRouter(ctx: DaemonContext): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
    const mappingId = typeof req.query['mappingId'] === 'string' ? req.query['mappingId'] : undefined;
    const rawLimit = parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '200', 10);
    const limit = Math.min(isNaN(rawLimit) ? 200 : rawLimit, 1000);

    const filePaths = Logger.logFilePaths(ctx.logPath, ctx.daemonConfig.logRetention.maxFiles);
    let entries: LogEntry[] = [];
    for (const fp of filePaths) {
      const fileEntries = await readEntriesFromFile(fp);
      entries.push(...fileEntries);
    }
    if (from) entries = entries.filter((e) => e.ts > from);
    if (mappingId) entries = entries.filter((e) => e.mappingId === mappingId);
    res.json({ entries: entries.slice(-limit) });
  });

  return router;
}

export function diagnosticsHandler(ctx: DaemonContext) {
  return (_req: unknown, res: { json: (body: unknown) => void }) => {
    const listeningMappings = ctx.store.list().filter((m) => m.status === 'listening').length;
    res.json({
      daemonVersion: ctx.version,
      pid: process.pid,
      platform: process.platform,
      uptimeMs: Date.now() - ctx.startedAt,
      configFilePath: ctx.configPath,
      logFilePath: ctx.logPath,
      listeningMappings,
    });
  };
}
