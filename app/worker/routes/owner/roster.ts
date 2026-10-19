/** Owner roster, shift templates, holidays and no-leave days (PRD 5.2, 7.3, 7.8). Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import {
  createBlackout,
  createHoliday,
  createTemplate,
  deactivateTemplate,
  deleteBlackout,
  deleteHoliday,
  listBlackout,
  listHolidays,
  listTemplates,
  patchHoliday,
  patchTemplate,
  putRoster,
  rosterView,
} from '../../services/owner-config';

export const handlers: Handlers = {
  async ownerRosterGet({ query }, ctx) {
    return rosterView(ctx, query.week);
  },
  async ownerRosterPut({ body }, ctx) {
    return putRoster(ctx, body.changes);
  },
  async ownerShiftTemplatesList(_input, ctx) {
    return listTemplates(ctx);
  },
  async ownerShiftTemplateCreate({ body }, ctx) {
    return createTemplate(ctx, body);
  },
  async ownerShiftTemplatePatch({ params, body }, ctx) {
    return patchTemplate(ctx, params.id, body);
  },
  async ownerShiftTemplateDelete({ params }, ctx) {
    await deactivateTemplate(ctx, params.id);
    return undefined;
  },
  async ownerHolidaysList({ query }, ctx) {
    return listHolidays(ctx, query.year);
  },
  async ownerHolidayCreate({ body }, ctx) {
    return createHoliday(ctx, body);
  },
  async ownerHolidayPatch({ params, body }, ctx) {
    return patchHoliday(ctx, params.id, body);
  },
  async ownerHolidayDelete({ params }, ctx) {
    await deleteHoliday(ctx, params.id);
    return undefined;
  },
  async ownerBlackoutList({ query }, ctx) {
    return listBlackout(ctx, query.year);
  },
  async ownerBlackoutCreate({ body }, ctx) {
    return createBlackout(ctx, body);
  },
  async ownerBlackoutDelete({ params }, ctx) {
    await deleteBlackout(ctx, params.date);
    return undefined;
  },
};
