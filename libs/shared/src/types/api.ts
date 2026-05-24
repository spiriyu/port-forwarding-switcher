import { ApiErrorBody } from './errors';

export type MappingStatus = 'listening' | 'disabled' | 'error';

export interface MappingStats {
  openConnections: number;
  totalConnections: number;
  bytesIn: number;
  bytesOut: number;
}

export interface MappingResponse {
  id: string;
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  status: MappingStatus;
  stats: MappingStats;
  error?: ApiErrorBody;
  createdAt: string;
  updatedAt: string;
}

export interface ListMappingsResponse {
  mappings: MappingResponse[];
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeMs: number;
}

export interface DiagnosticsResponse {
  daemonVersion: string;
  pid: number;
  platform: string;
  uptimeMs: number;
  configFilePath: string;
  logFilePath: string;
  listeningMappings: number;
}

export interface CreateMappingRequest {
  name?: string;
  sourceHost?: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled?: boolean;
}

export interface PatchMappingRequest {
  name?: string;
  sourceHost?: string;
  sourcePort?: number;
  targetHost?: string;
  targetPort?: number;
  enabled?: boolean;
}

export interface BulkCreateOp {
  op: 'create';
  mapping: CreateMappingRequest;
}

export interface BulkUpdateOp {
  op: 'update';
  id: string;
  patch: PatchMappingRequest;
}

export interface BulkDeleteOp {
  op: 'delete';
  id: string;
}

export type BulkOperation = BulkCreateOp | BulkUpdateOp | BulkDeleteOp;

export interface BulkResultItem {
  ok: boolean;
  mapping?: MappingResponse;
  error?: ApiErrorBody;
}

export interface BulkRequest {
  operations: BulkOperation[];
}

export interface BulkResponse {
  results: BulkResultItem[];
}

export interface LogsQueryParams {
  from?: string;
  limit?: number;
  mappingId?: string;
}
