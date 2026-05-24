import { z } from 'zod';
import { MappingConfig, DaemonConfig, LogRetentionConfig, PortswitchConfig, GroupConfig } from '../types/config';

const portNumber = z.number().int().min(1).max(65535);
const isoDatetime = z.string().datetime();

export const LogRetentionConfigSchema: z.ZodType<LogRetentionConfig> = z.object({
  maxFiles: z.number().int().min(0),
  maxFileBytes: z.number().int().min(0),
});

export const DaemonConfigSchema: z.ZodType<DaemonConfig> = z.object({
  port: portNumber,
  logRetention: LogRetentionConfigSchema,
});

export const GroupConfigSchema: z.ZodType<GroupConfig> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const MappingConfigSchema: z.ZodType<MappingConfig> = z.object({
  id: z.string().min(1),
  name: z.string(),
  sourceHost: z.string().min(1),
  sourcePort: portNumber,
  targetHost: z.string().min(1),
  targetPort: portNumber,
  enabled: z.boolean(),
  drainTimeoutMs: z.number().int().min(0),
  groupId: z.string().min(1),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const PortswitchConfigSchema: z.ZodType<PortswitchConfig> = z.object({
  schemaVersion: z.number().int().min(1),
  daemon: DaemonConfigSchema,
  groups: z.array(GroupConfigSchema),
  mappings: z.array(MappingConfigSchema),
});

export function parseMappingConfig(data: unknown): MappingConfig {
  return MappingConfigSchema.parse(data);
}

export function parsePortswitchConfig(data: unknown): PortswitchConfig {
  return PortswitchConfigSchema.parse(data);
}
