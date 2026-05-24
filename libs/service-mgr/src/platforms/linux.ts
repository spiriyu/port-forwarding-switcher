import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawnSafe, type CmdResult } from '../utils/spawn-safe';
import { type ServiceManager, type ServiceInstallOptions, type ServiceStatus } from '../interface';

const SERVICE_NAME = 'portswitch';

function unitPath(): string {
  const configHome = process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'systemd', 'user', `${SERVICE_NAME}.service`);
}

export function buildUnit(binaryPath: string): string {
  return [
    '[Unit]',
    'Description=portswitch daemon',
    'After=network.target',
    '',
    '[Service]',
    `ExecStart=${binaryPath}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n');
}

export { CmdResult };

function ctl(
  run: (cmd: string, args: string[]) => Promise<CmdResult>,
  ...args: string[]
): Promise<CmdResult> {
  return run('systemctl', ['--user', ...args]);
}

export class SystemdServiceManager implements ServiceManager {
  readonly platform = 'linux' as const;

  private readonly run: (cmd: string, args: string[]) => Promise<CmdResult>;

  constructor(runner?: (cmd: string, args: string[]) => Promise<CmdResult>) {
    this.run = runner ?? spawnSafe;
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    const file = unitPath();
    const content = buildUnit(opts.execPath);

    if (opts.dryRun) {
      process.stdout.write(`[dry-run] Would write ${file}:\n${content}\n`);
      process.stdout.write(`[dry-run] Would run: systemctl --user daemon-reload\n`);
      process.stdout.write(`[dry-run] Would run: systemctl --user enable ${SERVICE_NAME}\n`);
      return;
    }

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');

    await ctl(this.run, 'daemon-reload');
    const { code } = await ctl(this.run, 'enable', SERVICE_NAME);
    if (code !== 0) throw new Error(`systemctl enable failed (exit ${code})`);
  }

  async uninstall(opts?: { dryRun?: boolean }): Promise<void> {
    const file = unitPath();

    if (opts?.dryRun) {
      process.stdout.write(`[dry-run] Would run: systemctl --user disable ${SERVICE_NAME}\n`);
      process.stdout.write(`[dry-run] Would delete: ${file}\n`);
      process.stdout.write(`[dry-run] Would run: systemctl --user daemon-reload\n`);
      return;
    }

    await ctl(this.run, 'disable', '--now', SERVICE_NAME);

    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    await ctl(this.run, 'daemon-reload');
  }

  async start(): Promise<void> {
    const { code } = await ctl(this.run, 'start', SERVICE_NAME);
    if (code !== 0) throw new Error(`systemctl start failed (exit ${code})`);
  }

  async stop(): Promise<void> {
    const { code } = await ctl(this.run, 'stop', SERVICE_NAME);
    if (code !== 0) throw new Error(`systemctl stop failed (exit ${code})`);
  }

  async status(): Promise<ServiceStatus> {
    const file = unitPath();
    let installed = false;
    try {
      await fs.access(file);
      installed = true;
    } catch {
      // unit file not present
    }

    const { stdout, code } = await ctl(this.run, 'show', SERVICE_NAME, '--property=ActiveState,MainPID');
    if (code !== 0) return { installed, running: false };

    const running = /ActiveState=active/.test(stdout);
    const pidMatch = /MainPID=(\d+)/.exec(stdout);
    const pid = pidMatch && Number(pidMatch[1]) > 0 ? Number(pidMatch[1]) : undefined;

    return { installed, running, pid };
  }
}
