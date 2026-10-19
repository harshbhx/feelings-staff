/** Owner door endpoints: "Show door code" and door device management (PRD 4.5). Owner: WP-4. */
import type { Handlers } from '../../lib/api';
import {
  createPairing,
  doorDeviceById,
  doorDeviceView,
  ownerDoorCode,
  revokeDoorDevice,
  rotateDoorDevice,
} from '../../services/door';
import { listDoorDevices } from '../../services/owner-config';

export const handlers: Handlers = {
  async ownerDoorCode(_input, ctx, c) {
    return ownerDoorCode(ctx, ctx.now(), new URL(c.req.url).origin);
  },
  async ownerDoorDevicesList(_input, ctx) {
    return (await listDoorDevices(ctx)).map(doorDeviceView);
  },
  async ownerDoorDeviceCreate({ body }, ctx) {
    return createPairing(ctx, body);
  },
  async ownerDoorDeviceDelete({ params }, ctx) {
    await doorDeviceById(ctx, params.id);
    await revokeDoorDevice(ctx, params.id);
    return undefined;
  },
  async ownerDoorDeviceRotate({ params }, ctx) {
    return doorDeviceView(await rotateDoorDevice(ctx, params.id));
  },
};
