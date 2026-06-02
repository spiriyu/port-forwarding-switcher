import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MockServiceManager } from './mock';
import { createServiceManager } from './factory';
import { buildPlist, LaunchdServiceManager } from './platforms/macos';
import { buildUnit, SystemdServiceManager } from './platforms/linux';
import { WindowsServiceManager } from './platforms/windows';
import { type CmdResult } from './utils/spawn-safe';
// os import kept for types only — do NOT spy on os.homedir (read-only in Node built-ins)

// ── MockServiceManager ───────────────────────────────────────────────────────

describe('MockServiceManager lifecycle', () => {
  let mgr: MockServiceManager;

  beforeEach(() => {
    mgr = new MockServiceManager();
  });

  it('starts uninstalled and not running', async () => {
    const s = await mgr.status();
    expect(s.installed).toBe(false);
    expect(s.running).toBe(false);
  });

  it('install → start → status → stop → uninstall', async () => {
    await mgr.install({ execPath: '/usr/local/bin/daemon' });
    expect((await mgr.status()).installed).toBe(true);
    expect((await mgr.status()).running).toBe(false);

    await mgr.start();
    const running = await mgr.status();
    expect(running.running).toBe(true);
    expect(running.pid).toBe(12345);

    await mgr.stop();
    expect((await mgr.status()).running).toBe(false);

    await mgr.uninstall();
    expect((await mgr.status()).installed).toBe(false);
  });

  it('tracks all calls', async () => {
    await mgr.install({ execPath: '/bin/daemon' });
    await mgr.start();
    expect(mgr.calls.map((c) => c.method)).toEqual(['install', 'start']);
  });

  it('dry-run install does not mark as installed', async () => {
    await mgr.install({ execPath: '/bin/daemon', dryRun: true });
    expect((await mgr.status()).installed).toBe(false);
  });

  it('throws when start called before install', async () => {
    await expect(mgr.start()).rejects.toThrow('not installed');
  });

  it('reset clears state and calls', async () => {
    await mgr.install({ execPath: '/bin/daemon' });
    await mgr.start();
    mgr.reset();
    expect(mgr.calls).toHaveLength(0);
    expect((await mgr.status()).installed).toBe(false);
  });
});

// ── Platform file generation ─────────────────────────────────────────────────

describe('buildPlist', () => {
  it('contains the label', () => {
    expect(buildPlist('/usr/local/bin/daemon')).toContain('com.pfs.daemon');
  });

  it('contains the exec path', () => {
    expect(buildPlist('/usr/local/bin/daemon')).toContain('/usr/local/bin/daemon');
  });

  it('includes RunAtLoad and KeepAlive', () => {
    const p = buildPlist('/bin/d');
    expect(p).toContain('<key>RunAtLoad</key>');
    expect(p).toContain('<key>KeepAlive</key>');
  });
});

describe('buildUnit', () => {
  it('contains the binary path as ExecStart', () => {
    expect(buildUnit('/usr/local/bin/daemon')).toContain('ExecStart=/usr/local/bin/daemon');
  });

  it('has Restart=on-failure', () => {
    expect(buildUnit('/bin/d')).toContain('Restart=on-failure');
  });

  it('has WantedBy=default.target', () => {
    expect(buildUnit('/bin/d')).toContain('WantedBy=default.target');
  });
});

// ── LaunchdServiceManager (integration with temp dirs, mocked commands) ──────

