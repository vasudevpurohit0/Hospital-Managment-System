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
