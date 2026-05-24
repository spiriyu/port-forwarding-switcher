import { type ServiceManager, type ServiceInstallOptions, type ServiceStatus } from './interface';

export interface MockCall {
  method: string;
  args: unknown[];
}

export class MockServiceManager implements ServiceManager {
  readonly platform = 'mock' as const;

  private _installed = false;
  private _running = false;
  private _pid: number | undefined;

  readonly calls: MockCall[] = [];

  async install(opts: ServiceInstallOptions): Promise<void> {
    this.calls.push({ method: 'install', args: [opts] });
    if (!opts.dryRun) {
      this._installed = true;
    }
  }

  async uninstall(opts?: { dryRun?: boolean }): Promise<void> {
    this.calls.push({ method: 'uninstall', args: [opts ?? {}] });
    if (!opts?.dryRun) {
      this._installed = false;
      this._running = false;
    }
  }

  async start(): Promise<void> {
    this.calls.push({ method: 'start', args: [] });
    if (!this._installed) throw new Error('Service not installed');
    this._running = true;
    this._pid = 12345;
  }

  async stop(): Promise<void> {
    this.calls.push({ method: 'stop', args: [] });
    this._running = false;
    this._pid = undefined;
  }

  async status(): Promise<ServiceStatus> {
    this.calls.push({ method: 'status', args: [] });
    return { installed: this._installed, running: this._running, pid: this._pid };
  }

  reset(): void {
    this._installed = false;
    this._running = false;
    this._pid = undefined;
    this.calls.length = 0;
  }
}
