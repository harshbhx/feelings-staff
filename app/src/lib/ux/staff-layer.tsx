import { STAFF_STEPS } from './steps-staff';
import { UxLayer } from './UxLayer';

/** The staff shell's guidance layer (its own chunk, loaded after first paint). */
export default function StaffGuides({ userId }: { userId: string }) {
  return <UxLayer audience="staff" userId={userId} steps={STAFF_STEPS} skip={[]} />;
}
