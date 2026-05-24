# Group Rename & Duplicate — Design Spec

**Date:** 2026-05-24
**Status:** Approved

## Summary

Add two operations to groups: **rename** (inline edit in the web UI, `group rename` in the CLI) and **duplicate** (copies group + all mappings with `enabled: false`, auto-names `<source>_dup_N`). Both operations are fully surfaced across the backend, CLI, and web UI.

---

## Shared Types (`libs/shared`)

### `api.ts`

Add `DuplicateGroupResponse`:

```typescript
export interface DuplicateGroupResponse {
  group: GroupResponse;
  mappings: MappingResponse[];
}
```

No new request type — duplicate takes no body.

### `events.ts`

Add to `ServerMessage` union:

```typescript
| { type: 'group.duplicated'; payload: { group: GroupResponse; mappings: MappingResponse[] } }
```

---

## Backend (`apps/cli/src/serve`)

### Naming logic — `group-store.ts`

New method `generateDuplicateName(sourceName: string): string`:
- Scans all existing group names for the pattern `<sourceName>_dup_<N>` (exact, case-insensitive).
- Returns `<sourceName>_dup_1` if none exist; otherwise returns `<sourceName>_dup_<max+1>`.

### New route — `routes/groups.ts`

```
POST /v1/groups/:id/duplicate
```

Steps (atomic — all mutations happen before any persist/broadcast):
1. Look up source group → 404 if not found.
2. Call `generateDuplicateName(source.name)` → new name.
3. Create new group record with new ULID, new name, current timestamps.
4. Fetch all mappings where `groupId === source.id`.
5. For each mapping: create a copy with a new ULID, same `sourcePort`/`targetPort`, `enabled: false`, assigned to the new group.
6. Persist config (`saveConfig`).
7. Broadcast `group.duplicated` event with new group + new mappings.
8. Return `DuplicateGroupResponse` (HTTP 201).

### Rename

No backend changes. `PATCH /v1/groups/:id` already accepts `{ name }`, validates uniqueness, updates timestamps, broadcasts `group.updated`.

---

## CLI (`apps/cli/src`)

### New subcommands — `main.ts`

```
portswitch group rename --name <name|id> --new-name <new-name>
portswitch group duplicate --name <name|id>
```

**`rename`**:
- Resolves group by name or id (same helper used by existing subcommands).
- Calls `client.patchGroup(id, { name: newName })`.
- Prints: `Renamed group "<old>" → "<new>"`.

**`duplicate`**:
- Resolves group by name or id.
- Calls `client.duplicateGroup(id)`.
- Prints: `Duplicated group "<source>" → "<new>" (N mappings, all disabled)`.

### `DaemonClient` — `client.ts`

```typescript
duplicateGroup(id: string): Promise<DuplicateGroupResponse>
// POST /v1/groups/{id}/duplicate
```

---

## Web UI (`apps/web/src`)

### `GroupSection.tsx` — header changes

**Rename (inline edit):**
- Group name rendered as a `<span>` with a subtle edit affordance (pencil icon or double-click hint).
- Clicking the name (or icon) swaps it for a controlled `<input>` pre-filled with the current name.
- **Commit**: blur or Enter → calls `onRenameGroup(id, newName)` if name changed; reverts to span.
- **Cancel**: Escape → reverts to span with no API call.
- Empty or whitespace-only name: revert without calling API.

**Duplicate button:**
- Icon button in the header action row, alongside Enable All / Disable All / Delete.
- On click: calls `onDuplicateGroup(id)`.
- No confirmation dialog needed (non-destructive; duplicate starts fully disabled).

### `App.tsx` — new handlers

```typescript
handleRenameGroup(id: string, newName: string): void
// PATCH /v1/groups/{id} → { name: newName }
// On success: update group name in state

handleDuplicateGroup(id: string): void
// POST /v1/groups/{id}/duplicate
// On success: append new group + new mappings to state
```

WS event `group.duplicated` also triggers the same state update so other connected clients stay in sync.

### `apiClient.ts`

```typescript
duplicate: (id: string) => req<DuplicateGroupResponse>('POST', `/groups/${id}/duplicate`)
```

---

## Error handling

| Scenario | Response |
|---|---|
| Source group not found (rename or duplicate) | 404 `GROUP_NOT_FOUND` |
| New name already taken (rename) | 409 `GROUP_NAME_CONFLICT` |
| Rename with empty/whitespace name | 400 (schema validation) |

---

## Testing

### Unit tests — `group-store.test.ts`
- `generateDuplicateName` with no existing dups → returns `_dup_1`.
- `generateDuplicateName` with `_dup_1` and `_dup_2` existing → returns `_dup_3`.
- `generateDuplicateName` with gap (only `_dup_2`) → returns `_dup_3` (max+1, not gap-fill).

### Integration tests — `server.groups.test.ts`
- Duplicate: new group created with correct name, all mappings copied, all disabled.
- Duplicate twice: second duplicate gets `_dup_2`.
- Duplicate group with no mappings: new empty group created.
- Rename: name updated, `updatedAt` refreshed, `group.updated` event broadcast.
- Rename to existing name: 409.
