import { spawnSafe, type CmdResult } from '../utils/spawn-safe';
import { type ServiceManager, type ServiceInstallOptions, type ServiceStatus } from '../interface';

const SERVICE_NAME = 'pfs';

export { CmdResult };

export class WindowsServiceManager implements ServiceManager {
  readonly platform = 'windows' as const;

  private readonly run: (cmd: string, args: string[]) => Promise<CmdResult>;

  constructor(runner?: (cmd: string, args: string[]) => Promise<CmdResult>) {
    this.run = runner ?? spawnSafe;
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    if (opts.dryRun) {
      process.stdout.write('[dry-run] Would run: sc create ' + SERVICE_NAME + ' start= auto binPath= <exec>\n');
      return;
    }

    // Delete first for idempotency (ignore failure)
    await this.run('sc', ['delete', SERVICE_NAME]);

    const { code } = await this.run('sc', [
      'create', SERVICE_NAME,
      'binPath=', opts.execPath,
      'start=', 'auto',
      'DisplayName=', 'pfs daemon',
    ]);
    if (code !== 0) throw new Error('sc create failed (exit ' + code + ')');
  }

  async uninstall(opts?: { dryRun?: boolean }): Promise<void> {
    if (opts?.dryRun) {
      process.stdout.write('[dry-run] Would run: sc stop ' + SERVICE_NAME + '\n');
      process.stdout.write('[dry-run] Would run: sc delete ' + SERVICE_NAME + '\n');
      return;
    }

    await this.run('sc', ['stop', SERVICE_NAME]);
    const { code } = await this.run('sc', ['delete', SERVICE_NAME]);
    // 1060 = "The specified service does not exist as an installed service"
    if (code !== 0 && code !== 1060) {
      throw new Error('sc delete failed (exit ' + code + ')');
    }
  }

  async start(): Promise<void> {
    const { code } = await this.run('sc', ['start', SERVICE_NAME]);
    if (code !== 0) throw new Error('sc start failed (exit ' + code + ')');
  }

  async stop(): Promise<void> {
    const { code } = await this.run('sc', ['stop', SERVICE_NAME]);
    // 1062 = "The service has not been started"
    if (code !== 0 && code !== 1062) {
      throw new Error('sc stop failed (exit ' + code + ')');
    }
  }

  async status(): Promise<ServiceStatus> {
    const { stdout, code } = await this.run('sc', ['query', SERVICE_NAME]);
    if (code !== 0) return { installed: false, running: false };

    const installed = stdout.includes('SERVICE_NAME');
    const running = stdout.includes('RUNNING');
    const pidMatch = /PID\s*:\s*(\d+)/.exec(stdout);
    const pid = pidMatch && Number(pidMatch[1]) > 0 ? Number(pidMatch[1]) : undefined;

    return { installed, running, pid };
  }
}
