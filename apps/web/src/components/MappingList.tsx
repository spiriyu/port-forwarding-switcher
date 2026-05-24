import React from 'react';
import type { GroupResponse, MappingResponse } from '@portswitch/shared';
import { GroupSection } from './GroupSection';

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

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '16px', flex: 1, overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { fontSize: '16px', fontWeight: 600 },
  addBtn: {
    padding: '6px 14px', background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
  },
  empty: { color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', paddingTop: '40px' },
};

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
