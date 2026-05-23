import React, { useEffect, useState } from 'react';
import type { MappingResponse } from '@portswitch/shared';

interface Props {
  mappings: MappingResponse[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (mapping: MappingResponse) => void;
  onAdd: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  listening: 'var(--success)',
  disabled: 'var(--text-muted)',
  error: 'var(--danger)',
};

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '16px', flex: 1, overflowY: 'auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  title: { fontSize: '16px', fontWeight: 600 },
  addBtn: {
    padding: '6px 14px',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  empty: {
    color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', paddingTop: '40px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: 'var(--bg-secondary)',
    borderRadius: '8px',
    marginBottom: '8px',
    border: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  name: {
    fontSize: '14px', fontWeight: 500, minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flex: '1 1 120px',
  },
  route: {
    fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace',
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flex: '2 1 200px',
  },
  stats: {
    fontSize: '11px', color: 'var(--text-faint)', fontFamily: 'ui-monospace, monospace',
    whiteSpace: 'nowrap', flexShrink: 0,
  },
  errorMsg: {
    flexBasis: '100%', fontSize: '12px', color: 'var(--danger)',
    margin: 0, paddingLeft: '20px',
  },
  actionBtn: {
    padding: '4px 8px',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    background: 'transparent',
    flexShrink: 0,
  },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

interface RowProps {
  mapping: MappingResponse;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function MappingRow({ mapping: m, onToggle, onDelete, onEdit }: RowProps): React.ReactElement {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const handleDeleteClick = (): void => {
    if (confirming) {
      setConfirming(false);
      onDelete();
    } else {
      setConfirming(true);
    }
  };

  const hasTraffic = m.stats.totalConnections > 0 || m.stats.bytesIn > 0 || m.stats.bytesOut > 0;
  const showStats = m.status === 'listening' && (hasTraffic || m.stats.openConnections > 0);

  return (
    <div style={styles.row}>
      <span style={{ ...styles.statusDot, background: STATUS_COLOR[m.status] ?? 'var(--text-muted)' }} />
      <span style={styles.name} title={m.name || '(unnamed)'}>{m.name || <em style={{ color: 'var(--text-faint)' }}>(unnamed)</em>}</span>
      <span style={styles.route} title={`${m.sourceHost}:${m.sourcePort} → ${m.targetHost}:${m.targetPort}`}>
        {m.sourceHost}:{m.sourcePort} → {m.targetHost}:{m.targetPort}
      </span>
      {showStats && (
        <span style={styles.stats} title="Traffic since last start">
          {m.stats.openConnections > 0 && `● ${m.stats.openConnections} active  `}
          ↓{formatBytes(m.stats.bytesIn)} ↑{formatBytes(m.stats.bytesOut)}
        </span>
      )}
      <button
        style={{ ...styles.actionBtn, padding: '4px 10px', color: m.enabled ? 'var(--success)' : 'var(--text-muted)' }}
        onClick={onToggle}
        title={m.enabled ? 'Disable' : 'Enable'}
      >
        {m.enabled ? 'On' : 'Off'}
      </button>
      <button style={{ ...styles.actionBtn, color: 'var(--text-secondary)' }} onClick={onEdit} title="Edit mapping" aria-label="Edit mapping">
        ✎
      </button>
      <button
        style={confirming
          ? { ...styles.actionBtn, padding: '4px 10px', border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }
          : { ...styles.actionBtn, color: 'var(--danger)' }}
        onClick={handleDeleteClick}
        title={confirming ? 'Click again to confirm delete' : 'Delete mapping'}
        aria-label={confirming ? 'Confirm delete' : 'Delete mapping'}
      >
        {confirming ? 'Confirm?' : '×'}
      </button>
      {m.status === 'error' && m.error?.message && (
        <p style={styles.errorMsg}>{m.error.message}</p>
      )}
    </div>
  );
}

export function MappingList({ mappings, onToggle, onDelete, onEdit, onAdd }: Props): React.ReactElement {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Port Mappings</span>
        <button style={styles.addBtn} onClick={onAdd}>
          + Add Mapping
        </button>
      </div>
      {mappings.length === 0 ? (
        <p style={styles.empty}>No mappings yet. Click &ldquo;Add Mapping&rdquo; to get started.</p>
      ) : (
        mappings.map((m) => (
          <MappingRow
            key={m.id}
            mapping={m}
            onToggle={() => onToggle(m.id)}
            onDelete={() => onDelete(m.id)}
            onEdit={() => onEdit(m)}
          />
        ))
      )}
    </div>
  );
}
