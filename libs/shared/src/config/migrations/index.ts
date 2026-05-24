import { ulid } from 'ulid';

type RawConfig = Record<string, unknown>;
type Migration = { from: number; migrate: (c: RawConfig) => RawConfig };

// Add future migrations here as { from: N, migrate: (c) => c' }.
// Each migration receives the config at version N and returns it at version N+1.
const migrations: Migration[] = [
  {
    from: 1,
    migrate: (c: RawConfig): RawConfig => {
      const now = new Date().toISOString();
      const defaultGroupId = ulid();
      const defaultGroup = { id: defaultGroupId, name: 'Default', createdAt: now, updatedAt: now };
      const mappings = Array.isArray(c['mappings']) ? (c['mappings'] as RawConfig[]) : [];
      return {
        ...c,
        schemaVersion: 2,
        groups: [defaultGroup],
        mappings: mappings.map((m) => ({ ...m, groupId: defaultGroupId })),
      };
    },
  },
];

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
