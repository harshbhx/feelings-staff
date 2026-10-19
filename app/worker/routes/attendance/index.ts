/**
 * Attendance route handlers (WP-4): nonces, punches, Today/Month/Day, my data, leave, fixes, and the
 * door device. Owner decisions live in ./decisions (merged here so the owner aggregator stays as is).
 */
import { mergeHandlers } from '../../lib/api';
import { handlers as door } from './door';
import { handlers as requests } from './requests';
import { handlers as staff } from './staff';

export const handlers = mergeHandlers(staff, requests, door);
