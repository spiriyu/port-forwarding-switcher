import React, { useEffect, useRef, useState } from 'react';
import type { MappingResponse } from '@portswitch/shared';

export interface MappingDialogValues {
  name?: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  groupId: string;
}

interface Props {
  groupId: string;
  initial?: MappingResponse;
  onConfirm: (values: MappingDialogValues) => void;
  onCancel: () => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const dialog: React.CSSProperties = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px',
  padding: '24px', minWidth: '360px', display: 'flex', flexDirection: 'column', gap: '16px',
  color: 'var(--text-primary)',
};
const label: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '4px',
  fontSize: '13px', color: 'var(--text-secondary)',
};
const input: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border-strong)', borderRadius: '4px',
  color: 'var(--text-primary)', padding: '6px 10px', fontSize: '14px',
  outline: 'none',
};
const row: React.CSSProperties = { display: 'flex', gap: '8px', justifyContent: 'flex-end' };
const btnPrimary: React.CSSProperties = {
  padding: '7px 18px', background: 'var(--accent)', color: '#fff',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};
const btnSecondary: React.CSSProperties = {
  padding: '7px 18px', background: 'transparent', color: 'var(--text-muted)',
  border: '1px solid var(--border-strong)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};

function formatAddress(host: string, port: number): string {
  return host === '127.0.0.1' ? String(port) : `${host}:${port}`;
}

function parseAddress(raw: string): { host: string; port: number } {
  const colon = raw.lastIndexOf(':');
  if (colon === -1) return { host: '127.0.0.1', port: Number(raw) };
  return { host: raw.slice(0, colon), port: Number(raw.slice(colon + 1)) };
}

export function AddMappingDialog({ groupId, initial, onConfirm, onCancel }: Props): React.ReactElement {
  const isEdit = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [source, setSource] = useState(
    initial ? formatAddress(initial.sourceHost, initial.sourcePort) : '',
  );
  const [target, setTarget] = useState(
    initial ? `${initial.targetHost}:${initial.targetPort}` : '',
  );
  const [error, setError] = useState('');
  const sourceRef = useRef<HTMLInputElement>(null);

  useEffect(() => { sourceRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const src = parseAddress(source.trim());
    const tgt = parseAddress(target.trim());
    if (!source.trim() || !target.trim() || isNaN(src.port) || isNaN(tgt.port)) {
      setError('Enter valid source and target (e.g. 8080 or 0.0.0.0:8080)');
      return;
    }
    if (src.port < 1 || src.port > 65535 || tgt.port < 1 || tgt.port > 65535) {
      setError('Port must be between 1 and 65535');
      return;
    }
    onConfirm({
      name: name.trim() || undefined,
      sourceHost: src.host,
      sourcePort: src.port,
      targetHost: tgt.host,
      targetPort: tgt.port,
      groupId,
    });
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form style={dialog} onSubmit={handleSubmit}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
          {isEdit ? 'Edit Mapping' : 'Add Mapping'}
        </h2>
        <label style={label}>
          Name (optional)
          <input
            style={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. dev-api"
          />
        </label>
        <label style={label}>
          Source port or host:port
          <input
            ref={sourceRef}
            style={input}
            value={source}
            onChange={(e) => { setSource(e.target.value); setError(''); }}
            placeholder="8080"
          />
        </label>
        <label style={label}>
          Target host:port
          <input
            style={input}
            value={target}
            onChange={(e) => { setTarget(e.target.value); setError(''); }}
            placeholder="localhost:3000"
          />
        </label>
        {error && <p style={{ color: 'var(--danger)', fontSize: '12px', margin: 0 }}>{error}</p>}
        <div style={row}>
          <button type="button" style={btnSecondary} onClick={onCancel}>Cancel</button>
          <button type="submit" style={btnPrimary}>{isEdit ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </div>
  );
}
