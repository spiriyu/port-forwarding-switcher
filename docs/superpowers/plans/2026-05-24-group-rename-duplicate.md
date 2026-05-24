# Group Rename & Duplicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rename (inline web UI + CLI subcommand) and duplicate (new backend route + CLI + web UI) operations to groups.

**Architecture:** A new `POST /v1/groups/:id/duplicate` endpoint handles atomic copy (group + all mappings with `enabled: false`, auto-naming `<source>_dup_N`). Rename uses the existing `PATCH /v1/groups/:id` — only the CLI subcommand and web inline-edit UI are new. Shared types get `DuplicateGroupResponse` and a `group.duplicated` WS event.

**Tech Stack:** TypeScript strict, Vitest, Express, React (inline styles), Zod schemas in `@portswitch/shared`.

---

## File Map

| File | Change |
|---|---|
| `libs/shared/src/types/api.ts` | Add `DuplicateGroupResponse` |
| `libs/shared/src/types/events.ts` | Add `group.duplicated` to `ServerMessage` union |
| `apps/cli/src/serve/store/group-store.ts` | Add `generateDuplicateName` method |
| `apps/cli/src/serve/store/group-store.test.ts` | Add tests for `generateDuplicateName` |
| `apps/cli/src/serve/routes/groups.ts` | Add `POST /:id/duplicate` route |
| `apps/cli/src/serve/server.groups.test.ts` | Add integration tests for duplicate + rename conflicts |
| `apps/cli/src/client.ts` | Add `duplicateGroup` method |
| `apps/cli/src/main.ts` | Add `rename` and `duplicate` cases to group switch |
| `apps/web/src/apiClient.ts` | Add `groups.duplicate` method |
| `apps/web/src/components/GroupSection.tsx` | Add inline rename + duplicate button |
| `apps/web/src/components/MappingList.tsx` | Thread `onRenameGroup` / `onDuplicateGroup` props |
| `apps/web/src/App.tsx` | Add `handleRenameGroup` / `handleDuplicateGroup` handlers |

---

## Task 1: Shared types

**Files:**
- Modify: `libs/shared/src/types/api.ts:80-86`
- Modify: `libs/shared/src/types/events.ts:18-32`

- [ ] **Step 1: Add `DuplicateGroupResponse` to `libs/shared/src/types/api.ts`**

  After the closing brace of `PatchGroupRequest` (line 86), add:

  ```typescript
  export interface DuplicateGroupResponse {
    group: GroupResponse;
    mappings: MappingResponse[];
  }
  ```

- [ ] **Step 2: Add `group.duplicated` event to `libs/shared/src/types/events.ts`**

  On line 28, after the `group.toggled` line, add:

  ```typescript
    | { type: 'group.duplicated'; payload: { group: GroupResponse; mappings: MappingResponse[] } }
  ```

