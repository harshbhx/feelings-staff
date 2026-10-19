import { type ApiClient, istDate, type NotificationView } from '@fs/contracts';
import { createI18n } from '@fs/i18n';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/provider';
import { groupByDay } from './hooks';
import { InboxBell, InboxScreen } from './index';

afterEach(cleanup);

const DAY = 86_400_000;
function note(id: string, over: Partial<NotificationView> = {}): NotificationView {
  return {
    id,
    type: 'late' as NotificationView['type'],
    title: `Title ${id}`,
    body: null,
    url: `/day/${id}`,
    priority: 'normal' as NotificationView['priority'],
    data: null,
    readAt: null,
    createdAt: Date.now(),
    ...over,
  };
}

function fakeApi(
  pages: Array<{ items: NotificationView[]; nextCursor: string | null; unread: number }>,
) {
  let call = 0;
  const notificationsList = vi.fn(async () => pages[Math.min(call++, pages.length - 1)]);
  const notificationsRead = vi.fn(async () => undefined);
  return {
    api: { notificationsList, notificationsRead } as unknown as ApiClient,
    notificationsList,
    notificationsRead,
  };
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

async function renderWith(api: ApiClient, ui: React.ReactNode, at = '/inbox') {
  const i18n = await createI18n('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[at]}>
          {ui}
          <Where />
        </MemoryRouter>
      </ApiProvider>
    </I18nextProvider>,
  );
}

describe('S-15 inbox', () => {
  it('S-15.1 groups rows into Today and Earlier by IST date', () => {
    const now = Date.now();
    const a = note('a', { createdAt: now });
    const b = note('b', { createdAt: now - 3 * DAY });
    const g = groupByDay([a, b], now);
    expect(istDate(a.createdAt)).toBe(istDate(now));
    expect(g.today.map((n) => n.id)).toEqual(['a']);
    expect(g.earlier.map((n) => n.id)).toEqual(['b']);
  });

  it('S-15.1 renders Today and Earlier sections with an unread dot only on unread rows', async () => {
    const { api } = fakeApi([
      {
        items: [
          note('a'),
          note('b', { createdAt: Date.now() - 3 * DAY, readAt: Date.now() - 2 * DAY }),
        ],
        nextCursor: null,
        unread: 1,
      },
    ]);
    await renderWith(api, <InboxScreen />);
    const today = await screen.findByRole('region', { name: 'Today' });
    const earlier = screen.getByRole('region', { name: 'Earlier' });
    expect(within(today).getByText('Title a')).toBeTruthy();
    expect(within(earlier).getByText('Title b')).toBeTruthy();
    expect(within(today).getByText('Unread')).toBeTruthy();
    expect(within(earlier).queryByText('Unread')).toBeNull();
  });

  it('S-15.1 tapping a row marks it read and opens its url', async () => {
    const { api, notificationsRead } = fakeApi([
      { items: [note('a', { url: '/o/actions' })], nextCursor: null, unread: 1 },
    ]);
    await renderWith(api, <InboxScreen />);
    await userEvent.click(await screen.findByText('Title a'));
    await waitFor(() => expect(notificationsRead).toHaveBeenCalledWith({ body: { ids: ['a'] } }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/o/actions'));
  });

  it('S-15.1 Mark all read sends all:true', async () => {
    const { api, notificationsRead } = fakeApi([
      { items: [note('a'), note('b')], nextCursor: null, unread: 2 },
    ]);
    await renderWith(api, <InboxScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(notificationsRead).toHaveBeenCalledWith({ body: { all: true } }));
  });

  it('S-15.1 Load more fetches the next page with the cursor', async () => {
    const { api, notificationsList } = fakeApi([
      { items: [note('a')], nextCursor: 'c1', unread: 0 },
      { items: [note('z', { createdAt: Date.now() - 5 * DAY })], nextCursor: null, unread: 0 },
    ]);
    await renderWith(api, <InboxScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Title z')).toBeTruthy();
    expect(notificationsList).toHaveBeenLastCalledWith({ query: { cursor: 'c1' } });
  });

  it('S-15.1 shows an empty state', async () => {
    const { api } = fakeApi([{ items: [], nextCursor: null, unread: 0 }]);
    await renderWith(api, <InboxScreen />);
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
  });

  it('S-15.1 shows an error state with a retry', async () => {
    const api = {
      notificationsList: vi.fn(async () => {
        throw new Error('down');
      }),
    } as unknown as ApiClient;
    await renderWith(api, <InboxScreen />);
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toBeTruthy();
  });

  it('S-15.3 the bell shows the unread count and links to the inbox', async () => {
    const { api } = fakeApi([{ items: [note('a')], nextCursor: null, unread: 4 }]);
    await renderWith(
      api,
      <Routes>
        <Route path="*" element={<InboxBell />} />
      </Routes>,
      '/',
    );
    const link = await screen.findByRole('link', { name: 'Inbox, 4 unread' });
    expect(link.getAttribute('href')).toBe('/inbox');
    expect(screen.getByTestId('inbox-bell-count').textContent).toBe('4');
  });

  it('S-15.3 the owner bell links to /o/inbox and hides the badge at zero', async () => {
    const { api } = fakeApi([{ items: [], nextCursor: null, unread: 0 }]);
    await renderWith(
      api,
      <Routes>
        <Route path="*" element={<InboxBell />} />
      </Routes>,
      '/o/today',
    );
    const link = await screen.findByRole('link', { name: 'Inbox' });
    expect(link.getAttribute('href')).toBe('/o/inbox');
    expect(screen.queryByTestId('inbox-bell-count')).toBeNull();
  });
});
