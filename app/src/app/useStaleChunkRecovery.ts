import { useEffect } from 'react';

declare global {
  interface Window {
    /** public/recover.js */
    __fsRecover?: (error?: unknown) => boolean;
  }
}

/** A chunk-load failure reloads once by itself (the guard lives in public/recover.js). */
export function useStaleChunkRecovery(error: unknown): void {
  useEffect(() => {
    window.__fsRecover?.(error);
  }, [error]);
}