- [ ] **Step 3: Build shared to verify no type errors**

  ```bash
  npx nx run shared:typecheck
  ```
  Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add libs/shared/src/types/api.ts libs/shared/src/types/events.ts
  git commit -m "feat(shared): add DuplicateGroupResponse type and group.duplicated event"
  ```

---

## Task 2: `generateDuplicateName` in group-store (TDD)

**Files:**
- Modify: `apps/cli/src/serve/store/group-store.test.ts`
- Modify: `apps/cli/src/serve/store/group-store.ts`

- [ ] **Step 1: Write failing tests for `generateDuplicateName`**

  At the end of `group-store.test.ts`, before the closing `});` of the top-level `describe`, add:

  ```typescript
  describe('generateDuplicateName', () => {
    it('returns <name>_dup_1 when no dups exist', () => {
      store.create({ name: 'Dev' });
      expect(store.generateDuplicateName('Dev')).toBe('Dev_dup_1');
    });

    it('returns <name>_dup_2 when _dup_1 exists', () => {
      store.create({ name: 'Dev' });
      store.create({ name: 'Dev_dup_1' });
      expect(store.generateDuplicateName('Dev')).toBe('Dev_dup_2');
    });

    it('returns max+1 (not gap-fill) when only _dup_2 exists', () => {
      store.create({ name: 'Dev' });
      store.create({ name: 'Dev_dup_2' });
      expect(store.generateDuplicateName('Dev')).toBe('Dev_dup_3');
    });

    it('works on a source name that has no existing groups', () => {
      expect(store.generateDuplicateName('Prod')).toBe('Prod_dup_1');
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npx nx test cli -- -t "generateDuplicateName" --reporter=verbose
  ```
  Expected: 4 failures — `store.generateDuplicateName is not a function`.

- [ ] **Step 3: Implement `generateDuplicateName` in `group-store.ts`**

  Add this method to `InMemoryGroupStore` after the `updateCounts` method (before the closing `}`):

  ```typescript
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
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  npx nx test cli -- -t "generateDuplicateName" --reporter=verbose
  ```
  Expected: 4 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/cli/src/serve/store/group-store.ts apps/cli/src/serve/store/group-store.test.ts
  git commit -m "feat(cli): add generateDuplicateName to InMemoryGroupStore"
  ```

---

## Task 3: `POST /v1/groups/:id/duplicate` route (TDD)

**Files:**
- Modify: `apps/cli/src/serve/server.groups.test.ts`
- Modify: `apps/cli/src/serve/routes/groups.ts`

- [ ] **Step 1: Write failing integration tests**

  At the end of `server.groups.test.ts`, add:

  ```typescript
  describe('POST /api/v1/groups/:id/duplicate', () => {
    it('creates a new group with _dup_1 suffix', async () => {
      const g = await req<{ id: string; name: string }>('POST', '/api/v1/groups', { name: 'Dev' });
      const r = await req<{ group: { name: string }; mappings: unknown[] }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
      expect(r.status).toBe(201);
      expect(r.body.group.name).toBe('Dev_dup_1');
    });

    it('copies all mappings into the new group with enabled: false', async () => {
      const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
      await req('POST', '/api/v1/mappings', { sourcePort: 19900, targetHost: '127.0.0.1', targetPort: 19901, groupId: g.body.id });
      await req('POST', '/api/v1/mappings', { sourcePort: 19902, targetHost: '127.0.0.1', targetPort: 19903, groupId: g.body.id });
      const r = await req<{ group: { id: string }; mappings: Array<{ enabled: boolean; groupId: string }> }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
      expect(r.status).toBe(201);
      expect(r.body.mappings).toHaveLength(2);
      expect(r.body.mappings.every((m) => !m.enabled)).toBe(true);
      expect(r.body.mappings.every((m) => m.groupId === r.body.group.id)).toBe(true);
    });

    it('second duplicate gets _dup_2', async () => {
      const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
      await req('POST', `/api/v1/groups/${g.body.id}/duplicate`);
      const r2 = await req<{ group: { name: string } }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
      expect(r2.status).toBe(201);
      expect(r2.body.group.name).toBe('Dev_dup_2');
    });

    it('duplicates an empty group (no mappings)', async () => {
      const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Empty' });
      const r = await req<{ group: { name: string }; mappings: unknown[] }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
      expect(r.status).toBe(201);
      expect(r.body.group.name).toBe('Empty_dup_1');
      expect(r.body.mappings).toHaveLength(0);
    });

    it('returns 404 for unknown group id', async () => {
      const r = await req('POST', '/api/v1/groups/NOPE/duplicate');
      expect(r.status).toBe(404);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npx nx test cli -- -t "duplicate" --reporter=verbose
  ```
  Expected: 5 failures — 404 on the route.

- [ ] **Step 3: Add duplicate route to `routes/groups.ts`**

  Add this block after the `POST /:id/disable` handler (before `return router;` on line 165):

  ```typescript
  // POST /v1/groups/:id/duplicate
  router.post('/:id/duplicate', (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      const source = groupStore.get(id);
      if (!source) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));

      const newName = groupStore.generateDuplicateName(source.name);
      const newGroup = groupStore.create({ name: newName });

      const sourceMembers = store.listByGroup(id);
      const newMappings = sourceMembers.map((m) =>
        store.create({
          name: m.name,
          sourceHost: m.sourceHost,
          sourcePort: m.sourcePort,
          targetHost: m.targetHost,
          targetPort: m.targetPort,
          enabled: false,
          groupId: newGroup.id,
        }),
      );

      groupStore.updateCounts(newGroup.id, { mappingCount: newMappings.length, activeCount: 0 });
      const updatedGroup = groupStore.get(newGroup.id)!;

      persist();
      eventBus.broadcast({ type: 'group.duplicated', payload: { group: updatedGroup, mappings: newMappings } });
      res.status(201).json({ group: updatedGroup, mappings: newMappings });
    } catch (err) {
      sendApiError(res, err);
    }
  });
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  npx nx test cli -- -t "duplicate" --reporter=verbose
  ```
  Expected: all 5 tests pass.

- [ ] **Step 5: Run the full CLI test suite to check for regressions**

  ```bash
  npx nx test cli --reporter=verbose
  ```
  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/cli/src/serve/routes/groups.ts apps/cli/src/serve/server.groups.test.ts
  git commit -m "feat(cli): add POST /v1/groups/:id/duplicate route"
  ```

---

## Task 4: `DaemonClient.duplicateGroup` method

**Files:**
- Modify: `apps/cli/src/client.ts:1-16` (imports), `apps/cli/src/client.ts:85-91` (group methods)

- [ ] **Step 1: Add `DuplicateGroupResponse` to the import in `client.ts`**

  Change the import block at the top of `client.ts` (lines 1-16):

  ```typescript
  import {
    ErrorCode,
    DEFAULT_DAEMON_PORT,
    type ApiErrorBody,
    type MappingResponse,
    type ListMappingsResponse,
    type CreateMappingRequest,
    type PatchMappingRequest,
    type HealthResponse,
    type DiagnosticsResponse,
    type LogEntry,
    type GroupResponse,
    type ListGroupsResponse,
    type CreateGroupRequest,
    type PatchGroupRequest,
    type DuplicateGroupResponse,
  } from '@portswitch/shared';
  ```

- [ ] **Step 2: Add `duplicateGroup` method**

  After `disableGroup` (line 91), add:

  ```typescript
  duplicateGroup(id: string) { return this.req<DuplicateGroupResponse>('POST', `/v1/groups/${id}/duplicate`); }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npx nx run cli:typecheck
  ```
  Expected: exits 0.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/cli/src/client.ts
  git commit -m "feat(cli): add duplicateGroup to DaemonClient"
  ```

---

## Task 5: CLI `group rename` and `group duplicate` subcommands

**Files:**
- Modify: `apps/cli/src/main.ts:431-533`

- [ ] **Step 1: Update group command description and add `--new-name` option**

  Replace the `groupCmd` definition (lines 430-433):

  ```typescript
  const groupCmd = program
    .command('group <action>')
    .description('Manage groups  (actions: list, add, rename, enable, disable, remove, duplicate)')
    .option('-n, --name <name>', 'group name or id')
    .option('--new-name <newName>', 'new name (for rename)');
  ```

- [ ] **Step 2: Add `rename` case to the switch**

  After the `add` case (after line 469's `break;`), add:

  ```typescript
  case 'rename': {
    if (!opts.name) {
      console.error(chalk.red('Error:'), '--name is required for group rename');
      process.exit(ExitCode.BAD_INVOCATION);
    }
    const newName = (groupCmd.opts() as { newName?: string }).newName;
    if (!newName) {
      console.error(chalk.red('Error:'), '--new-name is required for group rename');
      process.exit(ExitCode.BAD_INVOCATION);
    }
    const { groups: all } = await c.listGroups();
    const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
    if (!match) {
      console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
      process.exit(ExitCode.DAEMON_ERROR);
    }
    const renamed = await c.patchGroup(match.id, { name: newName });
    if (isJson()) {
      console.log(toJson(renamed));
    } else {
      console.log(chalk.green('Renamed:'), match.name, '→', renamed.name, chalk.dim(`(${renamed.id})`));
    }
    break;
  }
  ```

- [ ] **Step 3: Add `duplicate` case to the switch**

  After the `rename` case's `break;`, add:

  ```typescript
  case 'duplicate': {
    if (!opts.name) {
      console.error(chalk.red('Error:'), '--name is required for group duplicate');
      process.exit(ExitCode.BAD_INVOCATION);
    }
    const { groups: all } = await c.listGroups();
    const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
    if (!match) {
      console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
      process.exit(ExitCode.DAEMON_ERROR);
    }
    const result = await c.duplicateGroup(match.id);
    if (isJson()) {
      console.log(toJson(result));
    } else {
      console.log(
        chalk.green('Duplicated:'),
        match.name,
        '→',
        result.group.name,
        chalk.dim(`(${result.mappings.length} mapping(s), all disabled)`),
      );
    }
    break;
  }
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  npx nx run cli:typecheck
  ```
  Expected: exits 0.

- [ ] **Step 5: Build and smoke-test CLI help**

  ```bash
  npx nx run cli:build && node dist/apps/cli/main.js group --help
  ```
  Expected: output lists `list, add, rename, enable, disable, remove, duplicate` in the description.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/cli/src/main.ts
  git commit -m "feat(cli): add group rename and group duplicate subcommands"
  ```

---

## Task 6: Web API client — `groups.duplicate`

**Files:**
- Modify: `apps/web/src/apiClient.ts:1-11` (imports), `apps/web/src/apiClient.ts:34-41` (groups object)

- [ ] **Step 1: Add `DuplicateGroupResponse` to the import block**

  Replace the import block (lines 1-11):

  ```typescript
  import type {
    HealthResponse,
    ListMappingsResponse,
    ListGroupsResponse,
    GroupResponse,
    MappingResponse,
    CreateMappingRequest,
    PatchMappingRequest,
    CreateGroupRequest,
    PatchGroupRequest,
    DuplicateGroupResponse,
  } from '@portswitch/shared';
  ```

- [ ] **Step 2: Add `duplicate` to the `groups` object**

  After `disable` (line 40), add:

  ```typescript
    duplicate: (id: string) => req<DuplicateGroupResponse>('POST', `/groups/${id}/duplicate`),
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npx nx run web:typecheck
  ```
  Expected: exits 0.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/apiClient.ts
  git commit -m "feat(web): add groups.duplicate to web apiClient"
  ```

---

## Task 7: `GroupSection` — inline rename + duplicate button

**Files:**
- Modify: `apps/web/src/components/GroupSection.tsx`

- [ ] **Step 1: Add `onRename` and `onDuplicate` to `GroupSectionProps`**

  Replace the `GroupSectionProps` interface (lines 141-151):

  ```typescript
  export interface GroupSectionProps {
    group: GroupResponse;
    mappings: MappingResponse[];
    onEnable: () => void;
    onDisable: () => void;
    onToggleMapping: (id: string) => void;
    onDeleteMapping: (id: string) => void;
    onEditMapping: (m: MappingResponse) => void;
    onAddMapping: () => void;
    onDeleteGroup: () => void;
    onRename: (newName: string) => void;
    onDuplicate: () => void;
  }
  ```

- [ ] **Step 2: Update the function signature to destructure new props**

  Replace the destructuring line (lines 153-158):

  ```typescript
  export function GroupSection({
    group, mappings,
    onEnable, onDisable,
    onToggleMapping, onDeleteMapping, onEditMapping, onAddMapping,
    onDeleteGroup, onRename, onDuplicate,
  }: GroupSectionProps): React.ReactElement {
  ```

- [ ] **Step 3: Add rename state and `renameInputStyle` to the styles object**

  After `const [confirmingDelete, setConfirmingDelete] = useState(false);` (line 160), add:

  ```typescript
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  ```

  In the `styles` object (after `emptyMsg` on line 87), add:

  ```typescript
  renameInput: {
    fontSize: '14px',
    fontWeight: 600,
    flex: 1,
    background: 'var(--bg-primary)',
    border: '1px solid var(--accent)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    padding: '1px 6px',
    outline: 'none',
  },
  ```

- [ ] **Step 4: Replace the static `<span style={styles.groupName}>` with conditional inline edit**

  Replace the `<span style={styles.groupName}>{group.name}</span>` (line 178) with:

  ```tsx
  {renaming ? (
    <input
      autoFocus
      style={styles.renameInput}
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== group.name) onRename(trimmed);
        setRenaming(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const trimmed = renameValue.trim();
          if (trimmed && trimmed !== group.name) onRename(trimmed);
          setRenaming(false);
        }
        if (e.key === 'Escape') setRenaming(false);
      }}
    />
  ) : (
    <span
      style={{ ...styles.groupName, cursor: 'text' }}
      title="Click to rename"
      onClick={(e) => { e.stopPropagation(); setRenameValue(group.name); setRenaming(true); }}
    >
      {group.name}
    </span>
  )}
  ```

- [ ] **Step 5: Add a duplicate button in the header action row**

  Before the delete button (line 190), add:

  ```tsx
  <button
    style={{ ...styles.actionBtn, color: 'var(--text-secondary)' }}
    onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
    title="Duplicate group"
    aria-label="Duplicate group"
  >
    ⧉
  </button>
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  npx nx run web:typecheck
  ```
  Expected: errors about `onRename` / `onDuplicate` missing in callers — that's expected and will be fixed in the next task.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/web/src/components/GroupSection.tsx
  git commit -m "feat(web): add inline rename and duplicate button to GroupSection"
  ```

---

## Task 8: Thread new props through `MappingList`

**Files:**
- Modify: `apps/web/src/components/MappingList.tsx`

- [ ] **Step 1: Add `onRenameGroup` and `onDuplicateGroup` to `Props`**

  Replace the `interface Props` (lines 5-16):

  ```typescript
  interface Props {
    groups: GroupResponse[];
    mappings: MappingResponse[];
    onEnableGroup: (id: string) => void;
    onDisableGroup: (id: string) => void;
    onToggleMapping: (id: string) => void;
    onDeleteMapping: (id: string) => void;
    onEditMapping: (m: MappingResponse) => void;
    onAddMapping: (groupId: string) => void;
    onDeleteGroup: (id: string) => void;
    onAddGroup: () => void;
    onRenameGroup: (id: string, newName: string) => void;
    onDuplicateGroup: (id: string) => void;
  }
  ```

- [ ] **Step 2: Update the function signature and pass new props to `GroupSection`**

  Replace the `MappingList` function (lines 29-61):

  ```tsx
  export function MappingList({
    groups, mappings,
    onEnableGroup, onDisableGroup,
    onToggleMapping, onDeleteMapping, onEditMapping,
    onAddMapping, onDeleteGroup, onAddGroup,
    onRenameGroup, onDuplicateGroup,
  }: Props): React.ReactElement {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.title}>Port Mappings</span>
          <button style={styles.addBtn} onClick={onAddGroup}>+ Add Group</button>
        </div>
        {groups.length === 0 ? (
          <p style={styles.empty}>No groups yet. Click &ldquo;Add Group&rdquo; to get started.</p>
        ) : (
          groups.map((g) => (
            <GroupSection
              key={g.id}
              group={g}
              mappings={mappings.filter((m) => m.groupId === g.id)}
              onEnable={() => onEnableGroup(g.id)}
              onDisable={() => onDisableGroup(g.id)}
              onToggleMapping={onToggleMapping}
              onDeleteMapping={onDeleteMapping}
              onEditMapping={onEditMapping}
              onAddMapping={() => onAddMapping(g.id)}
              onDeleteGroup={() => onDeleteGroup(g.id)}
              onRename={(newName) => onRenameGroup(g.id, newName)}
              onDuplicate={() => onDuplicateGroup(g.id)}
            />
          ))
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npx nx run web:typecheck
  ```
  Expected: errors about missing `onRenameGroup` / `onDuplicateGroup` in `App.tsx` — fixed next.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/components/MappingList.tsx
  git commit -m "feat(web): thread onRenameGroup and onDuplicateGroup through MappingList"
  ```

---

## Task 9: `App.tsx` — handlers + WS event + wire-up

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add `DuplicateGroupResponse` to the import**

  Replace the import from `@portswitch/shared` (lines 2-8):

  ```typescript
  import type {
    CreateMappingRequest,
    DuplicateGroupResponse,
    HealthResponse,
    MappingResponse,
    PatchMappingRequest,
    GroupResponse,
  } from '@portswitch/shared';
  ```

- [ ] **Step 2: Add `handleRenameGroup` handler**

  After `handleAddGroup` (after line 145's `};`), add:

  ```typescript
  const handleRenameGroup = async (id: string, newName: string): Promise<void> => {
    try {
      const updated = await apiClient.groups.patch(id, { name: newName });
      setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
    } catch (err) { setError(errorMessage(err)); }
  };
  ```

- [ ] **Step 3: Add `handleDuplicateGroup` handler**

  After `handleRenameGroup`, add:

  ```typescript
  const handleDuplicateGroup = async (id: string): Promise<void> => {
    try {
      const result = await apiClient.groups.duplicate(id);
      setGroups((prev) => [...prev, result.group]);
      setMappings((prev) => [...prev, ...result.mappings]);
    } catch (err) { setError(errorMessage(err)); }
  };
  ```

- [ ] **Step 4: Handle the `group.duplicated` WS event in `refreshAll`**

  The existing `apiClient.events.subscribe(() => scheduleRefreshRef.current())` already triggers a full refresh on any WS event, so `group.duplicated` is handled automatically — no code change needed for WS sync.

- [ ] **Step 5: Pass new handlers to `MappingList`**

  In the JSX, replace `<MappingList` props (lines 216-227):

  ```tsx
  <MappingList
    groups={groups}
    mappings={mappings}
    onEnableGroup={(id) => void handleEnableGroup(id)}
    onDisableGroup={(id) => void handleDisableGroup(id)}
    onToggleMapping={(id) => void handleToggleMapping(id)}
    onDeleteMapping={(id) => void handleDeleteMapping(id)}
    onEditMapping={(m) => setEditing(m)}
    onAddMapping={(groupId) => setAddMappingGroupId(groupId)}
    onDeleteGroup={(id) => void handleDeleteGroup(id)}
    onAddGroup={() => setShowAddGroup(true)}
    onRenameGroup={(id, newName) => void handleRenameGroup(id, newName)}
    onDuplicateGroup={(id) => void handleDuplicateGroup(id)}
  />
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  npx nx run web:typecheck
  ```
  Expected: exits 0, no errors.

- [ ] **Step 7: Build the full stack and verify**

  ```bash
  npx nx run cli:build && npx nx run web:build && npx nx run cli:copy-ui
  node dist/apps/cli/main.js serve &
  sleep 2
  curl -s http://127.0.0.1:65432/api/v1/health | grep '"status":"ok"'
  kill %1
  ```
  Expected: health check returns `"status":"ok"`.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/web/src/App.tsx
  git commit -m "feat(web): add rename and duplicate group handlers in App.tsx"
  ```

---

## Task 10: Full test suite pass

- [ ] **Step 1: Run all tests**

  ```bash
  npx nx run-many -t test
  ```
  Expected: all projects pass with no failures.

- [ ] **Step 2: Run typecheck across all projects**

  ```bash
  npx nx run-many -t typecheck
  ```
  Expected: exits 0.

- [ ] **Step 3: If any failures, fix and commit before proceeding**
