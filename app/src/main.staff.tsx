/** SPA entry of the staff build (docs/owner-access.md): same as main.tsx with the staff-only router. */
import '@fs/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppProviders } from './app/root';
import { startPwa } from './pwa/register';
import { createRouter } from './router.staff';

const router = createRouter();
const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

// Service worker, update flow and offline state (PRD 11.4-11.7) for staff and owner alike.
startPwa();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
