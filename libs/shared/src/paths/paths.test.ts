import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveConfigPath } from './config-path';
import { resolveLogPath } from './log-path';

const HOME = '/home/testuser';

describe('resolveConfigPath', () => {
  it('returns explicit configPath when provided', () => {
    expect(resolveConfigPath({ configPath: '/custom/config.json' })).toBe('/custom/config.json');
  });

  it('returns PORTSWITCH_CONFIG env var when set', () => {
    expect(
      resolveConfigPath({ env: { PORTSWITCH_CONFIG: '/env/config.json' }, homedir: HOME }),
    ).toBe('/env/config.json');
  });

  it('explicit configPath takes priority over env var', () => {
    expect(
      resolveConfigPath({
        configPath: '/explicit/config.json',
        env: { PORTSWITCH_CONFIG: '/env/config.json' },
        homedir: HOME,
      }),
    ).toBe('/explicit/config.json');
  });

  it('macOS: returns Library/Application Support path', () => {
    expect(resolveConfigPath({ platform: 'darwin', homedir: HOME })).toBe(
      path.join(HOME, 'Library', 'Application Support', 'portswitch', 'config.json'),
    );
  });

  it('Windows: uses APPDATA when set', () => {
    expect(
      resolveConfigPath({
        platform: 'win32',
        homedir: HOME,
        env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      }),
    ).toBe(path.join('C:\\Users\\test\\AppData\\Roaming', 'portswitch', 'config.json'));
  });

  it('Windows: falls back to homedir/AppData/Roaming when APPDATA unset', () => {
    expect(resolveConfigPath({ platform: 'win32', homedir: HOME, env: {} })).toBe(
      path.join(HOME, 'AppData', 'Roaming', 'portswitch', 'config.json'),
    );
  });

  it('Linux: uses XDG_CONFIG_HOME when set', () => {
    expect(
      resolveConfigPath({
        platform: 'linux',
        homedir: HOME,
        env: { XDG_CONFIG_HOME: '/xdg/config' },
      }),
    ).toBe(path.join('/xdg/config', 'portswitch', 'config.json'));
  });

  it('Linux: falls back to ~/.config when XDG_CONFIG_HOME unset', () => {
    expect(resolveConfigPath({ platform: 'linux', homedir: HOME, env: {} })).toBe(
      path.join(HOME, '.config', 'portswitch', 'config.json'),
    );
  });
});

describe('resolveLogPath', () => {
  it('macOS: returns Library/Logs path', () => {
    expect(resolveLogPath({ platform: 'darwin', homedir: HOME })).toBe(
      path.join(HOME, 'Library', 'Logs', 'portswitch'),
    );
  });

  it('Windows: uses LOCALAPPDATA when set', () => {
    expect(
      resolveLogPath({
        platform: 'win32',
        homedir: HOME,
        env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      }),
    ).toBe(path.join('C:\\Users\\test\\AppData\\Local', 'portswitch', 'logs'));
  });

  it('Windows: falls back to homedir/AppData/Local when LOCALAPPDATA unset', () => {
    expect(resolveLogPath({ platform: 'win32', homedir: HOME, env: {} })).toBe(
      path.join(HOME, 'AppData', 'Local', 'portswitch', 'logs'),
    );
  });

  it('Linux: uses XDG_STATE_HOME when set', () => {
    expect(
      resolveLogPath({
        platform: 'linux',
        homedir: HOME,
        env: { XDG_STATE_HOME: '/xdg/state' },
      }),
    ).toBe(path.join('/xdg/state', 'portswitch', 'logs'));
  });

  it('Linux: falls back to ~/.local/state when XDG_STATE_HOME unset', () => {
    expect(resolveLogPath({ platform: 'linux', homedir: HOME, env: {} })).toBe(
      path.join(HOME, '.local', 'state', 'portswitch', 'logs'),
    );
  });
});
