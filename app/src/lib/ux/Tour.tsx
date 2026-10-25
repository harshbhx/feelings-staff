/**
 * First-login coach marks. Each step lights one control (found by its link, so the phone tab bar
 * and the owner's desktop rail both work) and says what it is for; a step with no visible target
 * is a centred card. Skippable at every step; the caller records that it was seen.
 */
import { Button } from '@fs/ui';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ux.css';

export interface TourStep {
  key: string;
  /** Catalog keys for the card. */
  title: string;
  body: string;
  /** A link to light up, e.g. `/month`; the first visible match wins. */
  href?: string;
  /** Or a CSS selector. */
  selector?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;

function findTarget(step: TourStep): HTMLElement | null {
  const sel = step.selector ?? (step.href ? `nav a[href="${step.href}"]` : null);
  if (!sel) return null;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function measure(step: TourStep): Rect | null {
  const el = findTarget(step);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

export function Tour({
  steps,
  intro = true,
  onClose,
}: {
  steps: readonly TourStep[];
  /** A welcome card before the first step. */
  intro?: boolean;
  /** Called on Done and on Skip, so the caller can remember it was seen. */
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(intro ? -1 : 0);
  const [rect, setRect] = useState<Rect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = index >= 0 ? steps[index] : undefined;

  const update = useCallback(() => setRect(step ? measure(step) : null), [step]);
  useLayoutEffect(() => {
    update();
  }, [update]);
  useEffect(() => {
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [update]);

  // Move focus to the card on every step, so keyboard and screen reader users follow along.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is the trigger
  useEffect(() => {
    card.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const last = index === steps.length - 1;
  const centred = !step || !rect;
  const below = rect ? rect.top + rect.height / 2 < window.innerHeight / 2 : false;
  const cardStyle =
    centred || !rect
      ? undefined
      : below
        ? { top: Math.min(rect.top + rect.height + GAP, window.innerHeight - 220) }
        : { bottom: Math.max(window.innerHeight - rect.top + GAP, 16) };

  return (
    <div className="ux-tour" data-testid="tour">
      {rect ? (
        <div
          key={index}
          className="ux-tour__spot"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="ux-tour__scrim" aria-hidden="true" />
      )}
      <div
        key={index}
        ref={card}
        className="ux-tour__card"
        data-center={centred ? '' : undefined}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ux-tour-title"
        tabIndex={-1}
      >
        <h2 id="ux-tour-title" className="ux-tour__title">
          {step ? t(step.title) : t('ux:tour.welcomeTitle')}
        </h2>
        <p className="ux-tour__body">{step ? t(step.body) : t('ux:tour.welcomeBody')}</p>
        <div className="ux-tour__meta">
          <span className="ux-tour__dots" aria-hidden="true">
            {steps.map((s, i) => (
              <i key={s.key} data-on={i === index ? '' : undefined} />
            ))}
          </span>
          {step ? (
            <span className="ux-tour__count">
              {t('ux:tour.step', { current: index + 1, total: steps.length })}
            </span>
          ) : null}
        </div>
        <div className="ux-tour__actions">
          {index > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
              {t('ux:tour.back')}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('ux:tour.skip')}
            </Button>
          )}
          <Button variant="primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>
            {index < 0 ? t('ux:tour.start') : last ? t('ux:tour.done') : t('ux:tour.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
