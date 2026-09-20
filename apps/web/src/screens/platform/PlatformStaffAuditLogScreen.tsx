import React, { useEffect, useState } from 'react';
import { ScrollText, Search, X } from 'lucide-react';
import { fetchPlatformStaffAuditLog, AuditLogEntry } from '../../api/audit-log.api';
import { listHospitals, HospitalRecord } from '../../api/platform.api';
import { formatDateTimeMedium as formatTimestamp } from '../../utils/date';

/**
 * Cross-hospital staff Activity Log for Super Admin -- distinct from the
 * existing "Audit Log" page, which records Super Admin's own cross-hospital
 * *access* events (via X-Hospital-Id), not staff actions. This one reads
 * each hospital's own tenant AuditLog table.
 */
export const PlatformStaffAuditLogScreen: React.FC = () => {
  const [hospitals, setHospitals] = useState<HospitalRecord[]>([]);
  const [hospitalId, setHospitalId] = useState('');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<{ total: number; note?: string }>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState('');
  const [actorUserId, setActorUserId] = useState('');

  useEffect(() => {
    listHospitals().then(setHospitals).catch(() => undefined);
  }, []);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchPlatformStaffAuditLog({
      hospitalId: hospitalId || undefined,
      action: action || undefined,
      actorUserId: actorUserId || undefined,
      limit: 50,
    })
      .then((res) => {
        setEntries(res.items);
        setMeta(res.meta);
      })
      .catch((err) => setError(err.message || 'Failed to load activity log'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId, action, actorUserId]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-primary-600" />
          Staff Activity Log
        </h1>
        <p className="text-[var(--color-text-secondary)] text-sm mt-1">
          Cross-hospital staff action audit trail. Pick a hospital for complete, fully-paginated results.
        </p>
      </div>

      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} className="input text-sm py-2">
          <option value="">All Active Hospitals (capped)</option>
          {hospitals.filter((h) => h.status === 'ACTIVE').map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Action contains..."
            className="input text-sm py-2 pl-8 w-full"
          />
        </div>
        {actorUserId && (
          <button onClick={() => setActorUserId('')} className="btn btn-secondary btn-sm gap-1.5">
            <X className="w-3.5 h-3.5" /> Clear User Filter
          </button>
        )}
      </div>

      {meta.note && <div className="alert-warning text-xs">{meta.note}</div>}
      {error && <div className="alert-danger">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-secondary)] text-xs uppercase text-[var(--color-text-tertiary)]">
            <tr>
              <th className="text-left p-3">When</th>
              <th className="text-left p-3">Hospital</th>
              <th className="text-left p-3">User</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Module / Record</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--color-text-tertiary)]">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--color-text-tertiary)]">No activity found.</td></tr>
            ) : (
              entries.map((entry) => (
                <tr key={`${entry.hospitalId ?? ''}-${entry.id}`} className="border-t border-[var(--color-border)]">
                  <td className="p-3 whitespace-nowrap">{formatTimestamp(entry.createdAt)}</td>
                  <td className="p-3">{entry.hospitalName ?? '—'}</td>
                  <td className="p-3">
                    {entry.actorUserId ? (
                      <button onClick={() => setActorUserId(entry.actorUserId!)} className="text-primary-600 hover:underline font-medium">
                        {entry.actorUser?.employee?.name ?? entry.actorUser?.identifier ?? entry.actorUserId}
                      </button>
                    ) : (
                      <span className="text-[var(--color-text-tertiary)]">System</span>
                    )}
                  </td>
                  <td className="p-3">
                    {entry.actorRole}
                    {entry.impersonatorRoleLabel && (
                      <span
                        className="block text-[10px] font-semibold text-amber-700"
                        title="This action was taken during an impersonation session"
                      >
                        via {entry.impersonatorRoleLabel}
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs">{entry.action}</td>
                  <td className="p-3 text-xs">{entry.entityType} <span className="text-[var(--color-text-tertiary)]">#{entry.entityId.slice(0, 8)}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
