/**
 * Normalized shape for one row in a patient's clinical timeline. Every field
 * is either a real column read straight from a Prisma record or an explicit
 * `null`/`false` when that data genuinely isn't recorded — nothing here is
 * inferred or invented (Feature: Complete Patient Clinical Timeline, rule
 * "never infer an event from a different one").
 */
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
  /** Stable, unique across the whole report -- `${type}:${sourceId}`. */
  id: string;
  type: PatientTimelineEventType;
  title: string;
  /** ISO timestamp, or null when the underlying record has no timestamp for this event at all (never invented). */
  timestamp: string | null;
  /** false only when `timestamp` is null and the UI/PDF must render "Time not recorded" instead of a blank. */
  timeRecorded: boolean;
  department: string | null;
  location: string | null;
  performedBy: string | null;
  performedByRole: string | null;
  status: string | null;
  visitId: string | null;
  admissionId: string | null;
  /** The id of the underlying DB row this event was built from, for drill-down linking. */
  sourceId: string;
  details: Record<string, unknown>;
}

export type MedicationEventStage = 'PRESCRIBED' | 'DISPENSED' | 'ADMINISTERED';

/**
 * One row of the dedicated Medication History view (prescribed vs dispensed
 * vs administered are kept as separate rows/stages, never merged into one
 * "medicine given" fact -- Feature requirement #16).
 */
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
  /** Set only on an ADMINISTERED row -- this system has no medication-administration (MAR) module, so every such row is always "not recorded", never inferred from prescribing/dispensing. */
  notRecordedReason?: string;
}

export interface PatientHistorySummary {
  totalVisits: number;
  totalAdmissions: number;
  totalConsultations: number;
  totalLabOrders: number;
  totalPrescriptions: number;
  totalMedicines: number;
  totalProcedures: number;
  totalTherapySessions: number;
  totalBills: number;
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
  /** The earliest and latest event timestamps actually found -- not a caller-supplied filter range. */
  period: { from: string | null; to: string | null };
  summary: PatientHistorySummary;
  events: PatientTimelineEvent[];
  medicationHistory: MedicationHistoryRow[];
  billing: {
    /** false when the requesting user holds PatientHistory:read but not Charge:read -- the figures below are then always zero, not merely hidden client-side. */
    authorized: boolean;
    total: number;
    paid: number;
    pending: number;
  };
  generatedAt: string;
}
