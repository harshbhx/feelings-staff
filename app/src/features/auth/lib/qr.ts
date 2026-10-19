/** QR of the invite link for the desktop case (PRD 4.1.3 step 5), drawn as one SVG path. */
import { encode } from 'uqr';

export interface QrPath {
  /** Modules per side, quiet zone included. */
  size: number;
  /** Path of the dark modules, one unit per module. */
  d: string;
}

export function qrPath(text: string): QrPath {
  const { data } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return { size: data.length, d };
}
