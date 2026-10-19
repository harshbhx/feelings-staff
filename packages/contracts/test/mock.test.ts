import { describe, expect, it } from 'vitest';
import { fixtures, variants } from '../fixtures';
import { ApiError, type EndpointKey } from '../src';
import { createMockApiClient } from '../src/mock';

describe('createMockApiClient', () => {
  it('returns the default fixture for an endpoint', async () => {
    const api = createMockApiClient();
    expect(await api.health()).toEqual(fixtures.health);
    expect(await api.meToday()).toEqual(fixtures.meToday);
    expect(await api.ownerToday()).toEqual(fixtures.ownerToday);
  });

  it('returns a copy, so a caller cannot change the fixture', async () => {
    const api = createMockApiClient();
    const first = (await api.me()) as { user: { name: string } };
    first.user.name = 'Someone else';
    const second = (await api.me()) as { user: { name: string } };
    expect(second.user.name).toBe('Priya Solanki');
  });

  it('honours a named variant per endpoint', async () => {
    const api = createMockApiClient({
      variants: { meToday: 'checked-out', ownerActions: 'empty', me: 'owner' },
    });
    expect(await api.meToday()).toEqual(variants.meToday?.['checked-out']);
    expect(await api.ownerActions({ query: {} })).toEqual(variants.ownerActions?.empty);
    expect((await api.me()).user.role).toBe('owner');
    // Other endpoints keep their defaults.
    expect(await api.health()).toEqual(fixtures.health);
  });

  it('lets an override replace a response, as a value or a function', async () => {
    const calls: [EndpointKey, unknown][] = [];
    const api = createMockApiClient({
      overrides: {
        health: { ok: true, version: '9.9.9', commit: 'test' },
        stepUp: (input: unknown) => ({
          stepUpUntil: (input as { body: { pin: string } }).body.pin.length,
        }),
      },
      onCall: (key, input) => calls.push([key, input]),
    });
    expect(await api.health()).toEqual({ ok: true, version: '9.9.9', commit: 'test' });
    expect(await api.stepUp({ body: { pin: '123456' } })).toEqual({ stepUpUntil: 6 });
    expect(calls.map(([key]) => key)).toEqual(['health', 'stepUp']);
  });

  it('prefers an override over a variant', async () => {
    const api = createMockApiClient({
      variants: { health: 'whatever' },
      overrides: { health: { ok: true, version: '2.0.0', commit: 'x' } },
    });
    expect((await api.health()).version).toBe('2.0.0');
  });

  it('throws NOT_IMPLEMENTED when there is no fixture for the chosen variant', async () => {
    const api = createMockApiClient({ variants: { meToday: 'no-such-variant' } });
    const err = await api.meToday().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
  });

  it('answers empty-body and file endpoints without a fixture', async () => {
    const api = createMockApiClient();
    expect(await api.logout()).toBeUndefined();
    expect(await api.payslipPdf({ params: { id: '01K8000000000000000000000A' } })).toBeInstanceOf(
      Blob,
    );
  });

  it('builds download URLs under /api/v1', () => {
    const api = createMockApiClient();
    expect(api.url('payslipPdf', { params: { id: '01K8000000000000000000000A' } })).toBe(
      '/api/v1/payslips/01K8000000000000000000000A/pdf',
    );
  });
});
