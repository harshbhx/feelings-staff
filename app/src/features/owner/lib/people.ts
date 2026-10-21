/**
 * People colour (UI redesign Fix 1 and 5, PRD 12.6 as amended): each staff role maps to one of the
 * salon's five service tones, so twelve rows no longer look the same. Helpers, receptionists and
 * "Other" are ink. A free-text or missing designation is ink too.
 */
import type { Designation } from '@fs/contracts';
import type { AvatarTone } from '@fs/ui';

const TONE: Record<Designation, AvatarTone> = {
  Stylist: 'salon',
  Beautician: 'salon',
  'Makeup artist': 'makeup',
  'Mehndi artist': 'mehndi',
  'Nail technician': 'nails',
  Trainer: 'trainee',
  Trainee: 'trainee',
  Receptionist: 'neutral',
  Helper: 'neutral',
  Other: 'neutral',
};

export function roleTone(designation: string | null | undefined): AvatarTone {
  if (!designation) return 'neutral';
  return (TONE as Record<string, AvatarTone | undefined>)[designation] ?? 'neutral';
}
