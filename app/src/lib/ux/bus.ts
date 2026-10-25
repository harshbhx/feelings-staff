/** Lets a row in More or Me ask the guidance layer to replay the tour. */
const EVENT = 'fs:guide';

export function openGuide(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onGuide(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
