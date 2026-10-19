/** A QR code drawn as one SVG path in ink (currentColor), from `uqr` (PRD 4.2 desktop). */
import { useMemo } from 'react';
import { encode } from 'uqr';

export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { d, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let path = '';
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) path += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d: path, size: qr.size };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className={className}
      shapeRendering="crispEdges"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
