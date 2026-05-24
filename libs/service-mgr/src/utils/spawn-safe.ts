import * as cp from 'child_process';

export interface CmdResult {
  stdout: string;
  code: number;
}

export function spawnSafe(cmd: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    const proc = cp.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1;
      resolve({ stdout: '', code });
    });
    proc.on('close', (code) => { resolve({ stdout: out, code: code ?? 1 }); });
  });
}
