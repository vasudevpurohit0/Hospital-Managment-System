import { apiFetch } from './http';

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

export async function fetchDashboardMetrics(token: string): Promise<DashboardMetrics> {
  return apiFetch<DashboardMetrics>(
    '/api/dashboard/summary',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch dashboard metrics',
  );
}
