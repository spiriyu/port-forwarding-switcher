import React, { useEffect, useState } from 'react';
import type { GroupResponse, MappingResponse } from '@portswitch/shared';

const STATUS_COLOR: Record<string, string> = {
  listening: 'var(--success)',
  disabled: 'var(--text-muted)',
  error: 'var(--danger)',
};

const styles: Record<string, React.CSSProperties> = {
  group: {
    marginBottom: '16px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: 'var(--bg-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
  },
  chevron: { fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 },
  groupName: { fontSize: '14px', fontWeight: 600, flex: 1 },
  badge: {
    fontSize: '11px',
    color: 'var(--text-faint)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '1px 7px',
    flexShrink: 0,
  },
  activeBadge: {
    fontSize: '11px',
    color: 'var(--success)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--success)',
    borderRadius: '10px',
    padding: '1px 7px',
    flexShrink: 0,
  },
  actionBtn: {
    padding: '3px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    background: 'transparent',
    flexShrink: 0,
  },
  body: { padding: '8px 12px 12px 12px', background: 'var(--bg-primary)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 10px',
    background: 'var(--bg-secondary)',
    borderRadius: '6px',
    marginBottom: '6px',
    border: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  statusDot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  name: {
    fontSize: '13px', fontWeight: 500, flex: '1 1 100px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  route: {
    fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace',
    flex: '2 1 180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  errorMsg: { flexBasis: '100%', fontSize: '12px', color: 'var(--danger)', margin: 0, paddingLeft: '20px' },
  addBtn: {
    marginTop: '6px', width: '100%',
    padding: '5px 0',
    background: 'transparent',
    border: '1px dashed var(--border-strong)',
    borderRadius: '6px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
  },
  emptyMsg: { fontSize: '13px', color: 'var(--text-faint)', textAlign: 'center', padding: '12px 0' },
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
};

interface MappingRowProps {
  mapping: MappingResponse;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function MappingRow({ mapping: m, onToggle, onDelete, onEdit }: MappingRowProps): React.ReactElement {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const handleDeleteClick = (): void => {
    if (confirming) { setConfirming(false); onDelete(); }
    else setConfirming(true);
  };

  return (
    <div style={styles.row}>
      <span style={{ ...styles.statusDot, background: STATUS_COLOR[m.status] ?? 'var(--text-muted)' }} />
      <span style={styles.name} title={m.name || '(unnamed)'}>{m.name || <em style={{ color: 'var(--text-faint)' }}>(unnamed)</em>}</span>
      <span style={styles.route} title={`${m.sourceHost}:${m.sourcePort} → ${m.targetHost}:${m.targetPort}`}>
        {m.sourceHost}:{m.sourcePort} → {m.targetHost}:{m.targetPort}
      </span>
      <button
        style={{ ...styles.actionBtn, padding: '3px 8px', color: m.enabled ? 'var(--success)' : 'var(--text-muted)' }}
        onClick={onToggle} title={m.enabled ? 'Disable' : 'Enable'}
      >
        {m.enabled ? 'On' : 'Off'}
      </button>
      <button style={{ ...styles.actionBtn, color: 'var(--text-secondary)' }} onClick={onEdit} aria-label="Edit mapping">✎</button>
      <button
        style={confirming
          ? { ...styles.actionBtn, padding: '3px 8px', border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }
          : { ...styles.actionBtn, color: 'var(--danger)' }}
        onClick={handleDeleteClick}
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

export function GroupSection({
  group, mappings,
  onEnable, onDisable,
  onToggleMapping, onDeleteMapping, onEditMapping, onAddMapping,
  onDeleteGroup, onRename, onDuplicate,
}: GroupSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const isActive = group.activeCount > 0;

  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  const handleGroupDelete = (): void => {
    if (confirmingDelete) { setConfirmingDelete(false); onDeleteGroup(); }
    else setConfirmingDelete(true);
  };

  return (
    <div style={styles.group}>
      <div style={styles.header} onClick={() => setExpanded((e) => !e)}>
        <span style={styles.chevron}>{expanded ? '▼' : '▶'}</span>
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
        {isActive
          ? <span style={styles.activeBadge}>{group.activeCount}/{group.mappingCount} active</span>
          : <span style={styles.badge}>{group.mappingCount} mapping{group.mappingCount !== 1 ? 's' : ''}</span>
        }
        <button
          style={{ ...styles.actionBtn, color: isActive ? 'var(--text-muted)' : 'var(--success)' }}
          onClick={(e) => { e.stopPropagation(); isActive ? onDisable() : onEnable(); }}
          title={isActive ? 'Disable group' : 'Enable group'}
        >
          {isActive ? 'Disable all' : 'Enable all'}
        </button>
        <button
          style={{ ...styles.actionBtn, color: 'var(--text-secondary)' }}
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          title="Duplicate group"
          aria-label="Duplicate group"
        >
          ⧉
        </button>
        <button
          style={confirmingDelete
            ? { ...styles.actionBtn, border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)', padding: '3px 8px' }
            : { ...styles.actionBtn, color: 'var(--danger)' }}
          onClick={(e) => { e.stopPropagation(); handleGroupDelete(); }}
          aria-label={confirmingDelete ? 'Confirm delete group' : 'Delete group'}
          title={confirmingDelete ? 'Click again to confirm' : 'Delete group and all its mappings'}
        >
          {confirmingDelete ? 'Confirm?' : '×'}
        </button>
      </div>
      {expanded && (
        <div style={styles.body}>
          {mappings.length === 0 && (
            <p style={styles.emptyMsg}>No mappings in this group.</p>
          )}
          {mappings.map((m) => (
            <MappingRow
              key={m.id}
              mapping={m}
              onToggle={() => onToggleMapping(m.id)}
              onDelete={() => onDeleteMapping(m.id)}
              onEdit={() => onEditMapping(m)}
            />
          ))}
          <button style={styles.addBtn} onClick={(e) => { e.stopPropagation(); onAddMapping(); }}>
            + Add Mapping
          </button>
        </div>
      )}
    </div>
  );
}
