/** Render with the real i18n catalogs, so components read their `ui` strings. */
import { createI18n } from '@fs/i18n';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';

const i18n = await createI18n('en');

export function renderUi(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}
