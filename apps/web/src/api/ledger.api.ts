import { apiFetch } from './client';

export type ChargeStatus = 'PENDING' | 'PAID' | 'CANCELLED';
export type BenefitOutcome = 'FREE' | 'COVERED' | 'PAID';

export interface LedgerTransaction {
  id: string;
  date: string;
  service: string;
  serviceCode: string | null;
  category: string;
  quantity: string;
  rate: string;
  /** quantity × the configured service rate. There is no discount. */
  totalAmount: string;
  status: ChargeStatus;
  receiptNumber: string | null;
  receiptId: string | null;
}

export interface PatientLedger {
  employeeId: string;
  uhid: string | null;
  name: string;
  summary: {
    totalAmount: string;
    paidAmount: string;
    outstandingAmount: string;
  };
  transactions: LedgerTransaction[];
}

export interface ReceiptLine {
  description: string;
  category: string;
  quantity: string;
  rate: string;
  totalAmount: string;
}

export interface ReceiptDetail {
  id: string;
  receiptNumber: string;
  billingType: string;
  issuedAt: string;
  status: string;
  paymentMode: string;
  patient: {
    uhid: string | null;
    employeeId: string;
    name: string;
    employmentType: string;
    gender: string | null;
  };
  opdDepartment: string | null;
  collectedBy: string | null;
  lines: ReceiptLine[];
  totalAmount: string;
  amountInWords: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

/** Feature 4 — a patient's complete financial history, by Employee ID. */
export async function fetchPatientLedger(
  employeeId: string,
  token?: string,
): Promise<PatientLedger> {
  const res = await apiFetch(`/api/patients/${encodeURIComponent(employeeId)}/ledger`, {}, token);
  return unwrap(res, 'Failed to load patient ledger');
}

export async function cancelCharge(
  chargeId: string,
  reason: string,
  token?: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/charges/${chargeId}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to cancel charge');
  }
}

/** Collects payment for a set of PENDING charges, issuing one receipt. */
export async function issueReceipt(
  chargeIds: string[],
  paymentMode?: 'CASH' | 'UPI' | 'CARD',
  token?: string,
): Promise<ReceiptDetail> {
  const res = await apiFetch(
    '/api/receipts',
    { method: 'POST', body: JSON.stringify({ chargeIds, paymentMode }) },
    token,
  );
  return unwrap(res, 'Failed to issue receipt');
}

export async function fetchReceiptDetail(id: string, token?: string): Promise<ReceiptDetail> {
  const res = await apiFetch(`/api/receipts/${id}`, {}, token);
  return unwrap(res, 'Failed to load receipt');
}

async function downloadPdf(path: string, filename: string, token?: string): Promise<void> {
  const res = await apiFetch(path, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to generate PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The real Puppeteer-rendered receipt PDF (Feature 15) — not window.print() of the on-screen view. */
export async function downloadReceiptPdf(id: string, receiptNumber: string, token?: string): Promise<void> {
  await downloadPdf(`/api/receipts/${id}/pdf`, `${receiptNumber.replace(/\//g, '-')}.pdf`, token);
}

/** The real Puppeteer-rendered patient statement PDF (Feature 14). */
export async function downloadStatementPdf(employeeId: string, token?: string): Promise<void> {
  await downloadPdf(
    `/api/patients/${encodeURIComponent(employeeId)}/statement/pdf`,
    `statement-${employeeId}.pdf`,
    token,
  );
}

export type ExpensePeriod = '1_WEEK' | '15_DAYS' | '1_MONTH';

/**
 * Total patient expenses across all patients for the selected time period
 * (1 Week, 15 Days, or 1 Month) using existing billing/ledger data.
 */
export async function fetchTotalPatientExpenses(
  period: ExpensePeriod,
  token?: string,
): Promise<{ totalAmount: string }> {
  const now = new Date();
  const fromDate = new Date();
  if (period === '1_WEEK') {
    fromDate.setDate(now.getDate() - 7);
  } else if (period === '15_DAYS') {
    fromDate.setDate(now.getDate() - 15);
  } else if (period === '1_MONTH') {
    fromDate.setMonth(now.getMonth() - 1);
  }

  const qs = new URLSearchParams({
    from: fromDate.toISOString(),
    to: now.toISOString(),
  });

  const res = await apiFetch(`/api/charges/summary?${qs.toString()}`, {}, token);
  return unwrap(res, 'Failed to load total patient expenses');
}

/**
 * Downloads a detailed Excel report (.xlsx) breaking down all patient expenses
 * across the selected period (1 Week, 15 Days, or 1 Month) using existing ledger data.
 */
export async function exportPatientExpenseReportExcel(
  period: ExpensePeriod,
  token?: string,
): Promise<void> {
  const now = new Date();
  const fromDate = new Date();
  if (period === '1_WEEK') {
    fromDate.setDate(now.getDate() - 7);
  } else if (period === '15_DAYS') {
    fromDate.setDate(now.getDate() - 15);
  } else if (period === '1_MONTH') {
    fromDate.setMonth(now.getMonth() - 1);
  }

  const qs = new URLSearchParams({
    from: fromDate.toISOString(),
    to: now.toISOString(),
    period,
  });

  const periodSlug = period.toLowerCase().replace(/_/g, '-');
  const dateSlug = now.toISOString().slice(0, 10);
  const filename = `patient-expense-report-${periodSlug}-${dateSlug}.xlsx`;

  const res = await fetch(`/api/charges/export/excel?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Export failed with status ${res.status}`);
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

