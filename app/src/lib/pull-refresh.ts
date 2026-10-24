/**
 * Pull to refresh (iOS layer). At the top of a screen, a downward drag shows the ring under the
 * navigation bar, filling as it goes; let go past the mark and every query on screen refetches
 * (the same reads the screen already makes, nothing is written). The shells import this lazily
 * after the first paint, so it is not in the staff initial chunk. Touch only; never while a sheet
 * or dialog is open; with reduced motion the ring fades instead of turning. Returns a detach.
 */
const PULL = 72;
const MAX = 110;

export function attachPullRefresh(refresh: () => Promise<unknown>, label: string): () => void {
  const ring = document.createElement('div');
  ring.className = 'fs-ptr';
  ring.setAttribute('role', 'status');
  ring.innerHTML =
    '<span class="fs-ptr__ring" aria-hidden="true"></span><span class="sr-only"></span>';
  document.body.append(ring);
  const live = ring.lastElementChild as HTMLElement;

  let startY: number | null = null;
  let pull = 0;
  let busy = false;

  const show = (p: number) => {
    ring.style.setProperty('--ptr', String(Math.min(1, p / PULL)));
    ring.toggleAttribute('data-armed', p >= PULL);
  };
  const reset = () => {
    startY = null;
    pull = 0;
    show(0);
  };

  const onStart = (e: TouchEvent) => {
    if (busy || e.touches.length !== 1 || window.scrollY > 0) return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    startY = e.touches[0]?.clientY ?? null;
  };
  const onMove = (e: TouchEvent) => {
    if (startY === null) return;
    const dy = (e.touches[0]?.clientY ?? startY) - startY;
    if (dy <= 0 || window.scrollY > 0) {
      if (pull > 0) reset();
      return;
    }
    // Resistance, like the system: the ring follows less the further it goes.
    pull = Math.min(MAX, dy * 0.55);
    show(pull);
  };
  const onEnd = () => {
    if (startY === null) return;
    const go = pull >= PULL;
    startY = null;
    if (!go) return reset();
    busy = true;
    ring.setAttribute('data-busy', '');
    live.textContent = label;
    const done = () => {
      busy = false;
      ring.removeAttribute('data-busy');
      live.textContent = '';
      reset();
    };
    const min = new Promise((r) => setTimeout(r, 450));
    void Promise.allSettled([refresh(), min]).then(done);
  };

  const opts = { passive: true } as const;
  window.addEventListener('touchstart', onStart, opts);
  window.addEventListener('touchmove', onMove, opts);
  window.addEventListener('touchend', onEnd, opts);
  window.addEventListener('touchcancel', reset, opts);
  return () => {
    window.removeEventListener('touchstart', onStart);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', reset);
    ring.remove();
  };
}
