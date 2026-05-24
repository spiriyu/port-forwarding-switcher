export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
}

export interface ServiceInstallOptions {
  execPath: string;
  dryRun?: boolean;
}

export interface ServiceManager {
  readonly platform: 'macos' | 'linux' | 'windows' | 'mock';
  install(opts: ServiceInstallOptions): Promise<void>;
  uninstall(opts?: { dryRun?: boolean }): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<ServiceStatus>;
}
