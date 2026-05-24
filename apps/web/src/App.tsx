import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateMappingRequest,
  DuplicateGroupResponse,
  HealthResponse,
  MappingResponse,
  PatchMappingRequest,
  GroupResponse,
} from '@portswitch/shared';
import { StatusBar } from './components/StatusBar';
import { MappingList } from './components/MappingList';
import { AddMappingDialog, type MappingDialogValues } from './components/AddMappingDialog';
import { useColorScheme } from './theme';
import { apiClient } from './apiClient';

const layout: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', height: '100vh',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const toast: React.CSSProperties = {
  padding: '10px 16px', background: 'var(--toast-bg)',
  borderBottom: '1px solid var(--toast-border)', color: 'var(--danger)',
  fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
};
const toastClose: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '16px', padding: '0 4px',
};
const dialogOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const dialogBox: React.CSSProperties = {
  background: 'var(--bg-primary)', border: '1px solid var(--border)',
  borderRadius: '10px', padding: '24px', minWidth: '280px', maxWidth: '400px', width: '90%',
};

const HEALTH_POLL_MS = 10_000;
const WS_REFRESH_DEBOUNCE_MS = 200;
const TOAST_AUTO_DISMISS_MS = 6_000;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export default function App(): React.ReactElement {
  useColorScheme();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [mappings, setMappings] = useState<MappingResponse[]>([]);
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [addMappingGroupId, setAddMappingGroupId] = useState<string | null>(null);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editing, setEditing] = useState<MappingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [error]);

  const refreshHealth = useCallback(async () => {
    const h = await apiClient.daemon.health().catch(() => null);
    setHealth(h as HealthResponse | null);
    setHealthLoading(false);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [mResult, gResult] = await Promise.all([apiClient.mappings.list(), apiClient.groups.list()]);
      setMappings(mResult.mappings);
      setGroups(gResult.groups);
    } catch {
      // Failures are reflected by the daemon-unreachable status bar.
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshAll();
    }, WS_REFRESH_DEBOUNCE_MS);
  }, [refreshAll]);

  const scheduleRefreshRef = useRef(scheduleRefresh);
  useEffect(() => { scheduleRefreshRef.current = scheduleRefresh; }, [scheduleRefresh]);

  useEffect(() => {
    void refreshHealth();
    void refreshAll();
    const healthInterval = setInterval(() => void refreshHealth(), HEALTH_POLL_MS);
    const unsub = apiClient.events.subscribe(() => scheduleRefreshRef.current());
    return () => {
      clearInterval(healthInterval);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsub();
    };
  }, [refreshHealth, refreshAll]);

  const handleEnableGroup = async (id: string): Promise<void> => {
    try {
      const result = await apiClient.groups.enable(id);
      setGroups((prev) => prev.map((g) => (g.id === id ? result.group : g)));
      setMappings((prev) => {
        const updatedIds = new Set(result.mappings.map((m) => m.id));
        return prev.map((m) => (updatedIds.has(m.id) ? (result.mappings.find((u) => u.id === m.id) ?? m) : m));
      });
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDisableGroup = async (id: string): Promise<void> => {
    try {
      const result = await apiClient.groups.disable(id);
      setGroups((prev) => prev.map((g) => (g.id === id ? result.group : g)));
      setMappings((prev) => {
        const updatedIds = new Set(result.mappings.map((m) => m.id));
        return prev.map((m) => (updatedIds.has(m.id) ? (result.mappings.find((u) => u.id === m.id) ?? m) : m));
      });
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDeleteGroup = async (id: string): Promise<void> => {
    try {
      await apiClient.groups.delete(id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
      setMappings((prev) => prev.filter((m) => m.groupId !== id));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleAddGroup = async (): Promise<void> => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const group = await apiClient.groups.create({ name });
      setGroups((prev) => [...prev, group]);
      setShowAddGroup(false);
      setNewGroupName('');
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleRenameGroup = async (id: string, newName: string): Promise<void> => {
    try {
      const updated = await apiClient.groups.patch(id, { name: newName });
      setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDuplicateGroup = async (id: string): Promise<void> => {
    try {
      const result: DuplicateGroupResponse = await apiClient.groups.duplicate(id);
      setGroups((prev) => [...prev, result.group]);
      setMappings((prev) => [...prev, ...result.mappings]);
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleToggleMapping = async (id: string): Promise<void> => {
    try {
      const updated = await apiClient.mappings.toggle(id);
      setMappings((prev) => {
        const next = prev.map((m) => (m.id === id ? updated : m));
        setGroups((gs) => gs.map((g) => {
          if (g.id !== updated.groupId) return g;
          return { ...g, activeCount: next.filter((m) => m.groupId === g.id && m.enabled).length };
        }));
        return next;
      });
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDeleteMapping = async (id: string): Promise<void> => {
    try {
      await apiClient.mappings.delete(id);
      setMappings((prev) => {
        const next = prev.filter((m) => m.id !== id);
        const deleted = prev.find((m) => m.id === id);
        if (deleted) {
          setGroups((gs) => gs.map((g) => {
            if (g.id !== deleted.groupId) return g;
            return {
              ...g,
              mappingCount: next.filter((m) => m.groupId === g.id).length,
              activeCount: next.filter((m) => m.groupId === g.id && m.enabled).length,
            };
          }));
        }
        return next;
      });
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleAddMapping = async (values: MappingDialogValues): Promise<void> => {
    const r: CreateMappingRequest = { ...values, enabled: false };
    try {
      const created = await apiClient.mappings.create(r);
      setMappings((prev) => [...prev, created]);
      setAddMappingGroupId(null);
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleEditSave = async (values: MappingDialogValues): Promise<void> => {
    if (!editing) return;
    const patch: PatchMappingRequest = {
      name: values.name,
      sourceHost: values.sourceHost,
      sourcePort: values.sourcePort,
      targetHost: values.targetHost,
      targetPort: values.targetPort,
    };
    try {
      const updated = await apiClient.mappings.patch(editing.id, patch);
      setMappings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
    } catch (err) { setError(errorMessage(err)); }
  };

  return (
    <div style={layout}>
      <StatusBar health={health} loading={healthLoading} />
      {error && (
        <div style={toast} role="alert">
          <span>{error}</span>
          <button style={toastClose} onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
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

      {showAddGroup && (
        <div style={dialogOverlay} onClick={() => setShowAddGroup(false)}>
          <div style={dialogBox} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>New Group</h2>
            <input
              autoFocus
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }}
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddGroup(); if (e.key === 'Escape') { setShowAddGroup(false); setNewGroupName(''); } }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button style={{ padding: '6px 14px', border: '1px solid var(--border)', borderRadius: '6px', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '13px' }} onClick={() => { setShowAddGroup(false); setNewGroupName(''); }}>Cancel</button>
              <button style={{ padding: '6px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }} onClick={() => void handleAddGroup()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {addMappingGroupId && (
        <AddMappingDialog
          groupId={addMappingGroupId}
          onConfirm={(values) => void handleAddMapping(values)}
          onCancel={() => setAddMappingGroupId(null)}
        />
      )}
      {editing && (
        <AddMappingDialog
          groupId={editing.groupId}
          initial={editing}
          onConfirm={(values) => void handleEditSave(values)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
