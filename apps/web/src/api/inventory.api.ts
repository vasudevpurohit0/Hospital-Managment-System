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

import { apiFetch } from './client';

export async function fetchMedicines(token?: string): Promise<MedicineRecord[]> {
  const res = await apiFetch('/api/inventory/medicines', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch inventory medicines');
  }
  return res.json();
}

export async function createMedicine(
  payload: {
    genericName: string;
    brandName?: string;
    category: string;
    strength: string;
    dosageForm: string;
  },
  token?: string,
): Promise<MedicineRecord> {
  const res = await apiFetch(
    '/api/inventory/medicines',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create medicine entry');
  }
  return res.json();
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
  token?: string,
): Promise<MedicineBatchRecord> {
  const res = await apiFetch(
    '/api/inventory/batches',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create batch entry');
  }
  return res.json();
}

export async function fetchLowStockAlerts(token?: string): Promise<MedicineBatchRecord[]> {
  const res = await apiFetch('/api/inventory/low-stock', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch low stock alerts');
  }
  return res.json();
}

export async function triggerDailyExpiryScan(token?: string): Promise<{
  quarantinedCount: number;
  criticalCount: number;
  earlyCount: number;
  scannedAt: string;
}> {
  const res = await apiFetch('/api/inventory/scan-expiry', { method: 'POST' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to trigger daily expiry scan');
  }
  return res.json();
}

export async function fetchExpiringBatches(
  withinDays = 90,
  token?: string,
): Promise<MedicineBatchRecord[]> {
  const res = await apiFetch(`/api/inventory/expiring?within=${withinDays}`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch expiring batches');
  }
  return res.json();
}

export async function quarantineBatch(
  batchId: string,
  reason: string | undefined,
  token?: string,
): Promise<MedicineBatchRecord> {
  const res = await apiFetch(
    `/api/inventory/batches/${batchId}/quarantine`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to quarantine batch');
  }
  return res.json();
}

export async function disposeBatch(
  batchId: string,
  payload: { disposalReason: string; notes?: string },
  token?: string,
): Promise<MedicineBatchRecord> {
  const res = await apiFetch(
    `/api/inventory/batches/${batchId}/dispose`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to dispose batch');
  }
  return res.json();
}
