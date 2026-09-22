import React, { useEffect, useState } from 'react';
import { getDashboardSummary, DashboardSummary } from '../../api/platform.api';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { DataTable, Column } from '../../components/ui/DataTable';
import {
  Building2,
  Users,
  Stethoscope,
  BedDouble,
  UserCog,
  IndianRupee,
  RefreshCw,
  AlertTriangle,
  Hourglass,
  PackageX,
  ServerCrash,
} from 'lucide-react';
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { formatDateTimeDefault } from '../../utils/date';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#1E8A4F',
  PROVISIONING: '#F97D09',
  SUSPENDED: '#DC2626',
};

function currency(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export const PlatformDashboardScreen: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await getDashboardSummary());
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !summary) {
    return <div className="p-10 text-center text-sm text-[var(--color-text-tertiary)]">Loading platform dashboard...</div>;
  }

  if (error) {
    return <div className="alert-danger">{error}</div>;
  }

  if (!summary) return null;

  const { hospitalCounts, totals, perHospital, attentionNeeded } = summary;
  const hasAttention =
    attentionNeeded.stuckProvisioning.length > 0 ||
    attentionNeeded.lowStockHospitals.length > 0 ||
    attentionNeeded.failedToLoad.length > 0;

  const statusData = [
    { name: 'Active', value: hospitalCounts.active, key: 'ACTIVE' },
    { name: 'Provisioning', value: hospitalCounts.provisioning, key: 'PROVISIONING' },
    { name: 'Suspended', value: hospitalCounts.suspended, key: 'SUSPENDED' },
  ].filter((d) => d.value > 0);

  const revenueData = perHospital.map((h) => ({ name: h.hospitalName, revenue: h.revenueCollected }));

  const columns: Column<(typeof perHospital)[number]>[] = [
    { key: 'hospitalName', header: 'Hospital', sortable: true },
    {
      key: 'status',
      header: 'Status',
      render: (h) => (
        <Badge variant={h.status === 'ACTIVE' ? 'success' : h.status === 'SUSPENDED' ? 'danger' : 'warning'}>
          {h.status}
        </Badge>
      ),
    },
    { key: 'totalPatients', header: 'Patients', sortable: true },
    { key: 'todayOpdVisits', header: 'OPD Today', sortable: true },
    { key: 'activeAdmissions', header: 'Admissions', sortable: true },
    { key: 'bedOccupancyRate', header: 'Bed Occ.', render: (h) => `${h.bedOccupancyRate}%` },
    { key: 'staffCount', header: 'Staff', sortable: true },
    { key: 'revenueCollected', header: 'Revenue', render: (h) => currency(h.revenueCollected) },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pr-10 pointer-events-none">
          <Building2 className="w-64 h-64" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold text-primary-200 mb-3 border border-white/10">
              <Building2 className="w-3.5 h-3.5 text-secondary-400" />
              Platform Console
            </div>
            <h1 className="text-2xl font-bold">Every hospital, one view</h1>
            <p className="text-sm text-primary-200/80 mt-1">
              {hospitalCounts.active} active, {hospitalCounts.suspended} suspended, {hospitalCounts.provisioning}{' '}
              provisioning across {hospitalCounts.total} total hospitals.
            </p>
          </div>
          <button onClick={load} className="btn btn-secondary gap-2 self-start md:self-auto">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Hospitals" value={hospitalCounts.total} icon={Building2} variant="primary" />
        <StatCard title="Total Patients" value={totals.totalPatients.toLocaleString('en-IN')} icon={Users} variant="info" />
        <StatCard title="OPD Visits Today" value={totals.todayOpdVisits} icon={Stethoscope} variant="secondary" />
        <StatCard title="Active Admissions" value={totals.activeAdmissions} icon={BedDouble} variant="warning" />
        <StatCard title="Staff" value={totals.staffCount} icon={UserCog} variant="primary" />
        <StatCard title="Revenue Collected" value={currency(totals.revenueCollected)} icon={IndianRupee} variant="success" />
      </div>

      {hasAttention && (
        <div className="alert-warning">
          <div className="flex items-center gap-2 font-bold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Needs attention
          </div>
          <div className="space-y-1.5">
            {attentionNeeded.stuckProvisioning.map((h) => (
              <p key={h.id} className="text-xs flex items-start gap-1.5">
                <Hourglass className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>{h.name}</strong> has been stuck in PROVISIONING since{' '}
                  {formatDateTimeDefault(h.createdAt)} — onboarding may have failed partway.
                </span>
              </p>
            ))}
            {attentionNeeded.lowStockHospitals.map((h) => (
              <p key={h.id} className="text-xs flex items-start gap-1.5">
                <PackageX className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>{h.name}</strong> has {h.lowStockAlerts} low-stock inventory alert
                  {h.lowStockAlerts === 1 ? '' : 's'}.
                </span>
              </p>
            ))}
            {attentionNeeded.failedToLoad.map((h) => (
              <p key={h.id} className="text-xs flex items-start gap-1.5">
                <ServerCrash className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Could not load metrics for <strong>{h.name}</strong>
                  {h.error ? `: ${h.error}` : '.'}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 flex flex-col justify-between lg:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">Hospital Status</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">Breakdown across the platform</p>
            </div>
            <Badge variant="neutral">Live</Badge>
          </div>

          {statusData.length === 0 ? (
            <p className="text-xs text-[var(--color-text-tertiary)] py-8 text-center">No hospitals yet.</p>
          ) : (
            <>
              <div className="h-52 w-full my-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" nameKey="name">
                      {statusData.map((item) => (
                        <Cell key={item.key} fill={STATUS_COLORS[item.key]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
                {statusData.map((item) => (
                  <div key={item.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[item.key] }} />
                      {item.name}
                    </span>
                    <span className="font-semibold text-[var(--color-text-primary)]">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">Revenue by Hospital</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">Collected, all-time</p>
            </div>
            <Badge variant="neutral">Live</Badge>
          </div>

          {revenueData.length === 0 ? (
            <p className="text-xs text-[var(--color-text-tertiary)] py-16 text-center">No active hospitals yet.</p>
          ) : (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-text-tertiary)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-tertiary)" />
                  <Tooltip formatter={(value: number) => currency(value)} />
                  <Bar dataKey="revenue" fill="#062B4F" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <DataTable
        title="Per-Hospital Breakdown"
        subtitle="Live operational metrics for every hospital"
        data={perHospital}
        columns={columns}
        keyExtractor={(h) => h.hospitalId}
        searchableKey="hospitalName"
        searchPlaceholder="Search hospitals..."
      />
    </div>
  );
};
