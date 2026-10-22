import { describe, expect, it } from 'vitest';
import { notFoundTarget } from './NotFound';

describe('not-found way back', () => {
  it('sends each role to its own Today', () => {
    expect(notFoundTarget('staff', '/nope')).toEqual({ to: '/', signedIn: true });
    expect(notFoundTarget('owner', '/o/nope')).toEqual({ to: '/o/today', signedIn: true });
    expect(notFoundTarget('manager', '/nope')).toEqual({ to: '/o/today', signedIn: true });
  });

  it('sends nobody signed in to the right sign-in', () => {
    expect(notFoundTarget(null, '/nope')).toEqual({ to: '/signin', signedIn: false });
    expect(notFoundTarget(null, '/o/nope')).toEqual({ to: '/auth/owner', signedIn: false });
    expect(notFoundTarget(null, '/other')).toEqual({ to: '/signin', signedIn: false });
  });
});
