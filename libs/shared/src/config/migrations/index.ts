type RawConfig = Record<string, unknown>;
type Migration = { from: number; migrate: (c: RawConfig) => RawConfig };

// Add future migrations here as { from: N, migrate: (c) => c' }.
// Each migration receives the config at version N and returns it at version N+1.
const migrations: Migration[] = [];

export function runMigrations(rawConfig: unknown): unknown {
  let current = rawConfig as RawConfig;
  const startVersion = typeof current?.['schemaVersion'] === 'number' ? current['schemaVersion'] : 0;
  let version = startVersion;

  for (const migration of migrations) {
    if (migration.from === version) {
      current = migration.migrate(current);
      version += 1;
    }
  }

  return current;
}
