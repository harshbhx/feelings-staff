/** Payslip and register templates (owner: WP-5). Same component renders on screen and in the PDF. */
export { PRINT_CSS } from './css';
export { type HtmlOptions, renderDocument } from './html';
export { PayslipDocument, type PayslipDocumentProps } from './payslip';
export { RegisterDocument, SalaryRegisterDocument } from './register';
export type {
  OrgHead,
  RegisterData,
  RegisterRow,
  SalaryRegisterData,
  SalaryRegisterRow,
  T,
} from './types';
export { dmy } from './types';
