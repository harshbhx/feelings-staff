/** Lets a row in More or Me ask the guidance layer to open a guide on demand. */
export type GuideKind = 'tour' | 'install';

const EVENT = 'fs:guide';

export function openGuide(kind: GuideKind): void {
  window.dispatchEvent(new CustomEvent<GuideKind>(EVENT, { detail: kind }));
}

export function onGuide(cb: (kind: GuideKind) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<GuideKind>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
