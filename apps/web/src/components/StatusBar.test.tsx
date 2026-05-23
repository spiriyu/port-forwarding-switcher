import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatusBar, formatDuration } from './StatusBar';
import type { HealthResponse } from '@portswitch/shared';

const health: HealthResponse = {
  status: 'ok',
  version: '0.2.0',
  uptimeMs: 90_000,
};

describe('StatusBar', () => {
  it('shows connecting state while loading', () => {
    render(<StatusBar health={null} loading={true} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('shows unreachable state when health is null and not loading', () => {
    render(<StatusBar health={null} loading={false} />);
    expect(screen.getByText(/daemon unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/portswitch service start/i)).toBeInTheDocument();
  });

  it('shows version and humanized uptime when healthy', () => {
    render(<StatusBar health={health} loading={false} />);
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/1m/)).toBeInTheDocument();
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(59_000)).toBe('59s');
  });
  it('formats minutes', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(59 * 60_000)).toBe('59m');
  });
  it('formats hours and minutes', () => {
    expect(formatDuration(2 * 3600_000)).toBe('2h 0m');
    expect(formatDuration(2 * 3600_000 + 4 * 60_000)).toBe('2h 4m');
  });
  it('formats days and hours', () => {
    expect(formatDuration(3 * 86_400_000 + 5 * 3_600_000)).toBe('3d 5h');
  });
});
