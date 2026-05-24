import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as http from 'http';

let daemon: ChildProcess | null = null;

async function waitForDaemon(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up = await new Promise<boolean>((resolve) => {
      const req = http.get(url, (res) => resolve(res.statusCode === 200));
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Daemon did not start within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  const bin = path.join(__dirname, '..', 'dist', 'apps', 'cli', 'main.cjs');
  daemon = spawn(process.execPath, [bin, 'serve', '--port', '65432'], {
    stdio: 'pipe',
    env: { ...process.env, PORTSWITCH_E2E: '1' },
  });

  daemon.stderr?.on('data', (d) => process.stderr.write(d));

  await waitForDaemon('http://127.0.0.1:65432/api/v1/health');

  // Store PID for teardown
  process.env['E2E_DAEMON_PID'] = String(daemon.pid);
}
