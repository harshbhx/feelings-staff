import { OWNER_STEPS } from './steps-owner';
import { UxLayer } from './UxLayer';

/** The owner shell's guidance layer. The setup wizard is left alone: it has its own guidance. */
export default function OwnerGuides({ userId }: { userId: string }) {
  return <UxLayer audience="owner" userId={userId} steps={OWNER_STEPS} skip={['/o/setup']} />;
}
