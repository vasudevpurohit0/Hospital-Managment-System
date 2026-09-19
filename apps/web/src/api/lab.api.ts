import { apiFetch } from './client';

export interface LabTestSummary {
  id: string;
  code: string;
  name: string;
  discipline: string;
  specimenType: string;
  containerType: string | null;
  turnaroundHours: number;
  active: boolean;
  service: { code: string; name: string } | null;
  _count: { parameters: number };
}

export interface LabTestParameter {
  id: string;
  name: string;
  groupLabel: string | null;
  unit: string | null;
  resultType: 'NUMERIC' | 'TEXT' | 'SELECT';
  selectOptions: string[];
  isCalculated: boolean;
  sortOrder: number;
  ranges: { id: string; displayText: string; sex: string }[];
}

export interface LabTestDetail extends LabTestSummary {
  parameters: LabTestParameter[];
}

export type LabOrderStatus =
  | 'ORDERED'
  | 'SAMPLE_COLLECTED'
  | 'PROCESSING'
  | 'RESULT_ENTERED'
  | 'VERIFIED'
  | 'REPORTED'
  | 'CANCELLED';

export interface LabOrderItemRecord {
  id: string;
  labOrderId: string;
  labTestId: string;
  status: string;
  labTest: LabTestSummary;
  results?: { id: string; parameterId: string; value: string; flag: string; parameter: LabTestParameter }[];
}

export interface LabOrderRecord {
  id: string;
  labNumber: string | null;
  visitId: string;
  admissionId: string | null;
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  clinicalNotes: string | null;
  status: LabOrderStatus;
  createdAt: string;
  items: LabOrderItemRecord[];
  sample?: { id: string; sampleCode: string; specimenType: string; collectedAt: string } | null;
  visit?: {
    id: string;
    employee: { name: string; employeeId: string; hospitalUid: { uidCode: string } | null };
  };
  orderingDoctor?: { identifier: string; employee?: { name: string } | null };
}

export interface LabReportView {
  labNumber: string | null;
  status: string;
  patient: { uhid: string | null; employeeId: string; name: string; age: number | null; gender: string | null };
  opdOrIpdReference: string | null;
  referringDoctor: string;
  sampleDate: string | null;
  reportDate: string | null;
  panels: {
    testName: string;
    discipline: string;
    results: {
      parameter: string;
      groupLabel: string | null;
      value: string;
      unit: string | null;
      range: string | null;
      flag: string;
      interpretation: string | null;
    }[];
  }[];
  verification: { technician: string | null; pathologist: string; verifiedAt: string; remarks: string | null };
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg || fallback);
  }
  return res.json();
}

/** The Lab Test Master catalogue (Feature 6) — real tests, never free text. */
export async function fetchLabTests(token?: string, discipline?: string): Promise<LabTestSummary[]> {
  const qs = discipline ? `?discipline=${encodeURIComponent(discipline)}` : '';
  const res = await apiFetch(`/api/lab/tests${qs}`, {}, token);
  return unwrap(res, 'Failed to load lab test catalogue');
}

export async function fetchLabTest(id: string, token?: string): Promise<LabTestDetail> {
  const res = await apiFetch(`/api/lab/tests/${id}`, {}, token);
  return unwrap(res, 'Failed to load lab test');
}

/** The workbench queue. Pass a status to filter, or a visitId to scope to one patient's orders. */
export async function fetchLabQueue(
  token?: string,
  params?: { status?: LabOrderStatus; visitId?: string },
): Promise<LabOrderRecord[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.visitId) qs.set('visitId', params.visitId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch(`/api/lab/queue${suffix}`, {}, token);
  return unwrap(res, 'Failed to load lab queue');
}

export async function fetchLabOrder(id: string, token?: string): Promise<LabOrderRecord> {
  const res = await apiFetch(`/api/lab/orders/${id}`, {}, token);
  return unwrap(res, 'Failed to load lab order');
}

export async function orderLabTests(
  payload: { visitId: string; admissionId?: string; labTestIds: string[]; priority?: string; clinicalNotes?: string },
  token?: string,
): Promise<LabOrderRecord> {
  const res = await apiFetch('/api/lab/orders', { method: 'POST', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to order lab tests');
}

export async function collectSample(
  labOrderId: string,
  specimenType: string | undefined,
  token?: string,
): Promise<LabOrderRecord> {
  const res = await apiFetch(
    `/api/lab/orders/${labOrderId}/collect`,
    { method: 'POST', body: JSON.stringify({ specimenType }) },
    token,
  );
  return unwrap(res, 'Failed to collect sample');
}

export async function enterLabResults(
  payload: { labOrderItemId: string; results: { parameterId: string; value: string }[] },
  token?: string,
): Promise<LabOrderItemRecord> {
  const res = await apiFetch('/api/lab/results', { method: 'POST', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to save lab results');
}

export async function verifyLabOrder(
  labOrderId: string,
  pathologistRemarks: string | undefined,
  token?: string,
): Promise<LabOrderRecord> {
  const res = await apiFetch(
    `/api/lab/orders/${labOrderId}/verify`,
    { method: 'POST', body: JSON.stringify({ pathologistRemarks }) },
    token,
  );
  return unwrap(res, 'Failed to verify and release report');
}

export async function fetchLabReport(labOrderId: string, token?: string): Promise<LabReportView> {
  const res = await apiFetch(`/api/lab/orders/${labOrderId}/report`, {}, token);
  return unwrap(res, 'Failed to load lab report');
}

/** Downloads the real Puppeteer-rendered PDF and triggers a browser save. */
export async function downloadLabReportPdf(labOrderId: string, labNumber: string | null, token?: string): Promise<void> {
  const res = await apiFetch(`/api/lab/orders/${labOrderId}/report/pdf`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to generate report PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(labNumber ?? labOrderId).replace(/\//g, '-')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
