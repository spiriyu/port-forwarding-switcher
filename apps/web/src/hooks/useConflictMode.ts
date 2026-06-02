import { useEffect, useState } from 'react';

export type ConflictMode = 'validate' | 'auto';

const STORAGE_KEY = 'portswitch.conflictMode';

export function useConflictMode(): [ConflictMode, (m: ConflictMode) => void] {
  const [mode, setMode] = useState<ConflictMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'auto' ? 'auto' : 'validate';
    } catch {
      return 'validate';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage unavailable — silently ignore
    }
  }, [mode]);

  return [mode, setMode];
}
