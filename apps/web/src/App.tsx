import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateMappingRequest, HealthResponse, MappingResponse, PatchMappingRequest } from '@portswitch/shared';
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
  padding: '10px 16px',
  background: 'var(--toast-bg)',
  borderBottom: '1px solid var(--toast-border)',
  color: 'var(--danger)',
  fontSize: '13px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
};
const toastClose: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--danger)',
  cursor: 'pointer', fontSize: '16px', padding: '0 4px',
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
  const [showDialog, setShowDialog] = useState(false);
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

  const refreshMappings = useCallback(async () => {
    try {
      const result = await apiClient.mappings.list();
      setMappings(result.mappings);
    } catch {
      // Mapping list failure is reflected by the daemon-unreachable status bar.
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshMappings();
    }, WS_REFRESH_DEBOUNCE_MS);
  }, [refreshMappings]);

  const scheduleRefreshRef = useRef(scheduleRefresh);
  useEffect(() => { scheduleRefreshRef.current = scheduleRefresh; }, [scheduleRefresh]);

  useEffect(() => {
    void refreshHealth();
    void refreshMappings();
    const healthInterval = setInterval(() => void refreshHealth(), HEALTH_POLL_MS);
    const unsub = apiClient.events.subscribe(() => scheduleRefreshRef.current());
    return () => {
      clearInterval(healthInterval);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsub();
    };
  }, [refreshHealth, refreshMappings]);

  const handleToggle = async (id: string): Promise<void> => {
    try {
      const updated = await apiClient.mappings.toggle(id);
      setMappings((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await apiClient.mappings.delete(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleAdd = async (values: MappingDialogValues): Promise<void> => {
    const r: CreateMappingRequest = { ...values, enabled: false, groupId: 'GRP01' };
    try {
      const created = await apiClient.mappings.create(r);
      setMappings((prev) => [...prev, created]);
      setShowDialog(false);
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleEditSave = async (values: MappingDialogValues): Promise<void> => {
    if (!editing) return;
    const patch: PatchMappingRequest = { ...values };
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
        mappings={mappings}
        onToggle={(id) => void handleToggle(id)}
        onDelete={(id) => void handleDelete(id)}
        onEdit={(m) => setEditing(m)}
        onAdd={() => setShowDialog(true)}
      />
      {showDialog && (
        <AddMappingDialog
          onConfirm={(values) => void handleAdd(values)}
          onCancel={() => setShowDialog(false)}
        />
      )}
      {editing && (
        <AddMappingDialog
          initial={editing}
          onConfirm={(values) => void handleEditSave(values)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
