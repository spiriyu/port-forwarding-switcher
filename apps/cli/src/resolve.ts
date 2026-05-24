import { type DaemonClient } from './client';

// Crockford base32 alphabet used by ULID
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function resolveId(client: DaemonClient, idOrName: string): Promise<string> {
  if (ULID_RE.test(idOrName)) return idOrName;

  const { mappings } = await client.listMappings();
  const lower = idOrName.toLowerCase();

  const exact = mappings.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact.id;

  const partial = mappings.find((m) => m.name.toLowerCase().includes(lower));
  if (partial) return partial.id;

  throw new Error(`No mapping found matching "${idOrName}"`);
}
