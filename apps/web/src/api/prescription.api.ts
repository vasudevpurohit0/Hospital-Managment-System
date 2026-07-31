import { apiFetch } from './http';

export interface PrescriptionItemPayload {
  medicineName: string;
  dose: string;
  frequency: string;
  duration: string;
}

export interface CreatePrescriptionPayload {
  visitId: string;
  symptoms?: string;
  examinationNotes?: string;
  diagnosisText: string;
  followUpFlag?: boolean;
  admissionRecommended?: boolean;
  items: PrescriptionItemPayload[];
  labTests?: string[];
}

export interface PrescriptionRecord {
  id: string;
  visitId: string;
  doctorId: string;
  status: 'DRAFT' | 'SIGNED' | 'PARTIALLY_DISPENSED' | 'CLOSED';
  signedAt: string | null;
  createdAt: string;
  items: {
    id: string;
    medicineName: string;
    dose: string;
    frequency: string;
    duration: string;
    dispenseStatus: string;
  }[];
}

export async function createPrescription(
  payload: CreatePrescriptionPayload,
  token: string,
): Promise<{ diagnosis: Record<string, unknown>; prescription: PrescriptionRecord }> {
  return apiFetch(
    '/api/prescriptions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create prescription',
  );
}

export async function signPrescription(id: string, token: string): Promise<PrescriptionRecord> {
  return apiFetch<PrescriptionRecord>(
    `/api/prescriptions/${id}/sign`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    'Failed to sign prescription',
  );
}
