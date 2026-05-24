import { PortswitchConfig } from '../types/config';

export const DEFAULT_DAEMON_PORT = 65432;
export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG: PortswitchConfig = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  daemon: {
    port: DEFAULT_DAEMON_PORT,
    logRetention: {
      maxFiles: 10,
      maxFileBytes: 5 * 1024 * 1024,
    },
  },
  groups: [],
  mappings: [],
};
