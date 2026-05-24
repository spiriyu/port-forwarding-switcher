import * as os from 'os';
import * as path from 'path';

export interface ResolveConfigPathOpts {
  configPath?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homedir?: string;
}

export function resolveConfigPath(opts: ResolveConfigPathOpts = {}): string {
  const { configPath, env = process.env, platform = process.platform, homedir = os.homedir() } =
    opts;

  if (configPath) return configPath;
  const envConfig = env['PORTSWITCH_CONFIG'];
  if (envConfig) return envConfig;

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'portswitch', 'config.json');
  }
  if (platform === 'win32') {
    const appdata = env['APPDATA'] ?? path.join(homedir, 'AppData', 'Roaming');
    return path.join(appdata, 'portswitch', 'config.json');
  }
  const xdgConfig = env['XDG_CONFIG_HOME'] ?? path.join(homedir, '.config');
  return path.join(xdgConfig, 'portswitch', 'config.json');
}
