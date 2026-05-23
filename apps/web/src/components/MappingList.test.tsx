import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MappingList } from './MappingList';
import type { MappingResponse } from '@portswitch/shared';
import { ErrorCode } from '@portswitch/shared';

const mapping: MappingResponse = {
  id: '01JVTEST00000000000000001',
  name: 'dev-api',
  sourceHost: '127.0.0.1',
  sourcePort: 8080,
  targetHost: 'localhost',
  targetPort: 3000,
  enabled: true,
  status: 'listening',
  stats: { openConnections: 0, totalConnections: 0, bytesIn: 0, bytesOut: 0 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const noop = { onToggle: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onAdd: vi.fn() };

describe('MappingList', () => {
  it('shows empty state when no mappings', () => {
    render(<MappingList mappings={[]} {...noop} />);
    expect(screen.getByText(/no mappings yet/i)).toBeInTheDocument();
  });

  it('shows Add Mapping button', () => {
    render(<MappingList mappings={[]} {...noop} />);
    expect(screen.getByRole('button', { name: /add mapping/i })).toBeInTheDocument();
  });

  it('calls onAdd when Add Mapping clicked', () => {
    const onAdd = vi.fn();
    render(<MappingList mappings={[]} {...{ ...noop, onAdd }} />);
    fireEvent.click(screen.getByRole('button', { name: /add mapping/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('renders mapping rows', () => {
    render(<MappingList mappings={[mapping]} {...noop} />);
    expect(screen.getByTitle('dev-api')).toBeInTheDocument();
    expect(screen.getByText(/8080.*3000/)).toBeInTheDocument();
  });

  it('calls onToggle with correct id', () => {
    const onToggle = vi.fn();
    render(<MappingList mappings={[mapping]} {...{ ...noop, onToggle }} />);
    fireEvent.click(screen.getByTitle('Disable'));
    expect(onToggle).toHaveBeenCalledWith(mapping.id);
  });

  it('calls onEdit with the full mapping when pencil clicked', () => {
    const onEdit = vi.fn();
    render(<MappingList mappings={[mapping]} {...{ ...noop, onEdit }} />);
    fireEvent.click(screen.getByLabelText('Edit mapping'));
    expect(onEdit).toHaveBeenCalledWith(mapping);
  });

  it('requires two clicks to delete (confirmation step)', () => {
    const onDelete = vi.fn();
    render(<MappingList mappings={[mapping]} {...{ ...noop, onDelete }} />);

    fireEvent.click(screen.getByLabelText('Delete mapping'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Confirm delete')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm delete'));
    expect(onDelete).toHaveBeenCalledWith(mapping.id);
  });

  it('resets delete confirmation after 3s', () => {
    vi.useFakeTimers();
    try {
      render(<MappingList mappings={[mapping]} {...noop} />);
      fireEvent.click(screen.getByLabelText('Delete mapping'));
      expect(screen.getByLabelText('Confirm delete')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.getByLabelText('Delete mapping')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows Off toggle for disabled mapping', () => {
    const disabled: MappingResponse = { ...mapping, enabled: false, status: 'disabled' };
    render(<MappingList mappings={[disabled]} {...noop} />);
    expect(screen.getByTitle('Enable')).toBeInTheDocument();
  });

  it('renders inline error message when status is error', () => {
    const errMapping: MappingResponse = {
      ...mapping,
      status: 'error',
      error: { code: ErrorCode.EACCES_PRIVILEGED_PORT, message: 'Port 80 requires elevated privileges.' },
    };
    render(<MappingList mappings={[errMapping]} {...noop} />);
    expect(screen.getByText(/Port 80 requires elevated privileges/)).toBeInTheDocument();
  });

  it('renders traffic stats when listening with activity', () => {
    const busy: MappingResponse = {
      ...mapping,
      stats: { openConnections: 2, totalConnections: 5, bytesIn: 2048, bytesOut: 512 },
    };
    render(<MappingList mappings={[busy]} {...noop} />);
    expect(screen.getByText(/2 active/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0KB/)).toBeInTheDocument();
    expect(screen.getByText(/512B/)).toBeInTheDocument();
  });

  it('hides stats for idle listening mappings', () => {
    render(<MappingList mappings={[mapping]} {...noop} />);
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
  });
});
