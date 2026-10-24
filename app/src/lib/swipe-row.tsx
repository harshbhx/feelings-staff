/**
 * iOS swipe action for a list row (iOS layer). Swipe the row left to uncover one action button at
 * its trailing edge; tap it, or tap the row or swipe right to close. A shortcut only: every action
 * here is also reachable another way on the same screen, so the button stays out of the tab order
 * and the accessibility tree until the row is open. Touch only; vertical scrolling is untouched
 * (`touch-action: pan-y`); with reduced motion the row snaps instead of sliding.
 */
import { type ReactNode, useRef, useState } from 'react';

const WIDTH = 96;

export interface SwipeAction {
  label: string;
  onPress: () => void;
}

export function SwipeRow({
  action,
  className = '',
  children,
}: {
  action?: SwipeAction | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null } | null>(null);
  if (!action) return <li className={className}>{children}</li>;
  const open = x !== 0;
  return (
    <li className={`relative overflow-hidden ${className}`}>
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-hidden={open ? undefined : true}
        onClick={() => {
          action.onPress();
          setX(0);
        }}
        className="absolute inset-y-0 right-0 w-24 bg-accent-fill px-2 font-semibold text-[length:var(--text-sm)] text-white active:bg-sindoor-700"
      >
        {action.label}
      </button>
      <div
        className={`relative touch-pan-y bg-bg ${dragging ? '' : 'transition-transform duration-(--dur-base) ease-(--ease-out) motion-reduce:transition-none'}`}
        style={{ transform: `translateX(${x}px)` }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) drag.current = { x: t.clientX, y: t.clientY, base: x, axis: null };
        }}
        onTouchMove={(e) => {
          const d = drag.current;
          const t = e.touches[0];
          if (!d || !t) return;
          const dx = t.clientX - d.x;
          const dy = t.clientY - d.y;
          if (d.axis === null && Math.abs(dx) + Math.abs(dy) > 8)
            d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (d.axis !== 'x') return;
          setDragging(true);
          setX(Math.max(-WIDTH * 1.25, Math.min(0, d.base + dx)));
        }}
        onTouchEnd={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (d?.axis === 'x') setX((v) => (v < -WIDTH / 2 ? -WIDTH : 0));
        }}
        onClickCapture={(e) => {
          if (!open) return;
          e.preventDefault();
          e.stopPropagation();
          setX(0);
        }}
      >
        {children}
      </div>
    </li>
  );
}
