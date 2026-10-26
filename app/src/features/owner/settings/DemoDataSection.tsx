/**
 * Settings, Preview tools, Demo data (preview only): "Load demo data" and "Reset demo data". The
 * Worker answers 404 to these calls outside a preview, and this screen is only offered when the
 * public config says `env: "preview"`. The buttons drive the server's steps one request at a time
 * (demo-run.ts), show the progress, and offer "Try again" at the step that failed. The server keeps
 * the owner signed in through the wipe; if it could not, the screen says so and links to sign-in.
 */
import { isApiError } from '@fs/contracts';
import { Button, ProgressStrip, Sheet } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApi } from '../../../api/provider';
import { isStepUpCancelled, useStepUp } from '../../auth/step-up';
import { useIsPreview } from '../api/demo';
import { Meta } from '../components/layout';
import { Empty, useErrorText } from '../components/states';
import { type DemoMode, type DemoProgress, type DemoRun, newRun, runDemo } from './demo-run';

type View =
  | { kind: 'idle' }
  | { kind: 'running'; progress: DemoProgress }
  | { kind: 'failed'; progress: DemoProgress; reason: string }
  | { kind: 'done' }
  | { kind: 'already' }
  | { kind: 'signed-out' };

export default function DemoDataSection() {
  const { t } = useTranslation();
  const preview = useIsPreview();
  const api = useApi();
  const qc = useQueryClient();
  const { run: guard } = useStepUp();
  const errorText = useErrorText();
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [confirm, setConfirm] = useState(false);
  const current = useRef<DemoRun | null>(null);
  const last = useRef<DemoProgress>({ step: 'seed', done: 0, total: 2 });

  if (!preview) return <Empty>{t('owner:demoData.notHere')}</Empty>;

  async function start(run: DemoRun) {
    current.current = run;
    setView({ kind: 'running', progress: last.current });
    try {
      const outcome = await runDemo(api, run, guard, (p) => {
        last.current = p;
        setView({ kind: 'running', progress: p });
      });
      // Everything on screen came from the old data.
      await qc.invalidateQueries();
      setView({ kind: outcome === 'done' ? 'done' : 'signed-out' });
    } catch (e) {
      if (isApiError(e, 'UNAUTHENTICATED')) return setView({ kind: 'signed-out' });
      if (isApiError(e, 'CONFLICT') && run.mode === 'load' && !run.seeded)
        return setView({ kind: 'already' });
      if (isStepUpCancelled(e))
        return setView({ kind: 'failed', progress: last.current, reason: '' });
      setView({ kind: 'failed', progress: last.current, reason: errorText(e) });
    }
  }

  const begin = (mode: DemoMode) => {
    last.current = { step: 'seed', done: 0, total: 2 };
    void start(newRun(mode));
  };
  const busy = view.kind === 'running';

  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-6">
      <Meta>{t('owner:demoData.intro')}</Meta>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          icon="arrows-clockwise"
          loading={busy}
          loadingLabel={t('owner:demoData.working')}
          onClick={() => begin('load')}
        >
          {t('owner:demoData.load')}
        </Button>
        <Sheet
          open={confirm}
          onOpenChange={setConfirm}
          title={t('owner:demoData.resetTitle')}
          description={t('owner:demoData.resetBody')}
          trigger={
            <Button variant="danger-secondary" disabled={busy}>
              {t('owner:demoData.reset')}
            </Button>
          }
          footer={
            <>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(false);
                  begin('reset');
                }}
              >
                {t('owner:demoData.resetConfirm')}
              </Button>
              <Button onClick={() => setConfirm(false)}>{t('owner:common.cancel')}</Button>
            </>
          }
        />
      </div>
      <Status view={view} onRetry={() => current.current && void start(current.current)} />
    </div>
  );
}

function stepText(t: TFunction, p: DemoProgress): string {
  if (p.step === 'seed') return t('owner:demoData.stepSeed');
  if (p.step === 'finish') return t('owner:demoData.stepFinish');
  return t('owner:demoData.stepRecompute', { done: p.done - 1, total: p.total - 2 });
}

function Status({ view, onRetry }: { view: View; onRetry: () => void }) {
  const { t } = useTranslation();
  if (view.kind === 'running' || view.kind === 'failed') {
    const p = view.progress;
    return (
      <div className="grid gap-3" role="status" aria-live="polite">
        <ProgressStrip
          label={stepText(t, p)}
          segments={[
            {
              key: 'done',
              value: p.done,
              tone: view.kind === 'failed' ? 'absent' : 'present',
              label: stepText(t, p),
            },
          ]}
          total={p.total}
          legend={false}
          description={t('owner:demoData.progress', { done: p.done, total: p.total })}
        />
        {view.kind === 'failed' ? (
          <>
            <p className="font-semibold text-text">
              {t('owner:demoData.failed', { step: stepText(t, p), reason: view.reason })}
            </p>
            <div>
              <Button variant="primary" onClick={onRetry}>
                {t('owner:demoData.retry')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    );
  }
  if (view.kind === 'done')
    return (
      <div className="grid gap-1" role="status">
        <p className="font-semibold text-text">{t('owner:demoData.done')}</p>
        <Meta>{t('owner:demoData.doneHint')}</Meta>
      </div>
    );
  if (view.kind === 'already')
    return (
      <p className="text-text" role="status">
        {t('owner:demoData.already')}
      </p>
    );
  if (view.kind === 'signed-out')
    return (
      <div className="grid gap-3" role="status">
        <p className="text-text">{t('owner:demoData.signedOut')}</p>
        <div>
          <Button variant="primary" icon="sign-in" asChild>
            <Link to="/auth/owner">{t('owner:demoData.signIn')}</Link>
          </Button>
        </div>
      </div>
    );
  return null;
}
