/** Owner route modules (WP-1 aggregator; each file is owned by the package named inside it). */
import { mergeHandlers } from '../../lib/api';
import { handlers as actions } from './actions';
import { handlers as days } from './days';
import { handlers as demo } from './demo';
import { handlers as door } from './door';
import { handlers as duties } from './duties';
import { handlers as register } from './register';
import { handlers as roster } from './roster';
import { handlers as settings } from './settings';
import { handlers as sites } from './sites';
import { handlers as today } from './today';

export const handlers = mergeHandlers(
  today,
  actions,
  register,
  days,
  roster,
  sites,
  duties,
  door,
  settings,
  demo,
);
