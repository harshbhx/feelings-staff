/**
 * Fixtures: one valid example response per endpoint (PRD 16.3), used by MockApiClient and the kit.
 * `fixtures[key]` is the default; `variants[key][name]` are alternative states (e.g. checked in).
 * Every file is validated against its contract schema in test/fixtures.test.ts.
 *
 * The salon is Feelings Beauty Care and "now" is Monday 19 Oct 2026, 10:42 IST (epoch ms 1792386720000).
 * The same person has the same id, name and phone in every file.
 */
import type { EndpointKey } from '../src/endpoints';
import advanceAck from './advanceAck.json';
import advanceRequestCreate from './advanceRequestCreate.json';
import authChallenge from './authChallenge.json';
import config from './config.json';
import consentGive from './consentGive.json';
import consentWithdraw from './consentWithdraw.json';
import doorPair from './doorPair.json';
import doorSecret from './doorSecret.json';
import doorStatus from './doorStatus.json';
import health from './health.json';
import joinComplete from './joinComplete.json';
import joinLookup_expired from './joinLookup.expired.json';
import joinLookup from './joinLookup.json';
import joinVerify from './joinVerify.json';
import leaveCancel from './leaveCancel.json';
import leaveCreate from './leaveCreate.json';
import leavePreview from './leavePreview.json';
import me from './me.json';
import me_owner from './me.owner.json';
import me_staffPendingDevice from './me.staff-pending-device.json';
import meAdvances from './meAdvances.json';
import meData from './meData.json';
import meDay from './meDay.json';
import meDays from './meDays.json';
import meLeave from './meLeave.json';
import mePatch from './mePatch.json';
import mePayslip from './mePayslip.json';
import mePayslips_empty from './mePayslips.empty.json';
import mePayslips from './mePayslips.json';
import meRegularisations from './meRegularisations.json';
import meToday_checkedIn from './meToday.checked-in.json';
import meToday_checkedOut from './meToday.checked-out.json';
import meToday from './meToday.json';
import meToday_onBreak from './meToday.on-break.json';
import meToday_onLeave from './meToday.on-leave.json';
import meToday_pendingProof from './meToday.pending-proof.json';
import meToday_ready from './meToday.ready.json';
import meToday_weekOff from './meToday.week-off.json';
import notificationPrefsGet from './notificationPrefsGet.json';
import notificationPrefsPut from './notificationPrefsPut.json';
import notificationsList_empty from './notificationsList.empty.json';
import notificationsList from './notificationsList.json';
import notificationsList_owner from './notificationsList.owner.json';
import ownerActions_empty from './ownerActions.empty.json';
import ownerActions from './ownerActions.json';
import ownerActionsBulk from './ownerActionsBulk.json';
import ownerAdjustmentAdd from './ownerAdjustmentAdd.json';
import ownerAdjustmentDelete from './ownerAdjustmentDelete.json';
import ownerAdvanceCreate from './ownerAdvanceCreate.json';
import ownerAdvanceDecide from './ownerAdvanceDecide.json';
import ownerAdvanceGet from './ownerAdvanceGet.json';
import ownerAdvancePatch from './ownerAdvancePatch.json';
import ownerAdvanceRecovery from './ownerAdvanceRecovery.json';
import ownerAdvancesList from './ownerAdvancesList.json';
import ownerAudit from './ownerAudit.json';
import ownerAutoCloseDecide from './ownerAutoCloseDecide.json';
import ownerBlackoutCreate from './ownerBlackoutCreate.json';
import ownerBlackoutList from './ownerBlackoutList.json';
import ownerCalibrationPropose from './ownerCalibrationPropose.json';
import ownerCalibrationSamples from './ownerCalibrationSamples.json';
import ownerDay from './ownerDay.json';
import ownerDayOverride from './ownerDayOverride.json';
import ownerDeviceDecide from './ownerDeviceDecide.json';
import ownerDeviceRevoke from './ownerDeviceRevoke.json';
import ownerDoorCode from './ownerDoorCode.json';
import ownerDoorDeviceCreate from './ownerDoorDeviceCreate.json';
import ownerDoorDeviceRotate from './ownerDoorDeviceRotate.json';
import ownerDoorDevicesList from './ownerDoorDevicesList.json';
import ownerDutiesList from './ownerDutiesList.json';
import ownerDutyCreate from './ownerDutyCreate.json';
import ownerDutyGet from './ownerDutyGet.json';
import ownerDutyPatch from './ownerDutyPatch.json';
import ownerExportCreate from './ownerExportCreate.json';
import ownerExportGet from './ownerExportGet.json';
import ownerExportsList from './ownerExportsList.json';
import ownerHolidayCreate from './ownerHolidayCreate.json';
import ownerHolidayPatch from './ownerHolidayPatch.json';
import ownerHolidaysList from './ownerHolidaysList.json';
import ownerLeaveDecide from './ownerLeaveDecide.json';
import ownerManagersList from './ownerManagersList.json';
import ownerManagerUpsert from './ownerManagerUpsert.json';
import ownerMapsResolve from './ownerMapsResolve.json';
import ownerOffsiteDecide from './ownerOffsiteDecide.json';
import ownerOvertimeDecide from './ownerOvertimeDecide.json';
import ownerPassword from './ownerPassword.json';
import ownerPayrollCreate from './ownerPayrollCreate.json';
import ownerPayrollFinalise from './ownerPayrollFinalise.json';
import ownerPayrollGet_finalised from './ownerPayrollGet.finalised.json';
import ownerPayrollGet from './ownerPayrollGet.json';
import ownerPayrollGet_withBlockers from './ownerPayrollGet.with-blockers.json';
import ownerPayrollMarkAllPaid from './ownerPayrollMarkAllPaid.json';
import ownerPayrollPreview from './ownerPayrollPreview.json';
import ownerPayrollRecompute from './ownerPayrollRecompute.json';
import ownerPayrollReopen from './ownerPayrollReopen.json';
import ownerPayrollRuns from './ownerPayrollRuns.json';
import ownerPayslipMarkPaid from './ownerPayslipMarkPaid.json';
import ownerPayslipPreview from './ownerPayslipPreview.json';
import ownerPunchReview from './ownerPunchReview.json';
import ownerRegister from './ownerRegister.json';
import ownerRegularisationDecide from './ownerRegularisationDecide.json';
import ownerRosterGet from './ownerRosterGet.json';
import ownerRosterPut from './ownerRosterPut.json';
import ownerSecurityGet from './ownerSecurityGet.json';
import ownerSetPassword from './ownerSetPassword.json';
import ownerSetPin from './ownerSetPin.json';
import ownerSettingsGet from './ownerSettingsGet.json';
import ownerSettingsPatch from './ownerSettingsPatch.json';
import ownerSetupGet from './ownerSetupGet.json';
import ownerSetupStep from './ownerSetupStep.json';
import ownerShiftTemplateCreate from './ownerShiftTemplateCreate.json';
import ownerShiftTemplatePatch from './ownerShiftTemplatePatch.json';
import ownerShiftTemplatesList from './ownerShiftTemplatesList.json';
import ownerSignOutOthers from './ownerSignOutOthers.json';
import ownerSitePatch from './ownerSitePatch.json';
import ownerSites from './ownerSites.json';
import ownerStaffCreate from './ownerStaffCreate.json';
import ownerStaffExit from './ownerStaffExit.json';
import ownerStaffGet from './ownerStaffGet.json';
import ownerStaffInvite from './ownerStaffInvite.json';
import ownerStaffLeave from './ownerStaffLeave.json';
import ownerStaffLeaveAdjust from './ownerStaffLeaveAdjust.json';
import ownerStaffList from './ownerStaffList.json';
import ownerStaffPatch from './ownerStaffPatch.json';
import ownerStaffRehire from './ownerStaffRehire.json';
import ownerStaffResetPin from './ownerStaffResetPin.json';
import ownerToday_beforeFirstShift from './ownerToday.before-first-shift.json';
import ownerToday_holiday from './ownerToday.holiday.json';
import ownerToday from './ownerToday.json';
import ownerVerify from './ownerVerify.json';
import punchCreate_flagged from './punchCreate.flagged.json';
import punchCreate from './punchCreate.json';
import punchCreate_needsProof from './punchCreate.needs-proof.json';
import punchCreate_pending from './punchCreate.pending.json';
import punchNonce from './punchNonce.json';
import punchNonce_offline from './punchNonce.offline.json';
import punchProof from './punchProof.json';
import punchRequestApproval from './punchRequestApproval.json';
import regularisationCancel from './regularisationCancel.json';
import regularisationCreate from './regularisationCreate.json';
import setup from './setup.json';
import staffLogin from './staffLogin.json';
import staffNewDevice from './staffNewDevice.json';
import stepUp from './stepUp.json';
import testClock from './testClock.json';
import testCron from './testCron.json';
import testOutbox from './testOutbox.json';
import testReset from './testReset.json';
import time from './time.json';
import verifyPayslip from './verifyPayslip.json';

