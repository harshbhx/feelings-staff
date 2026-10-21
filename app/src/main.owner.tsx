/** SPA entry of the owner build (docs/owner-access.md): same as main.tsx with the owner-only router. */
import '@fs/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppProviders } from './app/root';
import { startPwa } from './pwa/register';
import { createRouter } from './router.owner';

const router = createRouter();
const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

// Service worker, update flow and offline state (PRD 11.4-11.7); the owner host has its own worker.
startPwa();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
