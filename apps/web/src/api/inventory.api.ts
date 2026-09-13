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

export interface MedicineImportItem {
  rowNum: number;
  genericName: string;
  brandName?: string;
  category: string;
  strength: string;
  dosageForm: string;
  status: 'VALID' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING' | 'INVALID';
  reason: string;
}

export interface MedicineImportValidationResult {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  items: MedicineImportItem[];
  validItems: Array<{
    genericName: string;
    brandName?: string;
    category: string;
    strength: string;
    dosageForm: string;
  }>;
  rejectedItems: MedicineImportItem[];
}

export interface MedicineImportConfirmResult {
  importedCount: number;
  skippedCount: number;
  message: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function downloadMedicineTemplate(token?: string): Promise<void> {
  const res = await apiFetch('/api/inventory/medicines/template', {}, token);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to download medicine import template');
  }
  const blob = await res.blob();
  downloadBlob(blob, 'medicine_import_template.xlsx');
}

export async function validateMedicineImport(
  file: File,
  token?: string,
): Promise<MedicineImportValidationResult> {
  const fileBase64 = await fileToBase64(file);
  const res = await apiFetch(
    '/api/inventory/medicines/import/validate',
    {
      method: 'POST',
      body: JSON.stringify({ fileBase64 }),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Validation failed for medicine import file');
  }
  return res.json();
}

export async function confirmMedicineImport(
  items: Array<{
    genericName: string;
    brandName?: string;
    category: string;
    strength: string;
    dosageForm: string;
  }>,
  token?: string,
): Promise<MedicineImportConfirmResult> {
  const res = await apiFetch(
    '/api/inventory/medicines/import/confirm',
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to import medicines into Medicine Master');
  }
  return res.json();
}

export async function downloadImportErrorReport(
  rejectedItems: MedicineImportItem[],
  token?: string,
): Promise<void> {
  const res = await apiFetch(
    '/api/inventory/medicines/import/error-report',
    {
      method: 'POST',
      body: JSON.stringify({ rejectedItems }),
    },
    token,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to download error report');
  }
  const blob = await res.blob();
  downloadBlob(blob, 'medicine_import_errors.xlsx');
}

