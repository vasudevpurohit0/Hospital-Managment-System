import { apiFetch } from './client';

export type PatientTimelineEventType =
  | 'REGISTRATION'
  | 'VISIT'
  | 'QUEUE'
  | 'CONSULTATION'
  | 'LAB_ORDER'
  | 'LAB_RESULT'
  | 'PRESCRIPTION'
  | 'MEDICINE_DISPENSED'
  | 'PROCEDURE'
  | 'THERAPY_SESSION'
  | 'ADMISSION'
  | 'BED_MOVEMENT'
  | 'PROGRESS_NOTE'
  | 'DISCHARGE'
  | 'PAYMENT';

export interface PatientTimelineEvent {
  id: string;
  type: PatientTimelineEventType;
  title: string;
  timestamp: string | null;
  timeRecorded: boolean;
  department: string | null;
  location: string | null;
  performedBy: string | null;
  performedByRole: string | null;
  status: string | null;
  visitId: string | null;
  admissionId: string | null;
  sourceId: string;
  details: Record<string, unknown>;
}

export type MedicationEventStage = 'PRESCRIBED' | 'DISPENSED' | 'ADMINISTERED';

export interface MedicationHistoryRow {
  id: string;
  medicineName: string;
  medicineType: 'INVENTORY' | 'CUSTOM';
  stage: MedicationEventStage;
  timestamp: string | null;
  timeRecorded: boolean;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: number | null;
  by: string | null;
  visitId: string | null;
  prescriptionId: string;
  prescriptionItemId: string;
  notRecordedReason?: string;
}

export interface PatientHistoryReport {
  patient: {
    id: string;
    uhid: string | null;
    employeeId: string;
    name: string;
    age: string;
    gender: string;
    dob: string;
    mobile: string;
    address: string;
    employmentType: string;
  };
  hospitalName: string;
  period: { from: string | null; to: string | null };
  summary: {
    totalVisits: number;
    totalAdmissions: number;
    totalConsultations: number;
    totalLabOrders: number;
    totalPrescriptions: number;
    totalMedicines: number;
    totalProcedures: number;
    totalTherapySessions: number;
    totalBills: number;
  };
  events: PatientTimelineEvent[];
  medicationHistory: MedicationHistoryRow[];
  billing: { authorized: boolean; total: number; paid: number; pending: number };
  generatedAt: string;
}

/** The complete, aggregated clinical timeline for one patient — one call, not one-per-tab (Feature: Patient Clinical Timeline). */
export async function fetchPatientTimeline(id: string, token?: string): Promise<PatientHistoryReport> {
  const res = await apiFetch(`/api/patients/${encodeURIComponent(id)}/timeline`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch patient timeline');
  }
  return res.json();
}

/** The real Puppeteer-rendered Clinical Report PDF — not window.print() of the on-screen timeline. */
export async function downloadPatientTimelinePdf(id: string, employeeId: string, token?: string): Promise<void> {
  const res = await apiFetch(`/api/patients/${encodeURIComponent(id)}/timeline/pdf`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to generate clinical report PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Clinical_Report_${employeeId}_${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
