/**
 * `/o/credits/:userId` (PRD 4.19.2): the person's ledger under their name, back to Credits. The name
 * comes from the Credits overview (or the staff profile when the overview is not loaded yet).
 */
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useCreditsOverview } from '../api/credits';
import { useStaff } from '../api/staff';
import { useOwnerTitle } from '../shell/chrome';
import { CreditLedger } from './CreditLedger';

export function CreditLedgerScreen() {
  const { t } = useTranslation();
  const { userId = '' } = useParams();
  const overview = useCreditsOverview();
  const fromOverview = overview.data?.staff.find((s) => s.userId === userId)?.name;
  const staff = useStaff(userId);
  const name = fromOverview ?? staff.data?.name ?? '';
  useOwnerTitle(name ? t('owner:credits.ledger.title', { name }) : null, '/o/credits');
  return <CreditLedger userId={userId} name={name} />;
}
