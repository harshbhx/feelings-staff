import { z } from 'zod';

/** ULID: 26 Crockford base32 characters, time-sortable (PRD 8.1). */
export const Id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Expected a ULID');
export type Id = z.infer<typeof Id>;

/** IST calendar date, `YYYY-MM-DD` (PRD 7.2). */
export const WorkDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Expected YYYY-MM-DD');
export type WorkDate = z.infer<typeof WorkDate>;

/** Calendar month, `YYYY-MM`. */
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export type YearMonth = z.infer<typeof YearMonth>;

/** ISO week, `YYYY-Www` (Monday to Sunday). */
export const IsoWeek = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, 'Expected YYYY-Www');
export type IsoWeek = z.infer<typeof IsoWeek>;

/** Wall-clock time in IST, `HH:MM` 24 h. */
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export type HHMM = z.infer<typeof HHMM>;

/** UTC epoch milliseconds. */
export const EpochMs = z.number().int().nonnegative();
export type EpochMs = z.infer<typeof EpochMs>;

/** Money in integer paise (Rs 1 = 100 paise). */
export const Paise = z.number().int();
export type Paise = z.infer<typeof Paise>;

/** Money that must be positive. */
export const PositivePaise = z.number().int().positive();

/** Whole minutes. */
export const Minutes = z.number().int();
export type Minutes = z.infer<typeof Minutes>;

/** Day counts that may be halves (0.5 steps). */
export const HalfDays = z
  .number()
  .refine((n) => Number.isInteger(n * 2), 'Must be a multiple of 0.5');
export type HalfDays = z.infer<typeof HalfDays>;

/** Indian mobile number in E.164 (`+91` and 10 digits starting 6-9). */
export const PhoneE164 = z.string().regex(/^\+91[6-9]\d{9}$/, 'Expected an Indian mobile number');
export type PhoneE164 = z.infer<typeof PhoneE164>;

/** Phone as typed by a person; the server normalises it (see util/phone.ts). */
export const PhoneInput = z.string().min(10).max(20);

export const Email = z.email().max(254);

export const Lang = z.enum(['en', 'gu']);
export type Lang = z.infer<typeof Lang>;

/** 4-6 digit PIN. Strength rules are enforced by the server (PRD 4.1.4). */
export const Pin = z.string().regex(/^\d{4,6}$/, 'PIN is 4 to 6 digits');

/** 6-digit owner PIN. */
export const OwnerPin = z.string().regex(/^\d{6}$/, 'Owner PIN is 6 digits');

/** Join code: 8 Crockford base32 chars; accepted with or without the dash, any case. */
export const JoinCodeInput = z.string().min(8).max(12);

/** base64url string. */
export const Base64Url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'Expected base64url');

/** Latitude and longitude in degrees. */
export const Lat = z.number().min(-90).max(90);
export const Lng = z.number().min(-180).max(180);

/** Free text kept short. */
export const Note = z.string().trim().max(300);
export const Reason = z.string().trim().min(1).max(300);

/** Opaque cursor for paginated lists. */
export const Cursor = z.string().max(200);

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** Display-only brief of a person, used everywhere in owner views. */
export const PersonBrief = z.object({
  id: Id,
  name: z.string(),
  designation: z.string().nullable(),
  phone: PhoneE164.nullable(),
});
export type PersonBrief = z.infer<typeof PersonBrief>;

/** A blob in a binary response (PDF, JPEG, CSV). */
export const Binary = z.custom<Blob>((v) => typeof Blob !== 'undefined' && v instanceof Blob, {
  message: 'Expected a Blob',
});

/** 204 / 202 responses with no body. */
export const NoContent = z.undefined();
