import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawnSafe, type CmdResult } from '../utils/spawn-safe';
import { type ServiceManager, type ServiceInstallOptions, type ServiceStatus } from '../interface';

const LABEL = 'com.portswitch.daemon';

function plistPath(): string {
  const home = process.env['HOME'] ?? os.homedir();
  return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

export function buildPlist(execPath: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array><string>${execPath}</string></array>`,
    `  <key>RunAtLoad</key><true/>`,
    `  <key>KeepAlive</key><true/>`,
    `  <key>StandardOutPath</key><string>/tmp/portswitch-daemon.log</string>`,
    `  <key>StandardErrorPath</key><string>/tmp/portswitch-daemon.log</string>`,
    '</dict>',
    '</plist>',
  ].join('\n');
}

export { CmdResult };

export class LaunchdServiceManager implements ServiceManager {
  readonly platform = 'macos' as const;

  private readonly run: (cmd: string, args: string[]) => Promise<CmdResult>;

  constructor(runner?: (cmd: string, args: string[]) => Promise<CmdResult>) {
    this.run = runner ?? spawnSafe;
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    const file = plistPath();
    const content = buildPlist(opts.execPath);

    if (opts.dryRun) {
      process.stdout.write(`[dry-run] Would write ${file}:\n${content}\n`);
      process.stdout.write(`[dry-run] Would run: launchctl load -w ${file}\n`);
      return;
    }

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');

    // Idempotent: unload first if already loaded, then reload
    await this.run('launchctl', ['unload', '-w', file]);
    const { code } = await this.run('launchctl', ['load', '-w', file]);
    if (code !== 0) throw new Error(`launchctl load failed (exit ${code})`);
  }

  async uninstall(opts?: { dryRun?: boolean }): Promise<void> {
    const file = plistPath();

    if (opts?.dryRun) {
      process.stdout.write(`[dry-run] Would run: launchctl unload -w ${file}\n`);
      process.stdout.write(`[dry-run] Would delete: ${file}\n`);
      return;
    }

    await this.run('launchctl', ['unload', '-w', file]);

    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async start(): Promise<void> {
    const { code } = await this.run('launchctl', ['start', LABEL]);
    if (code !== 0) throw new Error(`launchctl start failed (exit ${code})`);
  }

  async stop(): Promise<void> {
    const { code } = await this.run('launchctl', ['stop', LABEL]);
    if (code !== 0) throw new Error(`launchctl stop failed (exit ${code})`);
  }

  async status(): Promise<ServiceStatus> {
    const file = plistPath();
    let installed = false;
    try {
      await fs.access(file);
      installed = true;
    } catch {
      // plist not present
    }

    const { stdout, code } = await this.run('launchctl', ['list', LABEL]);
    const running = code === 0;
    const pidMatch = running ? /"?PID"?\s*=\s*(\d+)/.exec(stdout) : null;
    const pid = pidMatch ? Number(pidMatch[1]) : undefined;

    return { installed, running, pid };
  }
}
