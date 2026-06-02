import React from 'react';
import type { HealthResponse } from '@portswitch/shared';
import type { ConflictMode } from '../hooks/useConflictMode';

interface Props {
  health: HealthResponse | null;
  loading: boolean;
  conflictMode: ConflictMode;
  onConflictModeChange: (m: ConflictMode) => void;
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  code: {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    padding: '1px 6px',
    borderRadius: '3px',
    fontFamily: 'ui-monospace, monospace',
  },
  pill: {
    display: 'flex',
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid var(--border-strong)',
    marginLeft: 'auto',
  },
};

function pillHalf(active: boolean): React.CSSProperties {
  return {
    padding: '2px 10px',
    fontSize: '11px',
    cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s, color 0.15s',
  };
}

function PillToggle({ mode, onChange }: { mode: ConflictMode; onChange: (m: ConflictMode) => void }): React.ReactElement {
  return (
    <div style={styles.pill} title="Conflict resolution mode">
      <button style={pillHalf(mode === 'validate')} onClick={() => onChange('validate')}>Validate</button>
      <button style={pillHalf(mode === 'auto')} onClick={() => onChange('auto')}>Auto</button>
    </div>
  );
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function StatusBar({ health, loading, conflictMode, onConflictModeChange }: Props): React.ReactElement {
  if (loading) {
    return (
      <div style={styles.bar}>
        <span style={{ ...styles.dot, background: 'var(--text-muted)' }} />
        <span>Connecting to daemon…</span>
        <PillToggle mode={conflictMode} onChange={onConflictModeChange} />
      </div>
    );
  }

  if (!health) {
    return (
      <div style={styles.bar}>
        <span style={{ ...styles.dot, background: 'var(--danger)' }} />
        <span>Daemon unreachable — start it with:</span>
        <code style={styles.code}>portswitch service start</code>
        <PillToggle mode={conflictMode} onChange={onConflictModeChange} />
      </div>
    );
  }

  return (
    <div style={styles.bar}>
      <span style={{ ...styles.dot, background: 'var(--success)' }} />
      <span>
        Daemon v{health.version} · uptime {formatDuration(health.uptimeMs)}
      </span>
      <PillToggle mode={conflictMode} onChange={onConflictModeChange} />
    </div>
  );
}