export const fixtures: Partial<Record<EndpointKey, unknown>> = {
  health,
  config,
  time,
  setup,
  joinLookup,
  joinVerify,
  joinComplete,
  authChallenge,
  staffLogin,
  staffNewDevice,
  ownerVerify,
  ownerPassword,
  stepUp,
  me,
  mePatch,
  consentGive,
  consentWithdraw,
  punchNonce,
  punchCreate,
  punchProof,
  punchRequestApproval,
  meToday,
  meDays,
  meDay,
  meData,
  meLeave,
  leavePreview,
  leaveCreate,
  leaveCancel,
  meRegularisations,
  regularisationCreate,
  regularisationCancel,
  meAdvances,
  advanceRequestCreate,
  advanceAck,
  mePayslips,
  mePayslip,
  notificationsList,
  notificationPrefsGet,
  notificationPrefsPut,
  ownerToday,
  ownerActions,
  ownerActionsBulk,
  ownerPunchReview,
  ownerDeviceDecide,
  ownerDeviceRevoke,
  ownerLeaveDecide,
  ownerRegularisationDecide,
  ownerOvertimeDecide,
  ownerAutoCloseDecide,
  ownerRegister,
  ownerDay,
  ownerDayOverride,
  ownerStaffList,
  ownerStaffCreate,
  ownerStaffGet,
  ownerStaffPatch,
  ownerStaffInvite,
  ownerStaffResetPin,
  ownerStaffExit,
  ownerStaffRehire,
  ownerStaffLeave,
  ownerStaffLeaveAdjust,
  ownerRosterGet,
  ownerRosterPut,
  ownerShiftTemplatesList,
  ownerShiftTemplateCreate,
  ownerShiftTemplatePatch,
  ownerHolidaysList,
  ownerHolidayCreate,
  ownerHolidayPatch,
  ownerBlackoutList,
  ownerBlackoutCreate,
  ownerSites,
  ownerSitePatch,
  ownerCalibrationSamples,
  ownerCalibrationPropose,
  ownerDutiesList,
  ownerDutyCreate,
  ownerDutyGet,
  ownerDutyPatch,
  ownerMapsResolve,
  ownerOffsiteDecide,
  ownerDoorCode,
  ownerDoorDevicesList,
  ownerDoorDeviceCreate,
  ownerDoorDeviceRotate,
  ownerAdvancesList,
  ownerAdvanceCreate,
  ownerAdvanceGet,
  ownerAdvancePatch,
  ownerAdvanceDecide,
  ownerPayrollRuns,
  ownerPayrollCreate,
  ownerPayrollPreview,
  ownerPayrollGet,
  ownerPayrollRecompute,
  ownerPayslipPreview,
  ownerAdjustmentAdd,
  ownerAdjustmentDelete,
  ownerAdvanceRecovery,
  ownerPayrollFinalise,
  ownerPayrollReopen,
  ownerPayslipMarkPaid,
  ownerPayrollMarkAllPaid,
  ownerExportsList,
  ownerExportCreate,
  ownerExportGet,
  ownerSettingsGet,
  ownerSettingsPatch,
  ownerSetupGet,
  ownerSetupStep,
  ownerSecurityGet,
  ownerSetPassword,
  ownerSetPin,
  ownerSignOutOthers,
  ownerAudit,
  ownerManagersList,
  ownerManagerUpsert,
  doorPair,
  doorSecret,
  doorStatus,
  verifyPayslip,
  testReset,
  testClock,
  testCron,
  testOutbox,
};

