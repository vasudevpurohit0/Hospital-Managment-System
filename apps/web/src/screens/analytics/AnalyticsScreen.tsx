import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchOperationsAnalytics,
  fetchClinicalAnalytics,
  fetchFinancialAnalytics,
  fetchInventoryAnalytics,
  OperationsAnalytics,
  ClinicalAnalytics,
  FinancialAnalytics,
  InventoryAnalytics,
} from '../../api/analytics.api';
import { StatCard } from '../../components/ui/StatCard';
import {
  BarChart3,
  Users,
  BedDouble,
  Microscope,
  Activity,
  Pill,
  IndianRupee,
  Package,
  RefreshCw,
} from 'lucide-react';

interface AnalyticsScreenProps {
  authToken: string;
}

type Tab = 'operations' | 'clinical' | 'financial' | 'inventory';

const inr = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({ authToken }) => {
  const [tab, setTab] = useState<Tab>('operations');
  const [operations, setOperations] = useState<OperationsAnalytics | null>(null);
  const [clinical, setClinical] = useState<ClinicalAnalytics | null>(null);
  const [financial, setFinancial] = useState<FinancialAnalytics | null>(null);
  const [inventory, setInventory] = useState<InventoryAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ops, clin, fin, inv] = await Promise.all([
        fetchOperationsAnalytics(authToken),
        fetchClinicalAnalytics(authToken),
        fetchFinancialAnalytics(authToken),
        fetchInventoryAnalytics(authToken),
      ]);
      setOperations(ops);
      setClinical(clin);
      setFinancial(fin);
      setInventory(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    load();
  }, [load]);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'operations', label: 'Operations' },
    { id: 'clinical', label: 'Clinical' },
    { id: 'financial', label: 'Financial' },
    { id: 'inventory', label: 'Inventory' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Hospital Analytics</h1>
            <p className="text-xs text-primary-200/80 mt-0.5">
              Every figure is a live aggregate query — never a placeholder (Feature 12/22)
            </p>
          </div>
        </div>
        <button onClick={load} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger text-sm font-semibold">{error}</div>}

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              tab === t.id
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-secondary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-10 text-center text-sm text-[var(--color-text-tertiary)]">Loading analytics…</div>
      ) : (
        <>
          {tab === 'operations' && operations && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="New Registrations" value={operations.registrations} icon={Users} variant="primary" />
                <StatCard title="OPD Visits" value={operations.opd.totalVisits} icon={Activity} variant="info" />
                <StatCard
                  title="Bed Occupancy"
                  value={`${operations.ipd.occupancyRate}%`}
                  subtitle={`${operations.ipd.occupiedBeds} / ${operations.ipd.totalBeds} beds`}
                  icon={BedDouble}
                  variant="warning"
                />
                <StatCard title="Lab Orders" value={operations.laboratory.totalOrders} icon={Microscope} variant="secondary" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard title="IPD Admissions" value={operations.ipd.admissions} subtitle={`${operations.ipd.discharges} discharged`} icon={BedDouble} variant="success" />
                <StatCard title="Therapy Sessions Performed" value={operations.therapy.sessionsPerformed} icon={Activity} variant="primary" />
                <StatCard title="Pharmacy Dispenses" value={operations.pharmacy.dispenseCount} icon={Pill} variant="info" />
              </div>
              <div className="card p-5 space-y-3">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
                  OPD Visits by Department
                </h3>
                {operations.opd.byDepartment.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)]">No OPD visits recorded yet.</p>
                ) : (
                  operations.opd.byDepartment
                    .sort((a, b) => b.count - a.count)
                    .map((d) => {
                      const max = Math.max(...operations.opd.byDepartment.map((x) => x.count), 1);
                      return (
                        <div key={d.department} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium text-[var(--color-text-primary)]">{d.department}</span>
                            <span className="font-mono text-[var(--color-text-secondary)]">{d.count}</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                            <div className="h-full bg-primary-500" style={{ width: `${(d.count / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}

          {tab === 'clinical' && clinical && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard title="Total Lab Orders" value={clinical.laboratory.totalOrders} icon={Microscope} variant="primary" />
              <StatCard title="Reports Verified" value={clinical.laboratory.verifiedReports} icon={Microscope} variant="success" />
              <StatCard title="Pending Verification" value={clinical.laboratory.pendingVerification} icon={Microscope} variant="warning" />
              <StatCard
                title="Avg. Turnaround"
                value={clinical.laboratory.averageTurnaroundHours !== null ? `${clinical.laboratory.averageTurnaroundHours} hrs` : '—'}
                subtitle="Sample collected → report released"
                icon={Activity}
                variant="info"
              />
              <StatCard title="Abnormal Results" value={clinical.laboratory.abnormalResultCount} icon={Activity} variant="danger" />
            </div>
          )}

          {tab === 'financial' && financial && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Gross Billed" value={inr(financial.totalAmount)} icon={IndianRupee} variant="primary" />
                <StatCard title="Collected" value={inr(financial.paidAmount)} icon={IndianRupee} variant="success" />
                <StatCard title="Outstanding" value={inr(financial.outstandingAmount)} icon={IndianRupee} variant="warning" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card p-5 space-y-3">
                  <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
                    Revenue by Category
                  </h3>
                  {financial.byCategory.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-tertiary)]">No charges posted yet.</p>
                  ) : (
                    financial.byCategory.map((c) => {
                      const max = Math.max(...financial.byCategory.map((x) => Number(x.amount)), 1);
                      return (
                        <div key={c.category} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium text-[var(--color-text-primary)]">{c.category}</span>
                            <span className="font-mono text-[var(--color-text-secondary)]">{inr(c.amount)} ({c.count})</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                            <div className="h-full bg-secondary-500" style={{ width: `${(Number(c.amount) / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="card p-5 space-y-2">
                  <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
                    Top Services by Revenue
                  </h3>
                  {financial.topServicesByRevenue.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-tertiary)]">No charges posted yet.</p>
                  ) : (
                    financial.topServicesByRevenue.map((s, i) => (
                      <div key={s.code + i} className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--color-border)] last:border-0">
                        <div>
                          <span className="font-medium text-[var(--color-text-primary)]">{s.service}</span>
                          <span className="text-[var(--color-text-tertiary)] ml-1.5 font-mono">{s.code}</span>
                        </div>
                        <span className="font-mono font-semibold text-[var(--color-text-primary)]">{inr(s.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'inventory' && inventory && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard title="Low Stock Batches" value={inventory.lowStockBatches} icon={Package} variant="warning" />
              <StatCard title="Out of Stock" value={inventory.outOfStockBatches} icon={Package} variant="danger" />
              <StatCard title="Expiring in 30 Days" value={inventory.expiringWithin30Days} icon={Package} variant="warning" />
              <StatCard title="Expiring in 90 Days" value={inventory.expiringWithin90Days} icon={Package} variant="info" />
              <StatCard title="Expired Batches" value={inventory.expiredBatches} icon={Package} variant="danger" />
              <StatCard
                title="Procurement Pipeline"
                value={inventory.procurement.pendingRequisitions}
                subtitle={`${inventory.procurement.openPurchaseOrders} open purchase orders`}
                icon={Package}
                variant="primary"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
