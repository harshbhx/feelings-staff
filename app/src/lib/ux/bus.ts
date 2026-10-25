/**
 * Lets a row in More or Me ask the guidance layer to replay the tour. The layer mounts a moment
 * after the shell, so a request made before it is listening is kept and delivered when it is.
 */
const EVENT = 'fs:guide';
let listening = 0;
let pending = false;

export function openGuide(): void {
  if (listening === 0) pending = true;
  else window.dispatchEvent(new CustomEvent(EVENT));
}

export function onGuide(cb: () => void): () => void {
  listening += 1;
  window.addEventListener(EVENT, cb);
  if (pending) {
    pending = false;
    cb();
  }
  return () => {
    listening -= 1;
    window.removeEventListener(EVENT, cb);
  };
}
