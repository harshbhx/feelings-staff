/** Attendance register (muster roll) and salary register print layouts (PRD 4.16). */
import { formatRupees } from '@fs/contracts';
import { dmy, type RegisterData, type SalaryRegisterData, type T } from './types';

const money = (paise: number) => formatRupees(paise);
const monthTitle = (month: string) => `${month.slice(5, 7)}-${month.slice(0, 4)}`;
const generated = (at: number) => dmy(new Date(at + 19_800_000).toISOString().slice(0, 10));

export function RegisterDocument({ data, t }: { data: RegisterData; t: T }) {
  return (
    <article className="fs-doc" data-testid="register">
      <header className="fs-head">
        <div>
          <h1>{data.org.name}</h1>
          {data.org.address ? <div className="muted">{data.org.address}</div> : null}
        </div>
        <div className="num">
          <strong>{t('payslip:register.title')}</strong>
          <div>{monthTitle(data.month)}</div>
        </div>
      </header>
      <table className="fs-reg">
        <thead>
          <tr>
            <th className="name">{t('payslip:register.name')}</th>
            {data.dates.map((d) => (
              <th key={d}>{Number(d.slice(8))}</th>
            ))}
            <th>P</th>
            <th>H</th>
            <th>A</th>
            <th>L</th>
            <th>WO</th>
            <th>HO</th>
            <th>{t('payslip:register.paid')}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={`${row.code ?? ''}-${row.name}`}>
              <td className="name">{row.name}</td>
              {row.cells.map((cell, i) => (
                <td key={data.dates[i]}>{cell}</td>
              ))}
              <td>{row.totals.P}</td>
              <td>{row.totals.H}</td>
              <td>{row.totals.A}</td>
              <td>{row.totals.L}</td>
              <td>{row.totals.WO}</td>
              <td>{row.totals.HO}</td>
              <td>{row.totals.paid}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{t('payslip:register.legend')}</p>
      <footer className="fs-foot">
        {t('payslip:footer', { date: generated(data.generatedAt) })}
      </footer>
    </article>
  );
}

export function SalaryRegisterDocument({ data, t }: { data: SalaryRegisterData; t: T }) {
  const sum = (pick: (r: SalaryRegisterData['rows'][number]) => number) =>
    data.rows.reduce((s, r) => s + pick(r), 0);
  return (
    <article className="fs-doc" data-testid="salary-register">
      <header className="fs-head">
        <div>
          <h1>{data.org.name}</h1>
          {data.org.address ? <div className="muted">{data.org.address}</div> : null}
        </div>
        <div className="num">
          <strong>{t('payslip:salaryRegister.title')}</strong>
          <div>{monthTitle(data.month)}</div>
          <div className="muted">{t('payslip:revision', { n: data.revision })}</div>
        </div>
      </header>
      <table className="fs-reg">
        <thead>
          <tr>
            <th className="name">{t('payslip:register.name')}</th>
            <th>{t('payslip:salaryRegister.rate')}</th>
            <th>{t('payslip:register.paid')}</th>
            <th>{t('payslip:salaryRegister.salary')}</th>
            <th>{t('payslip:salaryRegister.overtime')}</th>
            <th>{t('payslip:salaryRegister.otherEarnings')}</th>
            <th>{t('payslip:gross')}</th>
            <th>{t('payslip:salaryRegister.lop')}</th>
            <th>{t('payslip:salaryRegister.lateEarly')}</th>
            <th>{t('payslip:salaryRegister.advance')}</th>
            <th>{t('payslip:salaryRegister.otherDeductions')}</th>
            <th>{t('payslip:net')}</th>
            <th>{t('payslip:salaryRegister.paidOn')}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.code ?? ''}-${r.name}`}>
              <td className="name">{r.name}</td>
              <td className="num">{money(r.ratePaise)}</td>
              <td>{r.paidDays}</td>
              <td className="num">{money(r.salaryPaise)}</td>
              <td className="num">{money(r.overtimePaise)}</td>
              <td className="num">{money(r.otherEarningsPaise)}</td>
              <td className="num">{money(r.grossPaise)}</td>
              <td className="num">{money(r.lopPaise)}</td>
              <td className="num">{money(r.lateEarlyPaise)}</td>
              <td className="num">{money(r.advancePaise)}</td>
              <td className="num">{money(r.otherDeductionsPaise)}</td>
              <td className="num">{money(r.netPaise)}</td>
              <td>{r.paid ? `${dmy(r.paid.on)} ${t(`payslip:mode.${r.paid.mode}`)}` : '-'}</td>
            </tr>
          ))}
          <tr className="total">
            <td className="name">{t('payslip:salaryRegister.total')}</td>
            <td />
            <td />
            <td className="num">{money(sum((r) => r.salaryPaise))}</td>
            <td className="num">{money(sum((r) => r.overtimePaise))}</td>
            <td className="num">{money(sum((r) => r.otherEarningsPaise))}</td>
            <td className="num">{money(sum((r) => r.grossPaise))}</td>
            <td className="num">{money(sum((r) => r.lopPaise))}</td>
            <td className="num">{money(sum((r) => r.lateEarlyPaise))}</td>
            <td className="num">{money(sum((r) => r.advancePaise))}</td>
            <td className="num">{money(sum((r) => r.otherDeductionsPaise))}</td>
            <td className="num">{money(sum((r) => r.netPaise))}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <footer className="fs-foot">
        {t('payslip:footer', { date: generated(data.generatedAt) })}
      </footer>
    </article>
  );
}
