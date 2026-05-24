import { z } from 'zod';
import {
  CreateMappingRequest,
  PatchMappingRequest,
  BulkOperation,
  BulkRequest,
  HealthResponse,
  MappingStats,
  MappingStatus,
  CreateGroupRequest,
  PatchGroupRequest,
} from '../types/api';
import { ErrorCode } from '../types/errors';
import { LogLevel, LogCategory } from '../types/logging';
import { LogSubscribePayload } from '../types/events';

const portNumber = z.number().int().min(1).max(65535);

export const MappingStatusSchema: z.ZodType<MappingStatus> = z.enum([
  'listening',
  'disabled',
  'error',
]);

export const MappingStatsSchema: z.ZodType<MappingStats> = z.object({
  openConnections: z.number().int().min(0),
  totalConnections: z.number().int().min(0),
  bytesIn: z.number().int().min(0),
  bytesOut: z.number().int().min(0),
});

export const CreateGroupRequestSchema: z.ZodType<CreateGroupRequest> = z.object({
  name: z.string().min(1),
});

export const PatchGroupRequestSchema: z.ZodType<PatchGroupRequest> = z.object({
  name: z.string().min(1).optional(),
});

export const CreateMappingRequestSchema: z.ZodType<CreateMappingRequest> = z.object({
  name: z.string().optional(),
  sourceHost: z.string().min(1).optional(),
  sourcePort: portNumber,
  targetHost: z.string().min(1),
  targetPort: portNumber,
  enabled: z.boolean().optional(),
  groupId: z.string().min(1).optional(),
});

export const PatchMappingRequestSchema: z.ZodType<PatchMappingRequest> = z.object({
  name: z.string().optional(),
  sourceHost: z.string().min(1).optional(),
  sourcePort: portNumber.optional(),
  targetHost: z.string().min(1).optional(),
  targetPort: portNumber.optional(),
  enabled: z.boolean().optional(),
});

const BulkCreateOpSchema = z.object({
  op: z.literal('create'),
  mapping: CreateMappingRequestSchema,
});

const BulkUpdateOpSchema = z.object({
  op: z.literal('update'),
  id: z.string().min(1),
  patch: PatchMappingRequestSchema,
});

const BulkDeleteOpSchema = z.object({
  op: z.literal('delete'),
  id: z.string().min(1),
});

export const BulkOperationSchema: z.ZodType<BulkOperation> = z.discriminatedUnion('op', [
  BulkCreateOpSchema,
  BulkUpdateOpSchema,
  BulkDeleteOpSchema,
]);

export const BulkRequestSchema: z.ZodType<BulkRequest> = z.object({
  operations: z.array(BulkOperationSchema).min(1),
});

export const HealthResponseSchema: z.ZodType<HealthResponse> = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeMs: z.number().int().min(0),
});

export const ErrorCodeSchema = z.nativeEnum(ErrorCode);

export const LogLevelSchema: z.ZodType<LogLevel> = z.enum(['debug', 'info', 'warn', 'error']);

export const LogCategorySchema: z.ZodType<LogCategory> = z.enum([
  'daemon',
  'api',
  'mapping',
  'service',
  'config',
]);

export const LogSubscribePayloadSchema: z.ZodType<LogSubscribePayload> = z.object({
  mappingIds: z.array(z.string().min(1)).optional(),
  levels: z.array(LogLevelSchema).optional(),
  categories: z.array(LogCategorySchema).optional(),
});

export function parseCreateMappingRequest(data: unknown): CreateMappingRequest {
  return CreateMappingRequestSchema.parse(data);
}

export function parsePatchMappingRequest(data: unknown): PatchMappingRequest {
  return PatchMappingRequestSchema.parse(data);
}

export function parseBulkRequest(data: unknown): BulkRequest {
  return BulkRequestSchema.parse(data);
}
