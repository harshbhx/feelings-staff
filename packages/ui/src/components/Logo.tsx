import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { Bindi } from './Bindi';

export interface LogoProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The salon's name: the logo's accessible name, and the typeset wordmark until `mask` is set. */
  name: string;
  /** `sm` 20 px (staff header), `md` 24 px (owner phone header, More), `lg` 28 px (desktop rail). */
  size?: 'sm' | 'md' | 'lg' | undefined;
  /**
   * URL of the client's wordmark, drawn as a CSS mask in `--logo` (the website's technique, one file
   * for every colour). Without it the name is set in Plus Jakarta Sans 800 in `--logo` with the
   * bindi as its full stop: the fallback while the client confirms the recoloured wordmark.
   */
  mask?: string | undefined;
}

/** The salon's logo in the shell (PRD 12.5, 12.9 as amended). One image for assistive tech. */
export function Logo({ name, size = 'md', mask, className, style, ...rest }: LogoProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cx('fs-logo', className)}
      data-size={size}
      data-mask={mask ? '' : undefined}
      style={mask ? ({ ...style, '--logo-mask': `url("${mask}")` } as CSSProperties) : style}
      {...rest}
    >
      {name}
      <Bindi />
    </span>
  );
}
