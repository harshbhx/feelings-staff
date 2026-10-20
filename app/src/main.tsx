/** SPA entry (WP-1, shared). */
import '@fs/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppProviders } from './app/root';
import { startPwa } from './pwa/register';
import { createRouter } from './router';

const router = createRouter();

// Service worker, update flow and offline state (PRD 11.4-11.7) for staff and owner alike.
startPwa();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
