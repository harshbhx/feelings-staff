import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';

/**
 * People colour (PRD 12.6 as amended): the role's service tone, `--role-*` on its `-bg` tint.
 * Stylist and beautician `salon`, makeup artist `makeup`, nail technician `nails`, mehndi artist
 * `mehndi`, trainee and trainer `trainee`, helper, receptionist and other `neutral`.
 */
export type AvatarTone = 'makeup' | 'nails' | 'mehndi' | 'salon' | 'trainee' | 'neutral';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The person's name; the avatar shows its initials. */
  name: string;
  /** The role tone. Without it the avatar is maroon on blush (the owner's own, people without a role). */
  tone?: AvatarTone | undefined;
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

/** Initials in 700 on the role's tint, or maroon on blush. No photos (PRD 12.6). */
export function Avatar({
  name,
  size = 'md',
  tone,
  labelled = false,
  className,
  ...rest
}: AvatarProps) {
  return (
    <span
      className={cx('fs-avatar', className)}
      data-size={size}
      data-tone={tone}
      {...(labelled ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      {...rest}
    >
      {initials(name)}
    </span>
  );
}
