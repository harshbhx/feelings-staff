/**
 * Which build this is (docs/owner-access.md, ADR-19). `__FS_SURFACE__` is replaced at build time by
 * vite.config.ts: `staff` and `owner` are the split entries, `combined` (also the value when the
 * constant is not defined, e.g. in unit tests) is the single build that serves both while the
 * Worker's OWNER_HOST is unset. Guards written as `STAFF_ONLY ? ... : ...` are folded away by the
 * bundler, so the staff output carries no owner links, paths or copy.
 */
declare const __FS_SURFACE__: string | undefined;

export const STAFF_ONLY = typeof __FS_SURFACE__ === 'string' && __FS_SURFACE__ === 'staff';
export const OWNER_ONLY = typeof __FS_SURFACE__ === 'string' && __FS_SURFACE__ === 'owner';
