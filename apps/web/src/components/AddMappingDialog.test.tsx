import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddMappingDialog } from './AddMappingDialog';
import type { MappingResponse } from '@portswitch/shared';

const sampleMapping: MappingResponse = {
  id: '01JVEDIT00000000000000001',
  name: 'web',
  sourceHost: '0.0.0.0',
  sourcePort: 8080,
  targetHost: 'localhost',
  targetPort: 3000,
  enabled: true,
  status: 'listening',
  stats: { openConnections: 0, totalConnections: 0, bytesIn: 0, bytesOut: 0 },
  createdAt: '',
  updatedAt: '',
};

describe('AddMappingDialog', () => {
  it('renders source and target inputs', () => {
    render(<AddMappingDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByPlaceholderText('8080')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('localhost:3000')).toBeInTheDocument();
  });

  it('shows validation error when submitted empty', () => {
    render(<AddMappingDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText(/valid source and target/i)).toBeInTheDocument();
  });

  it('shows validation error for out-of-range port', () => {
    const onConfirm = vi.fn();
    render(<AddMappingDialog onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('8080'), { target: { value: '70000' } });
    fireEvent.change(screen.getByPlaceholderText('localhost:3000'), { target: { value: 'localhost:3000' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/between 1 and 65535/i)).toBeInTheDocument();
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(<AddMappingDialog onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape pressed', () => {
    const onCancel = vi.fn();
    render(<AddMappingDialog onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onConfirm with parsed address when valid (no enabled field)', () => {
    const onConfirm = vi.fn();
    render(<AddMappingDialog onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('8080'), { target: { value: '8080' } });
    fireEvent.change(screen.getByPlaceholderText('localhost:3000'), { target: { value: 'localhost:3000' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      name: undefined,
      sourceHost: '127.0.0.1',
      sourcePort: 8080,
      targetHost: 'localhost',
      targetPort: 3000,
    });
  });

  it('includes name when provided', () => {
    const onConfirm = vi.fn();
    render(<AddMappingDialog onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. dev-api'), { target: { value: 'my-svc' } });
    fireEvent.change(screen.getByPlaceholderText('8080'), { target: { value: '9090' } });
    fireEvent.change(screen.getByPlaceholderText('localhost:3000'), { target: { value: '0.0.0.0:4000' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-svc', sourcePort: 9090, targetHost: '0.0.0.0', targetPort: 4000 }),
    );
  });

  it('calls onCancel when overlay clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(<AddMappingDialog onConfirm={vi.fn()} onCancel={onCancel} />);
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders in edit mode with prefilled values and Save button', () => {
    render(<AddMappingDialog initial={sampleMapping} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /edit mapping/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('web')).toBeInTheDocument();
    // Non-loopback source uses host:port form
    expect(screen.getByDisplayValue('0.0.0.0:8080')).toBeInTheDocument();
    expect(screen.getByDisplayValue('localhost:3000')).toBeInTheDocument();
  });

  it('emits edited values from Save', () => {
    const onConfirm = vi.fn();
    render(<AddMappingDialog initial={sampleMapping} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('localhost:3000'), { target: { value: 'localhost:4444' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ targetHost: 'localhost', targetPort: 4444 }),
    );
  });

  it('Enter key submits the form', () => {
    const onConfirm = vi.fn();
    const { container } = render(<AddMappingDialog onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('8080'), { target: { value: '8080' } });
    fireEvent.change(screen.getByPlaceholderText('localhost:3000'), { target: { value: 'localhost:3000' } });
    const form = container.querySelector('form');
    if (!form) throw new Error('form not found');
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalled();
  });
});
