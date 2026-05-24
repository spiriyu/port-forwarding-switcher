import { ApiErrorBody } from './errors';
import { LogEntry, LogLevel, LogCategory } from './logging';
import { MappingResponse, MappingStats, MappingStatus } from './api';

// ── Server → Client ──────────────────────────────────────────────────────────

export interface HelloPayload {
  serverVersion: string;
  snapshot: { mappings: MappingResponse[] };
}

export interface LogSubscribePayload {
  mappingIds?: string[];
  levels?: LogLevel[];
  categories?: LogCategory[];
}

export type ServerMessage =
  | { type: 'hello'; payload: HelloPayload }
  | { type: 'mapping.created'; payload: { mapping: MappingResponse } }
  | { type: 'mapping.updated'; payload: { mapping: MappingResponse; previousEnabled: boolean } }
  | { type: 'mapping.deleted'; payload: { id: string } }
  | { type: 'mapping.status'; payload: { id: string; status: MappingStatus; error?: ApiErrorBody } }
  | { type: 'mapping.stats'; payload: { id: string; stats: MappingStats } }
  | { type: 'log'; payload: { entry: LogEntry } }
  | { type: 'log.dropped'; payload: { count: number } }
  | { type: 'daemon.shutdown'; payload: { reason: string } }
  | { type: 'pong' };

// ── Client → Server ──────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'log.subscribe'; payload: LogSubscribePayload }
  | { type: 'log.unsubscribe' }
  | { type: 'ping' };
