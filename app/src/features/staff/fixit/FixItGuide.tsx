/**
 * Fix-it guides (PRD 5.1, 4.3.3-4.3.4): location, precise location, camera, notifications, with
 * steps for Android Chrome and iPhone Safari. Each step is plain words plus a drawn settings row
 * (no screenshots of other apps, no stock art). The phone's platform is chosen first; the other
 * one is a tap away.
 */
import { ChipGroup } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isIos, probeBrowser } from '../install/platform';

export type FixItTopic = 'location' | 'precise' | 'camera' | 'notifications';
type Os = 'android' | 'iphone';

interface Step {
  text: string;
  /** A settings row to draw: label and the value to choose. */
  mock?: { label: string; value: string } | undefined;
}

function useSteps(topic: FixItTopic, os: Os): { title: string; steps: Step[] } {
  const { t } = useTranslation();
  const allow = t('staff:fixit.settingAllow');
  const on = t('staff:fixit.settingOn');
  const site = 'staff.feelingsbeautycare.in';
  switch (topic) {
    case 'location':
      return {
        title: t('staff:fixit.location.title'),
        steps:
          os === 'android'
            ? [
                { text: t('staff:fixit.location.android1') },
                { text: t('staff:fixit.location.android2') },
                { text: t('staff:fixit.location.android3'), mock: { label: site, value: allow } },
                { text: t('staff:fixit.location.android4') },
              ]
            : [
                { text: t('staff:fixit.location.iphone1') },
                { text: t('staff:fixit.location.iphone2') },
                {
                  text: t('staff:fixit.location.iphone3'),
                  mock: {
                    label: t('staff:fixit.mock.safariWebsites'),
                    value: t('staff:fixit.settingWhileUsing'),
                  },
                },
                {
                  text: t('staff:fixit.location.iphone4'),
                  mock: { label: t('staff:fixit.mock.precise'), value: on },
                },
              ],
      };
    case 'precise':
      return {
        title: t('staff:fixit.precise.title'),
        steps:
          os === 'android'
            ? [
                { text: t('staff:fixit.precise.android1') },
                {
                  text: t('staff:fixit.precise.android2'),
                  mock: { label: t('staff:fixit.mock.preciseAndroid'), value: on },
                },
              ]
            : [
                { text: t('staff:fixit.precise.iphone1') },
                {
                  text: t('staff:fixit.precise.iphone2'),
                  mock: { label: t('staff:fixit.mock.precise'), value: on },
                },
              ],
      };
    case 'camera':
      return {
        title: t('staff:fixit.camera.title'),
        steps:
          os === 'android'
            ? [
                { text: t('staff:fixit.camera.android1') },
                { text: t('staff:fixit.camera.android2') },
                { text: t('staff:fixit.camera.android3'), mock: { label: site, value: allow } },
                { text: t('staff:fixit.camera.android4') },
              ]
            : [
                { text: t('staff:fixit.camera.iphone1') },
                {
                  text: t('staff:fixit.camera.iphone2'),
                  mock: { label: t('staff:fixit.mock.camera'), value: allow },
                },
              ],
      };
    case 'notifications':
      return {
        title: t('staff:fixit.notifications.title'),
        steps:
          os === 'android'
            ? [
                { text: t('staff:fixit.notifications.android1') },
                { text: t('staff:fixit.notifications.android2') },
                {
                  text: t('staff:fixit.notifications.android3'),
                  mock: { label: site, value: allow },
                },
              ]
            : [
                { text: t('staff:fixit.notifications.iphone1') },
                { text: t('staff:fixit.notifications.iphone2') },
                {
                  text: t('staff:fixit.notifications.iphone3'),
                  mock: { label: t('staff:fixit.mock.appName'), value: on },
                },
              ],
      };
  }
}

export function FixItGuide({
  topic,
  headingLevel = 2,
}: {
  topic: FixItTopic;
  headingLevel?: 1 | 2;
}) {
  const { t } = useTranslation();
  const [os, setOs] = useState<Os>(() => (isIos(probeBrowser()) ? 'iphone' : 'android'));
  const { title, steps } = useSteps(topic, os);
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className="flex flex-col gap-4" data-fixit={topic}>
      <Heading className={headingLevel === 1 ? undefined : 'text-base'}>{title}</Heading>
      <ChipGroup
        legend={t('staff:fixit.platformLabel')}
        legendHidden
        value={os}
        onValueChange={(v) => setOs(v === 'iphone' ? 'iphone' : 'android')}
        options={[
          { value: 'android', label: t('staff:fixit.android') },
          { value: 'iphone', label: t('staff:fixit.iphone') },
        ]}
      />
      <ol className="flex flex-col gap-4">
        {steps.map((s, i) => (
          <li key={s.text} className="flex gap-3">
            <span className="staff-step-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span>{s.text}</span>
              {s.mock ? (
                <span className="staff-mock-row" aria-hidden="true">
                  <span className="min-w-0 truncate">{s.mock.label}</span>
                  <span className="staff-mock-row__value">{s.mock.value}</span>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
