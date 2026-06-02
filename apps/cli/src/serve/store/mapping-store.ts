import { ulid } from 'ulid';
import {
  MappingResponse,
  MappingConfig,
  MappingStats,
  MappingStatus,
  CreateMappingRequest,
  PatchMappingRequest,
  BulkOperation,
  BulkResultItem,
  ApiError,
  ApiErrorBody,
  ErrorCode,
} from '@spiriyu/shared';

interface MappingRecord {
  id: string;
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  drainTimeoutMs: number;
  groupId: string;
  stats: MappingStats;
  status: MappingStatus;
  error?: ApiErrorBody;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_STATS: MappingStats = {
  openConnections: 0,
  totalConnections: 0,
  bytesIn: 0,
  bytesOut: 0,
};

function toResponse(record: MappingRecord): MappingResponse {
  return {
    id: record.id,
    name: record.name,
    sourceHost: record.sourceHost,
    sourcePort: record.sourcePort,
    targetHost: record.targetHost,
    targetPort: record.targetPort,
    enabled: record.enabled,
    groupId: record.groupId,
    status: record.status,
    stats: record.stats,
    ...(record.error && { error: record.error }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class InMemoryMappingStore {
  private records = new Map<string, MappingRecord>();

  hydrate(configs: MappingConfig[]): void {
    this.records.clear();
    for (const c of configs) {
      this.records.set(c.id, {
        ...c,
        stats: { ...EMPTY_STATS },
        status: 'disabled',
      });
    }
  }

  toConfigs(): MappingConfig[] {
    return Array.from(this.records.values()).map((r) => ({
      id: r.id,
      name: r.name,
      sourceHost: r.sourceHost,
      sourcePort: r.sourcePort,
      targetHost: r.targetHost,
      targetPort: r.targetPort,
      enabled: r.enabled,
      drainTimeoutMs: r.drainTimeoutMs,
      groupId: r.groupId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  list(): MappingResponse[] {
    return Array.from(this.records.values()).map(toResponse);
  }

  listByGroup(groupId: string): MappingResponse[] {
    return Array.from(this.records.values())
      .filter((r) => r.groupId === groupId)
      .map(toResponse);
  }

  get(id: string): MappingResponse | undefined {
    const r = this.records.get(id);
    return r ? toResponse(r) : undefined;
  }

  create(input: CreateMappingRequest): MappingResponse {
    const sourceHost = input.sourceHost ?? '127.0.0.1';
    const sourcePort = input.sourcePort;

    if (this.hasConflict(sourceHost, sourcePort, input.groupId)) {
      throw new ApiError(
        ErrorCode.CONFLICT,
        `Source ${sourceHost}:${sourcePort} is already used by another mapping in this group.`,
      );
    }

    const now = new Date().toISOString();
    const record: MappingRecord = {
      id: ulid(),
      name: input.name ?? '',
      sourceHost,
      sourcePort,
      targetHost: input.targetHost,
      targetPort: input.targetPort,
      enabled: input.enabled ?? false,
      drainTimeoutMs: 30000,
      groupId: input.groupId,
      stats: { ...EMPTY_STATS },
      status: 'disabled',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return toResponse(record);
  }

  update(id: string, patch: PatchMappingRequest): MappingResponse {
    const record = this.records.get(id);
    if (!record) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Mapping ${id} not found.`);
    }

    const newSourceHost = patch.sourceHost ?? record.sourceHost;
    const newSourcePort = patch.sourcePort ?? record.sourcePort;

    if (
      (patch.sourceHost !== undefined || patch.sourcePort !== undefined) &&
      this.hasConflict(newSourceHost, newSourcePort, record.groupId, id)
    ) {
      throw new ApiError(
        ErrorCode.CONFLICT,
        `Source ${newSourceHost}:${newSourcePort} is already used by another mapping in this group.`,
      );
    }

    const updated: MappingRecord = {
      ...record,
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.sourceHost !== undefined && { sourceHost: patch.sourceHost }),
      ...(patch.sourcePort !== undefined && { sourcePort: patch.sourcePort }),
      ...(patch.targetHost !== undefined && { targetHost: patch.targetHost }),
      ...(patch.targetPort !== undefined && { targetPort: patch.targetPort }),
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, updated);
    return toResponse(updated);
  }

  delete(id: string): void {
    if (!this.records.has(id)) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Mapping ${id} not found.`);
    }
    this.records.delete(id);
  }

  toggle(id: string): MappingResponse {
    const record = this.records.get(id);
    if (!record) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Mapping ${id} not found.`);
    }
    return this.update(id, { enabled: !record.enabled });
  }

  bulk(ops: BulkOperation[]): BulkResultItem[] {
    return ops.map((op) => {
      try {
        if (op.op === 'create') {
          return { ok: true, mapping: this.create(op.mapping) };
        }
        if (op.op === 'update') {
          return { ok: true, mapping: this.update(op.id, op.patch) };
        }
        // delete
        this.delete(op.id);
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError) {
          return { ok: false, error: { code: err.code, message: err.message } };
        }
        return { ok: false, error: { code: ErrorCode.INTERNAL, message: String(err) } };
      }
    });
  }

  setListening(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, status: 'listening', error: undefined });
  }

  setDisabled(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, status: 'disabled', error: undefined });
  }

  setError(id: string, code: ErrorCode, message: string): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, status: 'error', error: { code, message } });
  }

  updateStats(id: string, stats: MappingStats): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, stats });
  }

  /** Returns IDs of enabled mappings in other groups that would conflict with any mapping in the given group (regardless of their current enabled state). */
  findConflictsIfEnabled(groupId: string): string[] {
    const groupMappings = Array.from(this.records.values()).filter(
      (r) => r.groupId === groupId,
    );
    const otherEnabled = Array.from(this.records.values()).filter(
      (r) => r.groupId !== groupId && r.enabled,
    );

    const conflicts: string[] = [];
    for (const gm of groupMappings) {
      const conflict = otherEnabled.find(
        (om) => om.sourceHost === gm.sourceHost && om.sourcePort === gm.sourcePort,
      );
      if (conflict) conflicts.push(conflict.id);
    }
    return conflicts;
  }

  /**
   * Returns IDs of enabled mappings in OTHER groups that conflict on
   * sourceHost:sourcePort with enabled mappings IN the given group.
   */
  findActiveConflicts(groupId: string): string[] {
    const groupMappings = Array.from(this.records.values()).filter(
      (r) => r.groupId === groupId && r.enabled,
    );
    const otherEnabled = Array.from(this.records.values()).filter(
      (r) => r.groupId !== groupId && r.enabled,
    );

    const conflicts: string[] = [];
    for (const gm of groupMappings) {
      const conflict = otherEnabled.find(
        (om) => om.sourceHost === gm.sourceHost && om.sourcePort === gm.sourcePort,
      );
      if (conflict) conflicts.push(conflict.id);
    }
    return conflicts;
  }

  private hasConflict(
    sourceHost: string,
    sourcePort: number,
    groupId: string,
    excludeId?: string,
  ): boolean {
    for (const [id, r] of this.records) {
      if (excludeId && id === excludeId) continue;
      if (r.groupId !== groupId) continue;
      if (r.sourceHost === sourceHost && r.sourcePort === sourcePort) return true;
    }
    return false;
  }
}
