import { z } from 'zod';
import { LogEntry, LogEntryError } from '../types/logging';
import { LogLevelSchema, LogCategorySchema } from './api.schema';

export const LogEntryErrorSchema: z.ZodType<LogEntryError> = z.object({
  code: z.string().min(1),
  message: z.string(),
  stack: z.string().optional(),
});

export const LogEntrySchema: z.ZodType<LogEntry> = z.object({
  ts: z.string().datetime(),
  level: LogLevelSchema,
  category: LogCategorySchema,
  mappingId: z.string().optional(),
  msg: z.string(),
  ctx: z.record(z.unknown()).optional(),
  err: LogEntryErrorSchema.optional(),
});

export function parseLogEntry(data: unknown): LogEntry {
  return LogEntrySchema.parse(data);
}
