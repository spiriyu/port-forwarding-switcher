import type { MappingResponse } from '@portswitch/shared';

export function detectMappingConflicts(
  mappingId: string,
  allMappings: MappingResponse[],
): MappingResponse[] {
  const target = allMappings.find((m) => m.id === mappingId);
  if (!target) return [];
  return allMappings.filter(
    (m) =>
      m.id !== mappingId &&
      m.groupId !== target.groupId &&
      m.enabled &&
      m.sourceHost === target.sourceHost &&
      m.sourcePort === target.sourcePort,
  );
}

export function detectGroupConflicts(
  groupId: string,
  allMappings: MappingResponse[],
): MappingResponse[] {
  const groupMappings = allMappings.filter((m) => m.groupId === groupId);
  const targetPorts = new Set(groupMappings.map((m) => `${m.sourceHost}:${m.sourcePort}`));
  return allMappings.filter(
    (m) =>
      m.groupId !== groupId &&
      m.enabled &&
      targetPorts.has(`${m.sourceHost}:${m.sourcePort}`),
  );
}
