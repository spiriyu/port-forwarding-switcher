import React, { useEffect } from 'react';
import type { GroupResponse, MappingResponse } from '@portswitch/shared';

interface Props {
  conflictingMappings: MappingResponse[];
  groups: GroupResponse[];
  onConfirm: () => void;
  onCancel: () => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const dialog: React.CSSProperties = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px',
  padding: '24px', minWidth: '360px', maxWidth: '480px', width: '90%',
  display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--text-primary)',
};
const portBadge: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
  borderRadius: '3px', padding: '1px 6px',
  fontFamily: 'ui-monospace, monospace', fontSize: '12px',
  color: 'var(--text-primary)',
};
const btnPrimary: React.CSSProperties = {
  padding: '7px 18px', background: 'var(--accent)', color: '#fff',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};
const btnSecondary: React.CSSProperties = {
  padding: '7px 18px', background: 'transparent', color: 'var(--text-muted)',
  border: '1px solid var(--border-strong)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};

export function ConflictModal({ conflictingMappings, groups, onConfirm, onCancel }: Props): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const groupName = (groupId: string): string =>
    groups.find((g) => g.id === groupId)?.name ?? groupId;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Port conflict detected</h2>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
          The following active mappings use the same source port and will be disabled:
        </p>
        <ul style={{ margin: 0, padding: '0 0 0 4px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {conflictingMappings.map((m) => (
            <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ color: m.name ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: m.name ? 'normal' : 'italic' }}>
                {m.name || '(unnamed)'}
              </span>
              <code style={portBadge}>{m.sourceHost === '127.0.0.1' ? m.sourcePort : `${m.sourceHost}:${m.sourcePort}`}</code>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>in {groupName(m.groupId)}</span>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={btnPrimary} onClick={onConfirm}>Disable conflicts &amp; enable</button>
        </div>
      </div>
    </div>
  );
}
