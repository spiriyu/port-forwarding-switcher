import * as os from 'os';
import * as path from 'path';

export interface ResolveLogPathOpts {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homedir?: string;
}

export function resolveLogPath(opts: ResolveLogPathOpts = {}): string {
  const { env = process.env, platform = process.platform, homedir = os.homedir() } = opts;

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Logs', 'pfs');
  }
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? path.join(homedir, 'AppData', 'Local');
    return path.join(localAppData, 'pfs', 'logs');
  }
  const xdgState = env['XDG_STATE_HOME'] ?? path.join(homedir, '.local', 'state');
  return path.join(xdgState, 'pfs', 'logs');
}
