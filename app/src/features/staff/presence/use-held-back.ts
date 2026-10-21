import { useEffect, useState } from 'react';

/**
 * True while `blocked` is true and for `ms` after it turns false. A sheet that closes keeps its
 * node for the exit animation (140 ms), so a second sheet that opens the moment the first one
 * closes would put two dialogs on the page together. Never held back before the first block.
 */
export function useHeldBack(blocked: boolean, ms: number): boolean {
  const [holding, setHolding] = useState(blocked);
  useEffect(() => {
    if (blocked) {
      setHolding(true);
      return;
    }
    const id = setTimeout(() => setHolding(false), ms);
    return () => clearTimeout(id);
  }, [blocked, ms]);
  return blocked || holding;
}
