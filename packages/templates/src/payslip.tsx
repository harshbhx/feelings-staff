/** Payslip (PRD 4.14, Form V style): one component for the screen, the PDF and the print fallback. */
import { formatRupees, type PayslipLine, type PayslipView } from '@fs/contracts';
import { renderSVG } from 'uqr';
import { dmy, type T } from './types';

const money = (paise: number) => formatRupees(paise);

function Lines({ lines, t }: { lines: PayslipLine[]; t: T }) {
  if (lines.length === 0) {
    return (
      <tr>
        <td colSpan={3} className="muted">
          {t('payslip:none')}
        </td>
      </tr>
    );
  }
  return (
    <>
      {lines.map((l, i) => (
        // Lines of one code can repeat (one salary line per salary part), so the index joins the key.
        <tr key={`${l.code}-${l.refId ?? i}`}>
          <td>{l.label}</td>
          <td className="formula">{l.formula}</td>
          <td className="num">{money(Math.abs(l.amountPaise))}</td>
        </tr>
      ))}
    </>
  );
}

export interface PayslipDocumentProps {
  view: PayslipView;
  t: T;
  /** Printed across a payslip that a later revision replaced. */
  watermark?: string | null;
  /** When the fallback page is shown instead of a PDF. */
  generatedOn?: string;
  showVerify?: boolean;
}

export function PayslipDocument({
  view,
  t,
  watermark,
  generatedOn,
  showVerify = true,
}: PayslipDocumentProps) {
  const r = view.result;
  const earnings = r.lines.filter((l) => l.kind === 'earning');
  const deductions = r.lines.filter((l) => l.kind === 'deduction');
  const rounding = r.lines.filter((l) => l.kind === 'rounding');
  const c = r.counts;
  const mark =
    watermark ??
    (view.status === 'superseded'
      ? t('payslip:watermark.superseded', { rev: view.revision + 1 })
      : null);
  return (
    <article className="fs-doc" data-testid="payslip">
      {mark ? <div className="fs-watermark">{mark}</div> : null}
      <header className="fs-head">
        <div>
          <h1>{view.org.name}</h1>
          {view.org.address ? <div className="muted">{view.org.address}</div> : null}
        </div>
        <div className="num">
          <strong>{t('payslip:title')}</strong>
          <div>{t('payslip:forMonth', { month: view.month })}</div>
          <div className="muted">{t('payslip:revision', { n: view.revision })}</div>
          {view.status === 'draft' ? <div>{t('payslip:draft')}</div> : null}
        </div>
      </header>

      <section className="fs-grid">
        <div>
          <span className="muted">{t('payslip:person.name')}</span>
          <span>{view.person.name}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:person.code')}</span>
          <span>{view.person.employeeCode ?? '-'}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:person.designation')}</span>
          <span>{view.person.designation ?? '-'}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:person.joined')}</span>
          <span>{dmy(view.person.joinDate)}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:days.inMonth')}</span>
          <span>{r.daysInMonth}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:days.paid')}</span>
          <span>{c.paidDays}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:days.counts')}</span>
          <span>{`P ${c.P} · H ${c.H} · A ${c.A} · L ${c.L} · WO ${c.WO} · HO ${c.HO}`}</span>
        </div>
        <div>
          <span className="muted">{t('payslip:rate', { days: r.divisorDays })}</span>
          <span>{money(r.dailyRatePaise)}</span>
        </div>
      </section>

      <div className="fs-two">
        <section>
          <h2>{t('payslip:earnings')}</h2>
          <table>
            <tbody>
              <Lines lines={earnings} t={t} />
              <tr className="total">
                <td colSpan={2}>{t('payslip:gross')}</td>
                <td className="num">{money(r.grossPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2>{t('payslip:deductions')}</h2>
          <table>
            <tbody>
              <Lines lines={deductions} t={t} />
              <tr className="total">
                <td colSpan={2}>{t('payslip:totalDeductions')}</td>
                <td className="num">{money(r.deductionsPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <table>
        <tbody>
          {rounding.map((l) => (
            <tr key={l.code}>
              <td>{t('payslip:rounding')}</td>
              <td className="formula">{l.formula}</td>
              <td className="num">{formatRupees(l.amountPaise)}</td>
            </tr>
          ))}
          <tr className="net">
            <td colSpan={2}>{t('payslip:net')}</td>
            <td className="num">{money(r.netPaise)}</td>
          </tr>
        </tbody>
      </table>

      <p className="muted">
        {view.paid
          ? t('payslip:paid.on', {
              date: dmy(view.paid.on),
              mode: t(`payslip:mode.${view.paid.mode}`),
            })
          : t('payslip:paid.not')}
      </p>

      {view.leaveBalances.length > 0 ? (
        <>
          <h2>{t('payslip:leaveBalances')}</h2>
          <table>
            <tbody>
              {view.leaveBalances.map((b) => (
                <tr key={b.code}>
                  <td>{b.name}</td>
                  <td className="num">{b.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {r.warnings.length > 0 ? (
        <ul className="muted">
          {r.warnings.map((w) => (
            <li key={`${w.code}-${w.message}`}>{w.message}</li>
          ))}
        </ul>
      ) : null}

      {showVerify && view.verifyUrl ? (
        <div className="fs-verify">
          <span
            role="img"
            aria-label={t('payslip:verify.qrLabel')}
            // The SVG is generated here from the verify URL; it contains no user input markup.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: static QR SVG from uqr
            dangerouslySetInnerHTML={{ __html: renderSVG(view.verifyUrl, { border: 1 }) }}
          />
          <div>
            <strong>{t('payslip:verify.title')}</strong>
            <div className="muted">{t('payslip:verify.text', { url: view.verifyUrl })}</div>
          </div>
        </div>
      ) : null}
      <footer className="fs-foot">
        {t('payslip:footer', {
          date:
            generatedOn ?? dmy(new Date(view.generatedAt + 19_800_000).toISOString().slice(0, 10)),
        })}
      </footer>
    </article>
  );
}
