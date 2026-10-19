/**
 * Screen title and back link for the owner header. The header holds the one h1 of the screen
 * (PRD 11.11). It shows the route's `handle.titleKey` while a screen loads; a screen can set a
 * specific title ("Neha Parmar · Mon 19 Oct") with `useOwnerTitle`.
 */
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useMatches } from 'react-router';
import type { OwnerRouteHandle } from '../routes';

interface ScreenChrome {
  title: string | null;
  back: string | null;
}

const ChromeContext = createContext<{
  chrome: ScreenChrome;
  set: (c: ScreenChrome) => void;
} | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, set] = useState<ScreenChrome>({ title: null, back: null });
  return <ChromeContext.Provider value={{ chrome, set }}>{children}</ChromeContext.Provider>;
}

/** Set this screen's header title (and back target on phones) while it is shown. */
export function useOwnerTitle(title: string | null, back?: string | null): void {
  const ctx = useContext(ChromeContext);
  const set = ctx?.set;
  useEffect(() => {
    if (!set) return;
    set({ title, back: back ?? null });
    return () => set({ title: null, back: null });
  }, [set, title, back]);
}

/** What the header shows: the screen's own title, else the route's title key. */
export function useScreenChrome(): { title: string | null; titleKey: string; back: string | null } {
  const ctx = useContext(ChromeContext);
  const matches = useMatches();
  let handle: OwnerRouteHandle | undefined;
  for (const m of matches) {
    const h = m.handle as OwnerRouteHandle | undefined;
    if (h?.titleKey) handle = h;
  }
  return {
    title: ctx?.chrome.title ?? null,
    titleKey: handle?.titleKey ?? 'owner:nav.label',
    back: ctx?.chrome.back ?? handle?.back ?? null,
  };
}
