import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The person's name; the avatar shows its initials. */
  name: string;
  /** `sm` 32 px, `md` 40 px (default), `lg` 56 px. */
  size?: 'sm' | 'md' | 'lg' | undefined;
  /**
   * Read the name out. Off by default: the name is almost always written next to the avatar,
   * so reading it twice is noise.
   */
  labelled?: boolean | undefined;
}

/** First letters of the first and last word ("Priya Shah" -> "PS"; "Neha" -> "N"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Initials in 700 on blush with maroon text. No photos (PRD 12.6). */
export function Avatar({ name, size = 'md', labelled = false, className, ...rest }: AvatarProps) {
  return (
    <span
      className={cx('fs-avatar', className)}
      data-size={size}
      {...(labelled ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      {...rest}
    >
      {initials(name)}
    </span>
  );
}
