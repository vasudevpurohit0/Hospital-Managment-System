import { apiFetch } from './client';

async function downloadCsv(path: string, filename: string, token?: string): Promise<void> {
  const res = await apiFetch(path, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to generate report');
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

/** Feature 13 — real CSV exports from the existing report APIs, downloaded straight to the browser. */
export async function downloadBillingReport(
  token?: string,
  range?: { from?: string; to?: string },
): Promise<void> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  await downloadCsv(`/api/reports/billing.csv${suffix}`, 'billing-report.csv', token);
}

export async function downloadOutstandingReport(token?: string): Promise<void> {
  await downloadCsv('/api/reports/outstanding.csv', 'outstanding-report.csv', token);
}

export async function downloadPatientRegisterReport(
  token?: string,
  range?: { from?: string; to?: string },
): Promise<void> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  await downloadCsv(`/api/reports/patient-register.csv${suffix}`, 'patient-register.csv', token);
}
