/**
 * Me (`/me`, PRD 5.1; AC S-17): who I am, language (English / ગુજરાતી, re-rendered without a
 * reload and saved with `PATCH /me`), notifications, this phone, My data, Privacy, Sign out.
 */
import type { AppLang } from '@fs/i18n';
import { applyDocumentLang } from '@fs/i18n/fonts';
import { Avatar, Badge, Button, Card, List, ListRow, RadioGroup, useToast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { saveLang } from '../../../app/i18n';
import { usePush } from '../../../pwa/push';
import { useQueue } from '../../../pwa/queue';
import { useLanguageSave, useOwnerName, useSignOut, useStaffMe } from '../api';
import { useFmt } from '../lib/format';
import { ScreenHeader } from '../shell/ScreenHeader';

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
              {me.user.phone}
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
                onClick={() =>
                  void push
                    .enable()
                    .catch(() => toast({ tone: 'error', title: t('errors:generic') }))
                }
              >
                {t('staff:me.notifTurnOn')}
              </Button>
            </div>
          ) : push.state === 'denied' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t('staff:me.notifBlocked')}</p>
              <Button variant="secondary" icon="bell" asChild>
                <Link to="/fix/notifications">{t('staff:me.notifHowTo')}</Link>
              </Button>
            </div>
          ) : push.state === 'granted-subscribed' ? (
            <p className="text-sm text-text-muted">{t('staff:me.notifWhy', { owner })}</p>
          ) : (
            <p className="text-sm text-text-muted">{t('staff:me.notifUnsupported')}</p>
          )}
        </Card>

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
