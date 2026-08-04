export interface PharmacyQueueRecord {
  id: string;
  visitId: string;
  status: 'DRAFT' | 'SIGNED' | 'PARTIALLY_DISPENSED' | 'CLOSED';
  signedAt: string;
  visit: {
    id: string;
    employee: {
      id: string;
      employeeId: string;
      name: string;
      employmentType: {
        code: string;
        name: string;
      };
      patientProfile?: {
        id: string;
        gender?: string;
      } | null;
    };
  };
  items: Array<{
    id: string;
    medicineName: string;
    dose: string;
    frequency: string;
    duration: string;
    dispensedQuantity: number;
    dispenseStatus: 'PENDING' | 'DISPENSED' | 'PARTIALLY_DISPENSED';
    benefitOutcome: 'FREE' | 'COVERED' | 'PAID';
  }>;
}

export interface MedicineBatchOption {
  id: string;
  medicineId: string;
  batchNumber: string;
  manufacturer: string;
  expiryDate: string;
  issuePrice: number;
  currentStock: number;
  stockStatus: string;
}

import { apiFetch } from './client';

export async function fetchPharmacyQueue(token?: string): Promise<PharmacyQueueRecord[]> {
  const res = await apiFetch('/api/pharmacy/queue', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch pharmacy queue');
  }
  return res.json();
}

export async function fetchBatchOptions(
  prescriptionId: string,
  token?: string,
): Promise<Record<string, MedicineBatchOption[]>> {
  const res = await apiFetch(`/api/pharmacy/prescriptions/${prescriptionId}/batches`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch batch options');
  }
  return res.json();
}

export async function dispenseMedicines(
  prescriptionId: string,
  items: Array<{ prescriptionItemId: string; medicineBatchId: string; dispenseQuantity: number }>,
  token?: string,
) {
  const res = await apiFetch(
    '/api/pharmacy/dispense',
    {
      method: 'POST',
      body: JSON.stringify({ prescriptionId, items }),
    },
    token,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to dispense medicines');
  }

  return res.json();
}
