/** Every route module, merged (WP-1). A key implemented twice throws at startup. */
import { mergeHandlers } from '../lib/api';
import { handlers as testRoutes } from '../test-routes';
import { handlers as attendance } from './attendance';
import { handlers as auth } from './auth';
import { handlers as notify } from './notify';
import { handlers as owner } from './owner';
import { handlers as payroll } from './payroll';
import { handlers as staff } from './staff';
import { handlers as system } from './system';

export const allHandlers = mergeHandlers(
  system,
  auth,
  staff,
  attendance,
  owner,
  payroll,
  notify,
  testRoutes,
);
