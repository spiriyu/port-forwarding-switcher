import { describe, it, expect } from 'vitest';
import { version } from './index';

describe('proxy-core placeholder', () => {
  it('exports version', () => {
    expect(version).toBe('0.0.1');
  });
});
