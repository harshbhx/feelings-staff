/**
 * Me (`/me`, PRD 5.1; AC S-17): who I am, language (English / ગુજરાતી, re-rendered without a
 * reload and saved with `PATCH /me`), notifications, this phone, My data, Privacy, Sign out.
 */
import { formatIndianPhone } from '@fs/contracts';
import type { AppLang } from '@fs/i18n';
import { applyDocumentLang } from '@fs/i18n/fonts';
import { Avatar, Badge, Button, Card, List, ListRow, RadioGroup, Switch, useToast } from '@fs/ui';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { saveLang } from '../../../app/i18n';
import { VIBRATE_KEY } from '../../../lib/haptics';
import { openGuide } from '../../../lib/ux/bus';
import { usePush } from '../../../pwa/push';
import { useQueue } from '../../../pwa/queue';
import { useLanguageSave, useOwnerName, useSignOut, useStaffMe } from '../api';
import { useFmt } from '../lib/format';
import { ScreenHeader } from '../shell/ScreenHeader';

/** Opened from a button only, so its code and styles load on the tap. */
const NotificationSheet = lazy(() =>
  import('../../../lib/ux/NotificationSheet').then((m) => ({ default: m.NotificationSheet })),
);

export function MeScreen() {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const me = useStaffMe();
  const owner = useOwnerName();
  const toast = useToast();
  const save = useLanguageSave();
  const signOut = useSignOut();
  const queue = useQueue();
  const push = usePush();
  const [askAlerts, setAskAlerts] = useState(false);
  const [askedAlerts, setAskedAlerts] = useState(false);
  if (askAlerts && !askedAlerts) setAskedAlerts(true);
  const lang: AppLang = i18n.language === 'gu' ? 'gu' : 'en';

  const switchTo = (next: AppLang) => {
    if (next === lang) return;
    const before = lang;
    void i18n.changeLanguage(next);
    saveLang(next);
    applyDocumentLang(next);
    save.mutate(next, {
      onSuccess: () => toast({ title: t('staff:me.languageSaved') }),
      onError: () => {
        // The server did not take it: go back so the screen and the account agree.
        void i18n.changeLanguage(before);
        saveLang(before);
        applyDocumentLang(before);
        toast({ tone: 'error', title: t('errors:generic') });
      },
    });
  };

  const confirmSignOut = () => {
    const message = queue.items.length
      ? `${t('staff:me.signOutQueued')} ${t('staff:me.signOutConfirm')}`
      : t('staff:me.signOutConfirm');
    if (!window.confirm(message)) return;
    signOut.mutate(undefined, {
      onError: () => toast({ tone: 'error', title: t('errors:generic') }),
    });
  };

  const notif =
    push.state === 'granted-subscribed' ? (
      <Badge tone="success" icon="check-circle">
        {t('staff:me.notifOn')}
      </Badge>
    ) : null;

  return (
    <>
      <ScreenHeader title={t('staff:screens.me')} />
      <main id="main" className="staff-main flex flex-col gap-5">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={me.user.name} size="lg" />
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-text">{me.user.name}</h2>
              {me.user.designation ? (
                <p className="text-sm text-text-muted">{me.user.designation}</p>
              ) : null}
              {me.user.joinDate ? (
                <p className="text-sm text-text-muted">
                  {t('staff:me.joined', { date: fmt.long(me.user.joinDate) })}
                </p>
              ) : null}
            </div>
          </div>
          {me.user.phone ? (
            <p className="mt-3 text-sm tabular">
              <span className="text-text-muted">{t('staff:me.phone')}: </span>
              {formatIndianPhone(me.user.phone)}
            </p>
          ) : null}
        </Card>

        <Card title={t('staff:me.language')} description={t('staff:me.languageHint')}>
          <RadioGroup
            legend={t('staff:me.language')}
            legendHidden
            value={lang}
            onValueChange={(v) => switchTo(v === 'gu' ? 'gu' : 'en')}
            options={[
              { value: 'en', label: <span lang="en">{t('common:language.en')}</span> },
              { value: 'gu', label: <span lang="gu">{t('common:language.gu')}</span> },
            ]}
          />
        </Card>

        <Card title={t('staff:me.notifications')} action={notif}>
          {push.state === 'default' || push.state === 'granted-unsubscribed' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">{t('staff:me.notifWhy', { owner })}</p>
              <Button
                variant="secondary"
                icon="bell"
                loading={push.busy}
                onClick={() => setAskAlerts(true)}
              >
                {t('staff:me.notifTurnOn')}
              </Button>
            </div>
          ) : push.state === 'denied' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t('staff:me.notifBlocked')}</p>
              <Button variant="secondary" icon="bell" onClick={() => setAskAlerts(true)}>
                {t('staff:me.notifHowTo')}
              </Button>
            </div>
          ) : push.state === 'granted-subscribed' ? (
            <p className="text-sm text-text-muted">{t('staff:me.notifWhy', { owner })}</p>
          ) : (
            <p className="text-sm text-text-muted">{t('staff:me.notifUnsupported')}</p>
          )}
        </Card>

        <VibrationCard />

        {askedAlerts ? (
          <Suspense fallback={null}>
            <NotificationSheet push={push} open={askAlerts} onOpenChange={setAskAlerts} />
          </Suspense>
        ) : null}

        {me.device ? (
          <Card title={t('staff:me.phoneSection')}>
            <p className="font-semibold text-text">{me.device.label}</p>
            <p className="text-sm text-text-muted">
              {me.device.approvedAt
                ? t('staff:me.approvedOn', { date: fmt.long(me.device.approvedAt) })
                : t('staff:me.devicePending', { owner })}
            </p>
          </Card>
        ) : null}

        <List framed>
          <ListRow asChild title={t('staff:me.myData')}>
            <Link to="/me/data" />
          </ListRow>
          <ListRow asChild title={t('staff:me.privacy')}>
            <Link to="/me/privacy" />
          </ListRow>
          <ListRow
            title={t('common:ux.tour.replay')}
            subtitle={t('common:ux.tour.replayHint')}
            onClick={() => openGuide('tour')}
          />
        </List>

        <Button
          variant="danger-secondary"
          block
          loading={signOut.isPending}
          onClick={confirmSignOut}
        >
          {t('staff:me.signOut')}
        </Button>
        <p className="text-center text-sm text-text-muted tabular" data-testid="app-version">
          {t('staff:me.version', { version: import.meta.env.VITE_APP_VERSION })}
        </p>
      </main>
    </>
  );
}

/** Haptics on this phone (app/src/lib/haptics.ts reads the same key). Hidden where there are none. */
function VibrationCard() {
  const { t } = useTranslation();
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(VIBRATE_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  if (typeof navigator.vibrate !== 'function') return null;
  const change = (next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.removeItem(VIBRATE_KEY);
      else localStorage.setItem(VIBRATE_KEY, 'off');
    } catch {
      // storage blocked: the choice lasts until the app closes
    }
  };
  return (
    <Card title={t('staff:me.vibration')}>
      <Switch
        label={on ? t('staff:me.vibrationOn') : t('staff:me.vibrationOff')}
        description={t('staff:me.vibrationHint')}
        checked={on}
        onCheckedChange={change}
      />
    </Card>
  );
}
