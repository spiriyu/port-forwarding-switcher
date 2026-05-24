import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MappingList } from './MappingList';
import type { GroupResponse, MappingResponse } from '@portswitch/shared';
import { ErrorCode } from '@portswitch/shared';

const group: GroupResponse = {
  id: 'GRP01',
  name: 'Default',
  mappingCount: 1,
  activeCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mapping: MappingResponse = {
  id: '01JVTEST00000000000000001',
  groupId: 'GRP01',
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

const noop = {
  onEnableGroup: vi.fn(),
  onDisableGroup: vi.fn(),
  onToggleMapping: vi.fn(),
  onDeleteMapping: vi.fn(),
  onEditMapping: vi.fn(),
  onAddMapping: vi.fn(),
  onDeleteGroup: vi.fn(),
  onAddGroup: vi.fn(),
};

describe('MappingList', () => {
  it('shows empty state when no groups', () => {
    render(<MappingList groups={[]} mappings={[]} {...noop} />);
    expect(screen.getByText(/no groups yet/i)).toBeInTheDocument();
  });

  it('shows Add Group button', () => {
    render(<MappingList groups={[]} mappings={[]} {...noop} />);
    expect(screen.getByRole('button', { name: /add group/i })).toBeInTheDocument();
  });

  it('calls onAddGroup when Add Group clicked', () => {
    const onAddGroup = vi.fn();
    render(<MappingList groups={[]} mappings={[]} {...{ ...noop, onAddGroup }} />);
    fireEvent.click(screen.getByRole('button', { name: /add group/i }));
    expect(onAddGroup).toHaveBeenCalledOnce();
  });

  it('renders group section with mapping rows', () => {
    render(<MappingList groups={[group]} mappings={[mapping]} {...noop} />);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByTitle('dev-api')).toBeInTheDocument();
    expect(screen.getByText(/8080.*3000/)).toBeInTheDocument();
  });

  it('calls onToggleMapping with correct id', () => {
    const onToggleMapping = vi.fn();
    render(<MappingList groups={[group]} mappings={[mapping]} {...{ ...noop, onToggleMapping }} />);
    fireEvent.click(screen.getByTitle('Disable'));
    expect(onToggleMapping).toHaveBeenCalledWith(mapping.id);
  });

  it('calls onEditMapping with the full mapping when pencil clicked', () => {
    const onEditMapping = vi.fn();
    render(<MappingList groups={[group]} mappings={[mapping]} {...{ ...noop, onEditMapping }} />);
    fireEvent.click(screen.getByLabelText('Edit mapping'));
    expect(onEditMapping).toHaveBeenCalledWith(mapping);
  });

  it('requires two clicks to delete mapping (confirmation step)', () => {
    const onDeleteMapping = vi.fn();
    render(<MappingList groups={[group]} mappings={[mapping]} {...{ ...noop, onDeleteMapping }} />);

    fireEvent.click(screen.getByLabelText('Delete mapping'));
    expect(onDeleteMapping).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Confirm delete')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm delete'));
    expect(onDeleteMapping).toHaveBeenCalledWith(mapping.id);
  });

  it('resets delete confirmation after 3s', () => {
    vi.useFakeTimers();
    try {
      render(<MappingList groups={[group]} mappings={[mapping]} {...noop} />);
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
    const disabledGroup: GroupResponse = { ...group, activeCount: 0 };
    render(<MappingList groups={[disabledGroup]} mappings={[disabled]} {...noop} />);
    expect(screen.getByTitle('Enable')).toBeInTheDocument();
  });

  it('renders inline error message when status is error', () => {
    const errMapping: MappingResponse = {
      ...mapping,
      status: 'error',
      error: { code: ErrorCode.EACCES_PRIVILEGED_PORT, message: 'Port 80 requires elevated privileges.' },
    };
    render(<MappingList groups={[group]} mappings={[errMapping]} {...noop} />);
    expect(screen.getByText(/Port 80 requires elevated privileges/)).toBeInTheDocument();
  });

  it('shows active badge when group has active mappings', () => {
    const activeGroup: GroupResponse = { ...group, activeCount: 1, mappingCount: 1 };
    render(<MappingList groups={[activeGroup]} mappings={[mapping]} {...noop} />);
    expect(screen.getByText(/1\/1 active/)).toBeInTheDocument();
  });

  it('shows mapping count badge when group has no active mappings', () => {
    const inactiveGroup: GroupResponse = { ...group, activeCount: 0, mappingCount: 1 };
    const disabled: MappingResponse = { ...mapping, enabled: false, status: 'disabled' };
    render(<MappingList groups={[inactiveGroup]} mappings={[disabled]} {...noop} />);
    expect(screen.getByText(/1 mapping/)).toBeInTheDocument();
  });
});
