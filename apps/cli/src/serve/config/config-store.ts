import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import {
  PortswitchConfig,
  parsePortswitchConfig,
  runMigrations,
  DEFAULT_CONFIG,
} from '@spiriyu/shared';

export async function loadConfig(configPath: string): Promise<PortswitchConfig> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const migrated = runMigrations(JSON.parse(raw));
    return parsePortswitchConfig(migrated);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await saveConfig(configPath, DEFAULT_CONFIG);
      return structuredClone(DEFAULT_CONFIG);
    }
    throw err;
  }
}

export async function saveConfig(configPath: string, config: PortswitchConfig): Promise<void> {
  const tmpPath = `${configPath}.tmp`;
  const content = JSON.stringify(config, null, 2);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(tmpPath, content, 'utf-8');
  const fh = await fs.open(tmpPath, 'r');
  await fh.datasync();
  await fh.close();
  await fs.rename(tmpPath, configPath);
}

export function watchConfig(
  configPath: string,
  onChange: (config: PortswitchConfig) => void,
): () => void {
  let debounceTimer: NodeJS.Timeout | undefined;

  const watcher = fsSync.watch(configPath, { persistent: false }, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const config = await loadConfig(configPath);
        onChange(config);
      } catch {
        // If reload fails (e.g. file corrupt), emit nothing
      }
    }, 200);
  });

  return () => {
    clearTimeout(debounceTimer);
    watcher.close();
  };
}

export interface DebouncedFn<T extends unknown[]> {
  (...args: T): void;
  flush(): Promise<void>;
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
  ms: number,
): DebouncedFn<T> {
  let timer: NodeJS.Timeout | undefined;
  let lastArgs: T | undefined;
  let inFlight: Promise<void> | undefined;

  const debounced = (...args: T): void => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastArgs = undefined;
      inFlight = fn(...args)
        .catch(() => undefined)
        .finally(() => { inFlight = undefined; });
    }, ms);
  };

  debounced.flush = async (): Promise<void> => {
    clearTimeout(timer);
    // Wait for any timer-triggered write that is already in flight
    if (inFlight) await inFlight;
    if (lastArgs !== undefined) {
      const args = lastArgs;
      lastArgs = undefined;
      await fn(...args);
    }
  };

  return debounced;
}
