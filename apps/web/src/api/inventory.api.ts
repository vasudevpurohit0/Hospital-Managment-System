import { apiFetch } from './http';

export interface MedicineBatchRecord {
  id: string;
  medicineId: string;
  batchNumber: string;
  manufacturer: string;
  supplierId?: string | null;
  manufacturingDate: string;
  expiryDate: string;
  purchasePrice: number;
  issuePrice: number;
  currentStock: number;
  minimumStockLevel: number;
  reorderLevel: number;
  storageLocation?: string | null;
  stockStatus:
    | 'IN_STOCK'
    | 'EARLY_WARNING'
    | 'CRITICAL_ALERT'
    | 'EXPIRED'
    | 'QUARANTINED'
    | 'DISPOSED';
  medicine?: {
    genericName: string;
    brandName?: string | null;
    category: string;
  } | null;
  supplier?: {
    name: string;
  } | null;
}

export interface MedicineRecord {
  id: string;
  genericName: string;
  brandName?: string | null;
  category: string;
  strength: string;
  dosageForm: string;
  batches: MedicineBatchRecord[];
}

export async function fetchMedicines(token: string): Promise<MedicineRecord[]> {
  return apiFetch<MedicineRecord[]>(
    '/api/inventory/medicines',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch inventory medicines',
  );
}

export async function createMedicine(
  payload: {
    genericName: string;
    brandName?: string;
    category: string;
    strength: string;
    dosageForm: string;
  },
  token: string,
): Promise<MedicineRecord> {
  return apiFetch<MedicineRecord>(
    '/api/inventory/medicines',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create medicine entry',
  );
}

export async function createBatch(
  payload: {
    medicineId: string;
    batchNumber: string;
    manufacturer: string;
    manufacturingDate: string;
    expiryDate: string;
    purchasePrice: number;
    issuePrice: number;
    currentStock: number;
    minimumStockLevel?: number;
    reorderLevel?: number;
    storageLocation?: string;
  },
  token: string,
): Promise<MedicineBatchRecord> {
  return apiFetch<MedicineBatchRecord>(
    '/api/inventory/batches',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create batch entry',
  );
}

export async function fetchLowStockAlerts(token: string): Promise<MedicineBatchRecord[]> {
  return apiFetch<MedicineBatchRecord[]>(
    '/api/inventory/low-stock',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch low stock alerts',
  );
}

export async function triggerDailyExpiryScan(token: string): Promise<{
  quarantinedCount: number;
  criticalCount: number;
  earlyCount: number;
  scannedAt: string;
}> {
  return apiFetch(
    '/api/inventory/scan-expiry',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    'Failed to trigger daily expiry scan',
  );
}

export async function fetchExpiringBatches(
  withinDays = 90,
  token: string,
): Promise<MedicineBatchRecord[]> {
  return apiFetch<MedicineBatchRecord[]>(
    `/api/inventory/expiring?within=${withinDays}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch expiring batches',
  );
}

export async function quarantineBatch(
  batchId: string,
  reason: string | undefined,
  token: string,
): Promise<MedicineBatchRecord> {
  return apiFetch<MedicineBatchRecord>(
    `/api/inventory/batches/${batchId}/quarantine`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason }),
    },
    'Failed to quarantine batch',
  );
}

export async function disposeBatch(
  batchId: string,
  payload: { disposalReason: string; notes?: string },
  token: string,
): Promise<MedicineBatchRecord> {
  return apiFetch<MedicineBatchRecord>(
    `/api/inventory/batches/${batchId}/dispose`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to dispose batch',
  );
}
