import { apiFetch } from './http';

export interface RequisitionRecord {
  id: string;
  raisedBy: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  triggeredByAlert: boolean;
  createdAt: string;
  items: {
    id: string;
    medicineId: string;
    quantity: number;
    medicine?: { genericName: string };
  }[];
  approvals: {
    id: string;
    decision: 'APPROVED' | 'REJECTED';
    notes?: string | null;
    decidedAt: string;
  }[];
  purchaseOrders?: unknown[];
}

export interface PurchaseOrderRecord {
  id: string;
  requisitionId: string;
  supplierId: string;
  issuedBy: string;
  status: 'ISSUED' | 'DISPATCHED' | 'RECEIVED' | 'CLOSED';
  issuedAt: string;
  supplier?: { name: string };
  items: {
    id: string;
    medicineId: string;
    quantity: number;
    unitPrice: number;
    medicine?: { genericName: string };
  }[];
  goodsReceiptNotes?: unknown[];
}

export async function fetchRequisitions(token: string): Promise<RequisitionRecord[]> {
  return apiFetch<RequisitionRecord[]>(
    '/api/procurement/requisitions',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch requisitions',
  );
}

export async function createRequisition(
  payload: {
    items: { medicineId: string; quantity: number }[];
    triggeredByAlert?: boolean;
  },
  token: string,
): Promise<RequisitionRecord> {
  return apiFetch<RequisitionRecord>(
    '/api/procurement/requisitions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create purchase requisition',
  );
}

export async function approveRequisition(
  id: string,
  payload: { decision: 'APPROVED' | 'REJECTED'; notes?: string },
  token: string,
): Promise<unknown> {
  return apiFetch(
    `/api/procurement/requisitions/${id}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to process requisition approval',
  );
}

export async function fetchPurchaseOrders(token: string): Promise<PurchaseOrderRecord[]> {
  return apiFetch<PurchaseOrderRecord[]>(
    '/api/procurement/purchase-orders',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch purchase orders',
  );
}

export async function createPurchaseOrder(
  payload: {
    requisitionId: string;
    supplierId: string;
    items: { medicineId: string; quantity: number; unitPrice: number }[];
  },
  token: string,
): Promise<PurchaseOrderRecord> {
  return apiFetch<PurchaseOrderRecord>(
    '/api/procurement/purchase-orders',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create purchase order',
  );
}

export async function createGRN(
  payload: {
    purchaseOrderId: string;
    items: {
      medicineId: string;
      batchNumber: string;
      manufacturer: string;
      quantity: number;
      manufacturingDate: string;
      expiryDate: string;
      purchasePrice: number;
      issuePrice: number;
      qualityCheckPass?: boolean;
    }[];
  },
  token: string,
): Promise<unknown> {
  return apiFetch(
    '/api/procurement/goods-receipt-notes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to record Goods Receipt Note',
  );
}

export async function createStoreTransfer(
  payload: {
    medicineBatchId: string;
    fromLocation: 'CENTRAL_STORE' | 'PHARMACY';
    toLocation: 'CENTRAL_STORE' | 'PHARMACY';
    quantity: number;
  },
  token: string,
): Promise<unknown> {
  return apiFetch(
    '/api/procurement/transfers',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to execute store transfer',
  );
}
