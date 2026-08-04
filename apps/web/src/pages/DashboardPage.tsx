import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { fetchDashboardMetrics, DashboardMetrics } from '../api/dashboard.api';
import {
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Stethoscope,
  Pill,
  DollarSign,
  TrendingUp,
  Building,
  ShieldCheck,
} from 'lucide-react';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const CATEGORY_COLORS = ['#0F4C81', '#0D9488', '#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444'];

export const DashboardPage: React.FC = () => {
  const { user, token } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardMetrics(token || '')
      .then(setMetrics)
      .catch((err: unknown) => {
        setMetricsError(err instanceof Error ? err.message : 'Failed to load dashboard metrics');
      });
  }, [token]);

  const role = user?.role || 'Doctor';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pr-10 pointer-events-none">
          <Building className="w-64 h-64" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold text-primary-200 mb-3 border border-white/10">
            <ShieldCheck className="w-3.5 h-3.5 text-secondary-400" />
            ESIC Hospital Operations Console •{' '}
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome back, {user?.name || 'Doctor'}
          </h1>
          <p className="text-sm text-primary-200/80 mt-1.5 leading-relaxed">
            {role === 'Doctor' &&
              (metrics?.opd
                ? `You have ${metrics.opd.waitingQueue} patients waiting in the OPD queue today.`
                : 'Loading today’s OPD queue...')}
            {role === 'Pharmacist' &&
              (metrics?.billing && metrics.inventory
                ? `${metrics.billing.totalTransactions} prescriptions in the billing ledger. ${metrics.inventory.lowStockAlerts} low-stock alerts.`
                : 'Loading pharmacy summary...')}
            {role === 'StoreManager' &&
              (metrics?.procurement && metrics.inventory
                ? `Inventory summary: ${metrics.procurement.pendingRequisitions} requisitions pending approval. ${metrics.inventory.quarantinedBatches} batches quarantined.`
                : 'Loading inventory summary...')}
            {(role === 'SuperAdmin' || role === 'Administrator') &&
              (metrics?.ipd && metrics.billing
                ? `Hospital operational summary: Bed occupancy at ${metrics.ipd.bedOccupancyRate}%. ${metrics.billing.paidTransactions} paid billing transactions.`
                : 'Loading hospital operational summary...')}
          </p>
        </div>
      </div>

      {metricsError && <div className="alert alert-danger">{metricsError}</div>}

      {/* Role-Specific Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {role === 'Doctor' ? (
          <>
            <StatCard
              title="Today's OPD Visits"
              value={metrics?.opd?.totalVisits ?? '—'}
              icon={Stethoscope}
              variant="primary"
            />
            <StatCard
              title="Waiting Queue"
              value={metrics?.opd ? `${metrics.opd.waitingQueue} Patients` : '—'}
              icon={Clock}
              variant="warning"
            />
            <StatCard
              title="Billing Transactions"
              value={metrics?.billing?.totalTransactions ?? '—'}
              icon={CheckCircle2}
              variant="success"
            />
          </>
        ) : role === 'Pharmacist' ? (
          <>
            <StatCard
              title="Billing Transactions"
              value={metrics?.billing?.totalTransactions ?? '—'}
              icon={Pill}
              variant="primary"
            />
            <StatCard
              title="Low Stock Alerts"
              value={metrics?.inventory?.lowStockAlerts ?? '—'}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Action required in Inventory"
            />
            <StatCard
              title="Revenue Paid Tx"
              value={metrics?.billing?.paidTransactions ?? '—'}
              icon={DollarSign}
              variant="success"
            />
          </>
        ) : (
          <>
            <StatCard
              title="Total OPD Visits"
              value={metrics?.opd?.totalVisits ?? '—'}
              icon={Users}
              variant="primary"
            />
            <StatCard
              title="Active Admissions"
              value={metrics?.ipd?.activeAdmissions ?? '—'}
              icon={Building}
              variant="info"
              subtitle={metrics?.ipd ? `${metrics.ipd.bedOccupancyRate}% bed occupancy` : undefined}
            />
            <StatCard
              title="Low Stock Items"
              value={metrics?.inventory?.lowStockAlerts ?? '—'}
              icon={AlertTriangle}
              variant="danger"
              subtitle="Reorder required"
            />
            <StatCard
              title="Paid Ledger Tx"
              value={metrics?.billing?.paidTransactions ?? '—'}
              icon={TrendingUp}
              variant="success"
            />
          </>
        )}
      </div>

      {/* Ward Category Distribution — real active-admission breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 flex flex-col justify-between lg:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                Ward Category Distribution
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Active admissions by eligibility category
              </p>
            </div>
            <Badge variant="neutral">Live</Badge>
          </div>

          {!metrics?.ipd || metrics.ipd.categorySplit.length === 0 ? (
            <p className="text-xs text-[var(--color-text-tertiary)] py-8 text-center">
              {metrics ? 'No active admissions to chart.' : 'Loading...'}
            </p>
          ) : (
            <>
              <div className="h-52 w-full my-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.ipd.categorySplit}
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={4}
                      dataKey="count"
                      nameKey="category"
                    >
                      {metrics.ipd.categorySplit.map((item, idx) => (
                        <Cell key={item.category || String(idx)} fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
                {metrics.ipd.categorySplit.map((item, idx) => {
                  const total = metrics.ipd.categorySplit.reduce((sum, c) => sum + c.count, 0);
                  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return (
                    <div key={item.category} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                        />
                        Category {item.category}
                      </span>
                      <span className="font-semibold text-[var(--color-text-primary)]">
                        {item.count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
