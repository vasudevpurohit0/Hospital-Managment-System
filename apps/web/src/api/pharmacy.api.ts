import { apiFetch } from './http';

export interface PharmacyQueueRecord {
  id: string;
  visitId: string;
  status: 'DRAFT' | 'SIGNED' | 'PARTIALLY_DISPENSED' | 'CLOSED';
  signedAt: string;
  visit: {
    id: string;
    patientProfile: {
      id: string;
      fullName: string;
      hospitalUid: string;
      employee: {
        employeeId: string;
        employmentType: {
          code: string;
          name: string;
        };
      };
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

export async function fetchPharmacyQueue(token: string): Promise<PharmacyQueueRecord[]> {
  return apiFetch<PharmacyQueueRecord[]>(
    '/api/pharmacy/queue',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch pharmacy queue',
  );
}

export async function fetchBatchOptions(
  prescriptionId: string,
  token: string,
): Promise<Record<string, MedicineBatchOption[]>> {
  return apiFetch<Record<string, MedicineBatchOption[]>>(
    `/api/pharmacy/prescriptions/${prescriptionId}/batches`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch batch options',
  );
}

export async function dispenseMedicines(
  prescriptionId: string,
  items: Array<{ prescriptionItemId: string; medicineBatchId: string; dispenseQuantity: number }>,
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return apiFetch(
    '/api/pharmacy/dispense',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prescriptionId, items }),
    },
    'Failed to dispense medicines',
  );
}
