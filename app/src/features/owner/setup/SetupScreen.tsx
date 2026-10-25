/**
 * First-run setup (PRD 4.15.1, 5.2, O-02): a checklist with progress; each step opens a focused page
 * built from the same pieces as Settings (salon, the circle with calibration, shifts, holidays, pay
 * rules, selfie), then "Add your first staff member" and installing with alerts on Urmi's phone.
 * Every step can be skipped and finished later; nothing here is lost when she leaves.
 */
import type { SetupStep } from '@fs/contracts';
import { Button, Card, Icon, List, ListRow, useToast } from '@fs/ui';
import { lazy, type ReactNode, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { usePush } from '../../../pwa/push';
import { isStepUpCancelled } from '../../auth/step-up';
import { useSites } from '../api/schedule';
import { useSettings, useSetup, useSetupStep } from '../api/settings';
import { Meta } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { EvidenceMap } from '../map/EvidenceMap';
import { HolidaysSection } from '../settings/HolidaysSection';
import { Calibrate } from '../settings/LocationSection';
import { SalonSection } from '../settings/SalonSection';
import { SettingsForm } from '../settings/SettingsForm';
import { ShiftsSection } from '../settings/ShiftsSection';
import { sectionById } from '../settings/sections';
import { useOwnerTitle } from '../shell/chrome';
import { STEPS, setupLayout, setupProgress } from './setup-model';

export function SetupScreen() {
  const [params] = useSearchParams();
  const step = params.get('step') as SetupStep | null;
  return step && STEPS.includes(step) ? <StepPage step={step} /> : <Checklist />;
}

function Checklist() {
  const { t } = useTranslation();
  const setup = useSetup();
  useOwnerTitle(null);
  return (
    <QueryView query={setup} skeleton={<RowsSkeleton rows={8} />}>
      {(view) => {
        const p = setupProgress(view.steps);
        const layout = setupLayout(view.steps);
        const title = (s: SetupStep) => t(`owner:setup.steps.${s}.title`);
        const stepLink = (s: SetupStep) => `/o/setup?step=${s}`;
        return (
          <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-6">
            <div className="grid gap-3">
              <p className="font-extrabold text-text text-xl tracking-display">
                {view.complete ? t('owner:setup.ready') : t('owner:setup.lead')}
              </p>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-bg-tint"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={p.total}
                aria-valuenow={p.handled}
                aria-label={t('owner:setup.progress', { done: p.handled, total: p.total })}
              >
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(p.handled / p.total) * 100}%` }}
                />
              </div>
            </div>
            {layout.next ? (
              <Card
                tone="soft"
                title={title(layout.next)}
                description={t(`owner:setup.steps.${layout.next}.hint`)}
              >
                <Button asChild variant="primary" iconEnd="arrow-right">
                  <Link to={stepLink(layout.next)}>
                    {t('owner:setup.continue', { step: title(layout.next) })}
                  </Link>
                </Button>
              </Card>
            ) : (
              <div>
                <Button asChild variant="primary" iconEnd="arrow-right">
                  <Link to="/o/today">{t('owner:setup.toToday')}</Link>
                </Button>
              </div>
            )}
            {layout.open.length > 0 ? (
              <section aria-labelledby="setup-open" className="grid gap-1">
                <h2 id="setup-open" className="font-semibold text-sm text-text-muted tracking-name">
                  {layout.open.some((s) => (view.steps[s] ?? 'todo') === 'todo')
                    ? t('owner:setup.todoHeading')
                    : t('owner:setup.skippedHeading')}
                </h2>
                <List>
                  {layout.open.map((s) => (
                    <ListRow
                      key={s}
                      asChild
                      leading={
                        <span className="grid size-10 place-items-center rounded-full bg-bg-tint font-bold text-on-tint tabular-nums">
                          {STEPS.indexOf(s) + 1}
                        </span>
                      }
                      title={title(s)}
                      subtitle={t(`owner:setup.steps.${s}.hint`)}
                      trailing={
                        view.steps[s] === 'skipped' ? (
                          <span className="font-semibold text-sm text-text-muted">
                            {t('owner:setup.state.skipped')}
                          </span>
                        ) : undefined
                      }
                    >
                      <Link to={stepLink(s)} />
                    </ListRow>
                  ))}
                </List>
              </section>
            ) : null}
            {layout.done.length > 0 ? (
              <details className="group rounded-md bg-bg">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-2 font-semibold text-sm text-text [&::-webkit-details-marker]:hidden">
                  <Icon name="check-circle" className="size-5 text-[var(--status-present)]" />
                  <span className="flex-1">
                    {t('owner:setup.progress', { done: layout.done.length, total: layout.total })}
                  </span>
                  <Icon
                    name="caret-down"
                    className="size-5 text-text-muted transition-transform group-open:rotate-180"
                  />
                </summary>
                <ul className="border-border border-t">
                  {layout.done.map((s) => (
                    <li key={s} className="border-border border-b last:border-b-0">
                      <Link
                        to={stepLink(s)}
                        aria-label={t('owner:setup.doneStep', { step: title(s) })}
                        className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-text"
                      >
                        <Icon name="check" className="size-4 text-[var(--status-present)]" />
                        <span className="flex-1">{title(s)}</span>
                        <Icon name="caret-right" className="size-4 text-text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      }}
    </QueryView>
  );
}

function StepPage({ step }: { step: SetupStep }) {
  const { t } = useTranslation();
  useOwnerTitle(t(`owner:setup.steps.${step}.title`), '/o/setup');
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-8">
      <Meta>{t(`owner:setup.steps.${step}.lead`)}</Meta>
      <StepBody step={step} />
      <StepActions step={step} />
    </div>
  );
}

function WithSettings({
  children,
}: {
  children: (v: NonNullable<ReturnType<typeof useSettings>['data']>) => ReactNode;
}) {
  const settings = useSettings();
  return (
    <QueryView query={settings} skeleton={<RowsSkeleton rows={5} />}>
      {(view) => children(view)}
    </QueryView>
  );
}

function StepBody({ step }: { step: SetupStep }) {
  switch (step) {
    case 'salon':
      return <WithSettings>{(view) => <SalonSection view={view} />}</WithSettings>;
    case 'location':
      return <LocationStep />;
    case 'shifts':
      return <ShiftsSection />;
    case 'holidays':
      return <HolidaysSection />;
    case 'pay_rules':
      return (
        <WithSettings>
          {(view) => <SettingsForm view={view} fields={sectionById('pay')?.fields ?? []} />}
        </WithSettings>
      );
    case 'selfie':
      return (
        <WithSettings>
          {(view) => (
            <SettingsForm
              view={view}
              fields={(sectionById('attendance')?.fields ?? []).filter((f) => f.id === 'selfieIn')}
            />
          )}
        </WithSettings>
      );
    case 'first_staff':
      return <FirstStaff />;
    case 'install':
      return <Install />;
  }
}

function LocationStep() {
  const { t } = useTranslation();
  const sites = useSites();
  return (
    <QueryView query={sites} skeleton={<RowsSkeleton rows={3} />}>
      {(list) => {
        const site = list.find((s) => s.kind === 'salon' && s.active) ?? list[0];
        if (!site) return null;
        return (
          <div className="grid gap-6">
            <EvidenceMap
              centre={{ lat: site.lat, lng: site.lng }}
              radiusM={site.radiusM}
              label={t('owner:settings.location.map', { name: site.name })}
              height="16rem"
            />
            <Meta>{t('owner:setup.location.circle', { m: site.radiusM })}</Meta>
            <Calibrate site={site} />
          </div>
        );
      }}
    </QueryView>
  );
}

function FirstStaff() {
  const { t } = useTranslation();
  return (
    <div>
      <Button asChild variant="secondary" icon="plus">
        <Link to="/o/staff/new">{t('owner:staff.add')}</Link>
      </Button>
    </div>
  );
}

/** Opened from a button only, so its code and styles load on the tap. */
const NotificationSheet = lazy(() =>
  import('../../../lib/ux/NotificationSheet').then((m) => ({ default: m.NotificationSheet })),
);

function Install() {
  const { t } = useTranslation();
  const push = usePush();
  const [ask, setAsk] = useState(false);
  const [asked, setAsked] = useState(false);
  if (ask && !asked) setAsked(true);
  return (
    <div className="grid gap-4">
      <Meta>{t(`owner:setup.install.state.${push.state}`)}</Meta>
      {asked ? (
        <Suspense fallback={null}>
          <NotificationSheet push={push} open={ask} onOpenChange={setAsk} />
        </Suspense>
      ) : null}
      {push.state === 'default' || push.state === 'granted-unsubscribed' ? (
        <div>
          <Button variant="secondary" icon="bell" disabled={push.busy} onClick={() => setAsk(true)}>
            {t('owner:setup.install.enable')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StepActions({ step }: { step: SetupStep }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const mark = useSetupStep();
  const [, setParams] = useSearchParams();
  const next = STEPS[STEPS.indexOf(step) + 1];
  const go = (state: 'done' | 'skipped') =>
    mark.mutate(
      { step, state },
      {
        onSuccess: () => setParams(next ? { step: next } : {}),
        onError: (e) => {
          if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
        },
      },
    );
  return (
    <div className="flex flex-wrap gap-2 border-border border-t pt-5">
      <Button
        variant="secondary"
        icon="check-circle"
        disabled={mark.isPending}
        onClick={() => go('done')}
      >
        {t(`owner:setup.steps.${step}.done`)}
      </Button>
      <Button variant="ghost" disabled={mark.isPending} onClick={() => go('skipped')}>
        {t('owner:setup.skip')}
      </Button>
    </div>
  );
}