export const variants: Partial<Record<EndpointKey, Record<string, unknown>>> = {
  joinLookup: {
    expired: joinLookup_expired,
  },
  me: {
    owner: me_owner,
    'staff-pending-device': me_staffPendingDevice,
  },
  punchNonce: {
    offline: punchNonce_offline,
  },
  punchCreate: {
    flagged: punchCreate_flagged,
    'needs-proof': punchCreate_needsProof,
    pending: punchCreate_pending,
  },
  meToday: {
    'checked-in': meToday_checkedIn,
    'checked-out': meToday_checkedOut,
    'week-off': meToday_weekOff,
    'on-leave': meToday_onLeave,
    'pending-proof': meToday_pendingProof,
    ready: meToday_ready,
    'on-break': meToday_onBreak,
  },
  mePayslips: {
    empty: mePayslips_empty,
  },
  notificationsList: {
    empty: notificationsList_empty,
    owner: notificationsList_owner,
  },
  ownerToday: {
    'before-first-shift': ownerToday_beforeFirstShift,
    holiday: ownerToday_holiday,
  },
  ownerActions: {
    empty: ownerActions_empty,
  },
  ownerPayrollGet: {
    finalised: ownerPayrollGet_finalised,
    'with-blockers': ownerPayrollGet_withBlockers,
  },
};
