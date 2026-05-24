import { ulid } from 'ulid';
import { GroupConfig, GroupResponse, CreateGroupRequest, PatchGroupRequest } from '@portswitch/shared';
import { ApiError, ErrorCode } from '@portswitch/shared';

interface GroupRecord {
  id: string;
  name: string;
  mappingCount: number;
  activeCount: number;
  createdAt: string;
  updatedAt: string;
}

function toResponse(r: GroupRecord): GroupResponse {
  return {
    id: r.id,
    name: r.name,
    mappingCount: r.mappingCount,
    activeCount: r.activeCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class InMemoryGroupStore {
  private records = new Map<string, GroupRecord>();

  hydrate(configs: GroupConfig[]): void {
    this.records.clear();
    for (const c of configs) {
      this.records.set(c.id, { ...c, mappingCount: 0, activeCount: 0 });
    }
  }

  toConfigs(): GroupConfig[] {
    return Array.from(this.records.values()).map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  list(): GroupResponse[] {
    return Array.from(this.records.values()).map(toResponse);
  }

  get(id: string): GroupResponse | undefined {
    const r = this.records.get(id);
    return r ? toResponse(r) : undefined;
  }

  create(input: CreateGroupRequest): GroupResponse {
    const nameLower = input.name.toLowerCase();
    for (const r of this.records.values()) {
      if (r.name.toLowerCase() === nameLower) {
        throw new ApiError(ErrorCode.CONFLICT, `A group named "${input.name}" already exists.`);
      }
    }
    const now = new Date().toISOString();
    const record: GroupRecord = {
      id: ulid(),
      name: input.name,
      mappingCount: 0,
      activeCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return toResponse(record);
  }

  update(id: string, patch: PatchGroupRequest): GroupResponse {
    const record = this.records.get(id);
    if (!record) throw new ApiError(ErrorCode.NOT_FOUND, `Group ${id} not found.`);
    const updated: GroupRecord = {
      ...record,
      ...(patch.name !== undefined && { name: patch.name }),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, updated);
    return toResponse(updated);
  }

  delete(id: string): void {
    if (!this.records.has(id)) throw new ApiError(ErrorCode.NOT_FOUND, `Group ${id} not found.`);
    this.records.delete(id);
  }

  updateCounts(id: string, counts: { mappingCount: number; activeCount: number }): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, ...counts });
  }

  generateDuplicateName(sourceName: string): string {
    const prefix = `${sourceName}_dup_`.toLowerCase();
    let max = 0;
    for (const r of this.records.values()) {
      const lower = r.name.toLowerCase();
      if (lower.startsWith(prefix)) {
        const suffix = lower.slice(prefix.length);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && String(n) === suffix) max = Math.max(max, n);
      }
    }
    return `${sourceName}_dup_${max + 1}`;
  }
}
