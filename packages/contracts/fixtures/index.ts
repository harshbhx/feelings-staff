/**
 * Fixtures: one valid example response per endpoint (PRD 16.3), used by MockApiClient and the kit.
 * `fixtures[key]` is the default; `variants[key][name]` are alternative states (e.g. checked in).
 * Every file is validated against its contract schema in test/fixtures.test.ts.
 */
import type { EndpointKey } from '../src/endpoints';

export const fixtures: Partial<Record<EndpointKey, unknown>> = {};

export const variants: Partial<Record<EndpointKey, Record<string, unknown>>> = {};
