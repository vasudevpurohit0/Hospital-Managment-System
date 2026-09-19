export interface DashboardMetrics {
  opd: {
    totalVisits: number;
    waitingQueue: number;
  };
  ipd: {
    totalAdmissions: number;
    activeAdmissions: number;
    totalBeds: number;
    occupiedBeds: number;
    availableBeds: number;
    bedOccupancyRate: number;
    categorySplit: { category: string; count: number }[];
  };
  inventory: {
    lowStockAlerts: number;
    expiring30Days: number;
    expiring90Days: number;
    quarantinedBatches: number;
    estimatedQuarantinedValue: number;
  };
  procurement: {
    pendingRequisitions: number;
    approvedRequisitions: number;
    openPurchaseOrders: number;
    delayedSuppliers: number;
  };
  billing: {
    totalTransactions: number;
    paidTransactions: number;
    permanentUtilizationPct: number;
    contractualUtilizationPct: number;
  };
  auditExceptions: {
    count: number;
    recentExceptions: { id: string; action: string; detail: string }[];
  };
  staff: {
    totalEmployees: number;
    employeesAddedToday: number;
  };
}

/** Shape varies by role -- see DashboardService.getMySummary() on the backend for the exact fields each role returns. Always `{ role: string, ...a few real counts }`, never fabricated data. */
export interface MyDashboardSummary {
  role: string;
  [key: string]: unknown;
}

import { apiFetch } from './client';

export async function fetchDashboardMetrics(token?: string): Promise<DashboardMetrics> {
  const res = await apiFetch('/api/dashboard/summary', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch dashboard metrics');
  }
  return res.json();
}

export async function fetchMyDashboardSummary(token?: string): Promise<MyDashboardSummary> {
  const res = await apiFetch('/api/dashboard/my-summary', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch personal dashboard summary');
  }
  return res.json();
}
