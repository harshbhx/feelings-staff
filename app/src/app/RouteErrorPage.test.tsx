import { createI18n } from '@fs/i18n';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './RouteErrorPage';

function Boom(): never {
  throw new Error('render failed');
}

async function show() {
  const i18n = await createI18n('en');
  const router = createMemoryRouter([{ path: '/', element: <Boom />, ErrorBoundary }]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe('root error page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('says something went wrong, offers Try again and tells the owner when it keeps happening', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Something went wrong');
    expect(screen.getByText(/tell the owner/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByTestId('route-error-stamp').textContent).toMatch(/Seen at \d{2}:\d{2}/);
    expect(screen.getByTestId('route-error').getAttribute('data-kind')).toBe('crash');
  });

  it('is the offline screen when the phone has no connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    await show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain("You're offline");
    expect(screen.getByTestId('route-error').getAttribute('data-kind')).toBe('offline');
    expect(screen.queryByTestId('route-error-stamp')).toBeNull();
  });
});