describe('LaunchdServiceManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfs-test-'));
    vi.stubEnv('HOME', tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('install writes plist file and calls launchctl load', async () => {
    const plistDir = path.join(tmpDir, 'Library', 'LaunchAgents');
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 0 }));
    const mgr = new LaunchdServiceManager(runner);

    await mgr.install({ execPath: '/usr/local/bin/daemon' });

    const content = await fs.readFile(path.join(plistDir, 'com.pfs.daemon.plist'), 'utf-8');
    expect(content).toContain('com.pfs.daemon');
    expect(content).toContain('/usr/local/bin/daemon');

    const calls = runner.mock.calls.map(([cmd, args]) => [cmd, ...(args as string[])].join(' '));
    expect(calls.some((c) => c.includes('load'))).toBe(true);
  });

  it('dry-run install does not write files', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 0 }));
    const mgr = new LaunchdServiceManager(runner);

    await mgr.install({ execPath: '/bin/daemon', dryRun: true });

    const plistDir = path.join(tmpDir, 'Library', 'LaunchAgents');
    await expect(fs.access(plistDir)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  it('status returns running when launchctl list exits 0 with PID', async () => {
    const plistDir = path.join(tmpDir, 'Library', 'LaunchAgents');
    await fs.mkdir(plistDir, { recursive: true });
    await fs.writeFile(path.join(plistDir, 'com.pfs.daemon.plist'), '', 'utf-8');

    const runner = vi.fn(async (): Promise<CmdResult> => ({
      stdout: '{ "PID" = 999; }',
      code: 0,
    }));
    const mgr = new LaunchdServiceManager(runner);
    const s = await mgr.status();

    expect(s.installed).toBe(true);
    expect(s.running).toBe(true);
    expect(s.pid).toBe(999);
  });

  it('uninstall removes plist file', async () => {
    const plistDir = path.join(tmpDir, 'Library', 'LaunchAgents');
    const plistFile = path.join(plistDir, 'com.pfs.daemon.plist');
    await fs.mkdir(plistDir, { recursive: true });
    await fs.writeFile(plistFile, 'content', 'utf-8');

    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 0 }));
    const mgr = new LaunchdServiceManager(runner);

    await mgr.uninstall();

    await expect(fs.access(plistFile)).rejects.toThrow();
  });
});

// ── SystemdServiceManager (integration with temp dirs, mocked commands) ───────

describe('SystemdServiceManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfs-test-'));
    vi.stubEnv('XDG_CONFIG_HOME', path.join(tmpDir, '.config'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('install writes unit file and enables service', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 0 }));
    const mgr = new SystemdServiceManager(runner);

    await mgr.install({ execPath: '/usr/local/bin/daemon' });

    const unitFile = path.join(tmpDir, '.config', 'systemd', 'user', 'pfs.service');
    const content = await fs.readFile(unitFile, 'utf-8');
    expect(content).toContain('ExecStart=/usr/local/bin/daemon');

    const calls = runner.mock.calls.map(([, args]) => (args as string[]).join(' '));
    expect(calls.some((c) => c.includes('enable'))).toBe(true);
  });

  it('status returns running when ActiveState=active', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({
      stdout: 'ActiveState=active\nMainPID=5678\n',
      code: 0,
    }));
    const unitFile = path.join(tmpDir, '.config', 'systemd', 'user', 'pfs.service');
    await fs.mkdir(path.dirname(unitFile), { recursive: true });
    await fs.writeFile(unitFile, '', 'utf-8');

    const mgr = new SystemdServiceManager(runner);
    const s = await mgr.status();

    expect(s.running).toBe(true);
    expect(s.pid).toBe(5678);
    expect(s.installed).toBe(true);
  });

  it('dry-run install does not write files', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 0 }));
    const mgr = new SystemdServiceManager(runner);

    await mgr.install({ execPath: '/bin/daemon', dryRun: true });

    const unitDir = path.join(tmpDir, '.config', 'systemd', 'user');
    await expect(fs.access(unitDir)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });
});

// ── WindowsServiceManager (mocked commands) ──────────────────────────────────

describe('WindowsServiceManager', () => {
  it('install calls sc delete then sc create', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 0 }));
    const mgr = new WindowsServiceManager(runner);

    await mgr.install({ execPath: 'C:\\portswitch\\daemon.exe' });

    const calls = runner.mock.calls.map(([, args]) => (args as string[]).join(' '));
    expect(calls[0]).toContain('delete');
    expect(calls[1]).toContain('create');
  });

  it('status returns not installed when sc query fails', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 1060 }));
    const mgr = new WindowsServiceManager(runner);

    const s = await mgr.status();
    expect(s.installed).toBe(false);
    expect(s.running).toBe(false);
  });

  it('stop tolerates already-stopped (code 1062)', async () => {
    const runner = vi.fn(async (): Promise<CmdResult> => ({ stdout: '', code: 1062 }));
    const mgr = new WindowsServiceManager(runner);

    await expect(mgr.stop()).resolves.toBeUndefined();
  });
});

// ── Factory ──────────────────────────────────────────────────────────────────

describe('createServiceManager', () => {
  it('returns a ServiceManager with a known platform', () => {
    const mgr = createServiceManager();
    expect(['macos', 'linux', 'windows', 'mock']).toContain(mgr.platform);
  });
});
