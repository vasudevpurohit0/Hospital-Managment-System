import React, { useEffect, useState } from 'react';
import { getDashboardSummary, DashboardSummary } from '../../api/platform.api';

function currency(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const KpiCard: React.FC<{ label: string; value: string | number; hint?: string }> = ({ label, value, hint }) => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
);

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
    return <div className="p-10 text-center text-sm text-gray-500">Loading platform dashboard…</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
        <span>❌</span> {error}
      </div>
    );
  }

  if (!summary) return null;

  const { hospitalCounts, totals, perHospital, attentionNeeded } = summary;
  const hasAttention =
    attentionNeeded.stuckProvisioning.length > 0 ||
    attentionNeeded.lowStockHospitals.length > 0 ||
    attentionNeeded.failedToLoad.length > 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>📊</span> Platform Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Live totals across every active hospital ({hospitalCounts.active} active, {hospitalCounts.suspended}{' '}
            suspended, {hospitalCounts.provisioning} provisioning).
          </p>
        </div>
        <button
          onClick={load}
          className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Hospitals" value={hospitalCounts.total} />
        <KpiCard label="Total Patients" value={totals.totalPatients.toLocaleString('en-IN')} />
        <KpiCard label="Today's OPD Visits" value={totals.todayOpdVisits} />
        <KpiCard label="Active Admissions" value={totals.activeAdmissions} />
        <KpiCard label="Staff" value={totals.staffCount} />
        <KpiCard label="Revenue Collected" value={currency(totals.revenueCollected)} />
      </div>

      {hasAttention && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
            <span>⚠️</span> Needs attention
          </h2>
          {attentionNeeded.stuckProvisioning.map((h) => (
            <p key={h.id} className="text-xs text-amber-800">
              <strong>{h.name}</strong> has been stuck in PROVISIONING since{' '}
              {new Date(h.createdAt).toLocaleString()} — onboarding may have failed partway.
            </p>
          ))}
          {attentionNeeded.lowStockHospitals.map((h) => (
            <p key={h.id} className="text-xs text-amber-800">
              <strong>{h.name}</strong> has {h.lowStockAlerts} low-stock inventory alert
              {h.lowStockAlerts === 1 ? '' : 's'}.
            </p>
          ))}
          {attentionNeeded.failedToLoad.map((h) => (
            <p key={h.id} className="text-xs text-amber-800">
              Could not load metrics for <strong>{h.name}</strong>{h.error ? `: ${h.error}` : '.'}
            </p>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Per-hospital breakdown</h2>
        </div>
        {perHospital.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">No active hospitals yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-6 py-3">Hospital</th>
                  <th className="px-6 py-3">Patients</th>
                  <th className="px-6 py-3">OPD Today</th>
                  <th className="px-6 py-3">Admissions</th>
                  <th className="px-6 py-3">Bed Occ.</th>
                  <th className="px-6 py-3">Staff</th>
                  <th className="px-6 py-3">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {perHospital.map((h) => (
                  <tr key={h.hospitalId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-6 py-3.5 font-medium text-gray-900">{h.hospitalName}</td>
                    <td className="px-6 py-3.5">{h.totalPatients}</td>
                    <td className="px-6 py-3.5">{h.todayOpdVisits}</td>
                    <td className="px-6 py-3.5">{h.activeAdmissions}</td>
                    <td className="px-6 py-3.5">{h.bedOccupancyRate}%</td>
                    <td className="px-6 py-3.5">{h.staffCount}</td>
                    <td className="px-6 py-3.5">{currency(h.revenueCollected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
