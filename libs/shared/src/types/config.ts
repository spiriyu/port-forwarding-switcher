export interface LogRetentionConfig {
  maxFiles: number;
  maxFileBytes: number;
}

export interface DaemonConfig {
  port: number;
  logRetention: LogRetentionConfig;
}

export interface MappingConfig {
  id: string;
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  drainTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface PortswitchConfig {
  schemaVersion: number;
  daemon: DaemonConfig;
  mappings: MappingConfig[];
}
