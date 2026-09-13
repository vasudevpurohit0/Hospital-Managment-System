import { apiFetch } from './client';

export interface OperationsAnalytics {
  registrations: number;
  opd: { totalVisits: number; byDepartment: { department: string; count: number }[] };
  ipd: { admissions: number; discharges: number; totalBeds: number; occupiedBeds: number; occupancyRate: number };
  laboratory: { totalOrders: number; byStatus: { status: string; count: number }[] };
  therapy: { sessionsPerformed: number };
  pharmacy: { dispenseCount: number };
}

export interface ClinicalAnalytics {
  laboratory: {
    totalOrders: number;
    verifiedReports: number;
    pendingVerification: number;
    averageTurnaroundHours: number | null;
    abnormalResultCount: number;
  };
}

export interface FinancialAnalytics {
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  byCategory: { category: string; amount: string; count: number }[];
  topServicesByRevenue: { service: string; code: string; amount: string; count: number }[];
}

export interface InventoryAnalytics {
  lowStockBatches: number;
  outOfStockBatches: number;
  expiringWithin30Days: number;
  expiringWithin90Days: number;
  expiredBatches: number;
  procurement: { pendingRequisitions: number; openPurchaseOrders: number };
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

function rangeQuery(range?: { from?: string; to?: string }): string {
  if (!range?.from && !range?.to) return '';
  const qs = new URLSearchParams();
  if (range.from) qs.set('from', range.from);
  if (range.to) qs.set('to', range.to);
  return `?${qs.toString()}`;
}

/** Feature 12/22 — real aggregate queries, never placeholder numbers. */
export async function fetchOperationsAnalytics(
  token?: string,
  range?: { from?: string; to?: string },
): Promise<OperationsAnalytics> {
  const res = await apiFetch(`/api/analytics/operations${rangeQuery(range)}`, {}, token);
  return unwrap(res, 'Failed to load operations analytics');
}

export async function fetchClinicalAnalytics(
  token?: string,
  range?: { from?: string; to?: string },
): Promise<ClinicalAnalytics> {
  const res = await apiFetch(`/api/analytics/clinical${rangeQuery(range)}`, {}, token);
  return unwrap(res, 'Failed to load clinical analytics');
}

export async function fetchFinancialAnalytics(
  token?: string,
  range?: { from?: string; to?: string },
): Promise<FinancialAnalytics> {
  const res = await apiFetch(`/api/analytics/financial${rangeQuery(range)}`, {}, token);
  return unwrap(res, 'Failed to load financial analytics');
}

export async function fetchInventoryAnalytics(token?: string): Promise<InventoryAnalytics> {
  const res = await apiFetch('/api/analytics/inventory', {}, token);
  return unwrap(res, 'Failed to load inventory analytics');
}
