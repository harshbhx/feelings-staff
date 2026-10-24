/**
 * Small brand-styled building blocks for the auth screens (PRD 12.6 rules: pill buttons, one
 * sindoor button per view, hairlines, 44 px targets, sindoor focus ring, hints above fields,
 * errors in --status-absent with an icon). They mirror `@fs/ui` (WP-2) and are swapped for the kit
 * components when it lands; screens import them from here only.
 */
import { type ButtonHTMLAttributes, type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, type LinkProps } from 'react-router';
import type { ErrorCopy } from '../lib/errors';
import { Icon, type IconName } from './icons';

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent';

const buttonBase = `inline-flex min-h-12 items-center justify-center gap-[0.55em] rounded-full border px-[1.4rem] py-3 text-base leading-[1.1] font-bold transition-[transform,background-color,border-color] duration-(--dur-fast) select-none active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:active:scale-100 ${focusRing}`;

const variants = {
  primary:
    'border-transparent bg-accent-fill text-white hover:bg-sindoor-700 active:bg-sindoor-700 disabled:bg-sindoor-700',
  secondary: 'border-transparent bg-fill text-text active:bg-(--fill-2) disabled:text-text-muted',
  quiet:
    'min-h-11 border-transparent bg-transparent px-2 font-semibold text-accent underline decoration-transparent underline-offset-4 hover:decoration-current active:opacity-60',
} as const;

export type ButtonVariant = keyof typeof variants;

export function buttonClass(variant: ButtonVariant, full = true): string {
  return `${buttonBase} ${variants[variant]} ${full && variant !== 'quiet' ? 'w-full' : ''}`;
}

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  icon?: IconName;
  type?: 'button' | 'submit';
  full?: boolean;
}

export function Button({
  variant = 'secondary',
  icon,
  type = 'button',
  full = true,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={`${buttonClass(variant, full)} ${className ?? ''}`} {...rest}>
      {icon ? <Icon name={icon} className="size-[1.2em]" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'secondary',
  icon,
  full = true,
  className,
  children,
  ...rest
}: LinkProps & { variant?: ButtonVariant; icon?: IconName; full?: boolean }) {
  return (
    <Link className={`${buttonClass(variant, full)} ${className ?? ''}`} {...rest}>
      {icon ? <Icon name={icon} className="size-[1.2em]" /> : null}
      {children}
    </Link>
  );
}

/** An external link drawn as a secondary pill (tel:, wa.me). */
export function ExternalButton({
  href,
  icon,
  children,
}: {
  href: string;
  icon?: IconName;
  children: ReactNode;
}) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      className={buttonClass('secondary')}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {icon ? <Icon name={icon} className="size-[1.2em]" /> : null}
      {children}
    </a>
  );
}

/** Small underlined text link (footer "Owner sign-in", "Forgot PIN?"). */
export function TextLink({ className, ...rest }: LinkProps) {
  return (
    <Link
      className={`inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-semibold text-text underline decoration-border-control underline-offset-4 hover:decoration-text ${focusRing} ${className ?? ''}`}
      {...rest}
    />
  );
}

export function Title({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h1
      id={id}
      tabIndex={-1}
      className="text-[length:var(--text-title)] leading-[1.15] font-extrabold tracking-[-0.03em] text-balance text-text focus:outline-none"
    >
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-base text-pretty text-text-body">{children}</p>;
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg leading-[1.2] font-bold tracking-[-0.01em] text-text">
      {children}
    </h2>
  );
}

/**
 * Form-level error: plain words with an icon, announced. Unexpected failures carry the request id
 * in a "Details" disclosure for support (PRD 5 "Error").
 */
export function ErrorNote({
  id,
  children,
  requestId,
}: {
  id?: string | undefined;
  children: ReactNode;
  requestId?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div id={id} role="alert" className="text-sm font-semibold text-[var(--status-absent)]">
      <p className="flex items-start gap-2">
        <Icon name="warning-circle" className="mt-px" />
        <span>{children}</span>
      </p>
      {requestId ? (
        <details className="mt-1 pl-7 font-normal text-text-muted">
          <summary className={`min-h-11 cursor-pointer py-2 ${focusRing}`}>
            {t('auth:common.details')}
          </summary>
          <p>{t('auth:common.requestId', { id: requestId })}</p>
        </details>
      ) : null}
    </div>
  );
}

/** Render an {@link ErrorCopy} with the screen's text function. */
export function ErrorFromCopy({
  copy,
  text,
  id,
}: {
  copy: ErrorCopy | null;
  text: (c: ErrorCopy) => string;
  id?: string | undefined;
}) {
  if (!copy) return null;
  return (
    <ErrorNote id={id} requestId={copy.requestId}>
      {text(copy)}
    </ErrorNote>
  );
}

export interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label, hint above the control (the keyboard never covers it), error below with an icon. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-text">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <div className="mt-2">
        {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      </div>
      {error ? (
        <p
          id={errorId}
          className="mt-2 flex items-start gap-2 text-sm font-semibold text-[var(--status-absent)]"
        >
          <Icon name="warning-circle" className="mt-px" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export const inputClass = `block min-h-[3.25rem] w-full rounded-sm border border-border-control bg-bg px-4 py-[0.8rem] text-base text-text placeholder:text-text-muted hover:border-text focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent aria-[invalid=true]:border-accent`;

/** Field chrome around an input with a fixed prefix, e.g. +91. */
export const prefixedClass =
  'flex min-h-[3.25rem] w-full items-stretch rounded-sm border border-border-control bg-bg hover:border-text focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent has-[[aria-invalid=true]]:border-accent';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-border bg-bg p-5 ${className ?? ''}`}>{children}</div>
  );
}

export type ChipTone = 'waiting' | 'approved' | 'rejected';

/** Status = colour + icon + word (PRD 12.3, 12.11 #12). */
export function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  const look = {
    waiting: 'border border-dashed border-border-control bg-bg text-[var(--status-flag)]',
    approved: 'bg-[var(--status-present-bg)] text-[var(--status-present)]',
    rejected: 'bg-[var(--status-absent-bg)] text-[var(--status-absent)]',
  }[tone];
  const icon: IconName =
    tone === 'waiting' ? 'hourglass' : tone === 'approved' ? 'check-circle' : 'x-circle';
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${look}`}
    >
      <Icon name={icon} className="size-[1.15em]" />
      {children}
    </span>
  );
}

/** Still blocks in --bg-tint that keep the final layout (no spinners, no shimmer). */
export function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`rounded-sm bg-bg-tint ${className}`} />;
}

/** "Step 2 of 4" with a hairline progress track. */
export function Stepper({ step, total }: { step: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-text-muted">
        {t('auth:common.stepOf', { step, total })}
      </p>
      <div className="mt-2 flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative track
            key={i}
            className={`h-1 flex-1 rounded-full ${i < step ? 'bg-text' : 'bg-border'}`}
          />
        ))}
      </div>
    </div>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('auth:common.back')}
      className={`-ml-3 inline-flex size-11 items-center justify-center rounded-full text-text hover:bg-bg-soft ${focusRing}`}
    >
      <Icon name="caret-left" />
    </button>
  );
}
