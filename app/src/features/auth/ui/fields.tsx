/** Phone and join-code fields (PRD 12.6 PhoneField, CodeField): 16 px+, hint above, error below. */
import { useTranslation } from 'react-i18next';
import { formatCodeInput } from '../lib/inputs';
import { Field, inputClass, prefixedClass } from './bits';

export function PhoneField({
  value,
  onChange,
  error,
  hint,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null | undefined;
  hint?: string | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t('auth:fields.phone')} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className={prefixedClass}>
          <span
            aria-hidden="true"
            className="flex items-center border-r border-border pr-3 pl-4 text-base font-semibold text-text-muted tabular-nums"
          >
            {t('auth:fields.phonePrefix')}
          </span>
          <input
            id={id}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="min-w-0 flex-1 bg-transparent px-3 py-[0.8rem] text-base text-text tabular-nums outline-none placeholder:text-text-muted"
            placeholder={t('auth:fields.phonePlaceholder')}
          />
        </div>
      )}
    </Field>
  );
}

export function CodeField({
  value,
  onChange,
  error,
  hint,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null | undefined;
  hint?: string | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t('auth:fields.code')} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name="code"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={9}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(formatCodeInput(e.target.value))}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${inputClass} text-lg font-bold tracking-[0.12em] uppercase tabular-nums`}
          placeholder={t('auth:fields.codePlaceholder')}
        />
      )}
    </Field>
  );
}
