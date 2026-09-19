import React, { useEffect, useState } from 'react';
import { ScrollText, Download, Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { fetchAuditLog, exportAuditLogCsv, AuditLogEntry } from '../../api/audit-log.api';

interface ActivityLogScreenProps {
  authToken: string;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Hospital Administrator's own-hospital Activity Log -- tenant isolation is
 * structural (TenantResolutionMiddleware resolves the schema from this JWT
 * alone), so this screen never needs a hospital picker; the Super Admin
 * cross-hospital equivalent lives in the Platform Console instead.
 */
export const ActivityLogScreen: React.FC<ActivityLogScreenProps> = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalPages?: number }>({ total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [actorUserId, setActorUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = { actorUserId: actorUserId || undefined, action: action || undefined, entityType: entityType || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };

  const load = () => {
    setLoading(true);
    setError(null);
    fetchAuditLog({ ...filters, page, limit: 25 })
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
  }, [page, actorUserId, action, entityType, dateFrom, dateTo]);

  const clearFilterAndViewUser = (userId: string | null) => {
    setActorUserId(userId ?? '');
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportAuditLogCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export activity log');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary-600" />
            Activity Log
          </h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">
            Append-only audit trail of staff actions for this hospital.
          </p>
        </div>
        <button onClick={handleExport} disabled={exporting} className="btn btn-secondary btn-sm gap-2 whitespace-nowrap">
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            placeholder="Action contains..."
            className="input text-sm py-2 pl-8 w-full"
          />
        </div>
        <input
          type="text"
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          placeholder="Module (e.g. User, OPDVisit)"
          className="input text-sm py-2 w-full"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="input text-sm py-2 w-full"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="input text-sm py-2 w-full"
        />
        {actorUserId ? (
          <button onClick={() => clearFilterAndViewUser(null)} className="btn btn-secondary btn-sm gap-1.5">
            <X className="w-3.5 h-3.5" /> Clear User Filter
          </button>
        ) : (
          <div className="text-xs text-[var(--color-text-tertiary)] flex items-center">
            Click a user below to see only their activity.
          </div>
        )}
      </div>

      {error && <div className="alert-danger">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-secondary)] text-xs uppercase text-[var(--color-text-tertiary)]">
            <tr>
              <th className="text-left p-3">When</th>
              <th className="text-left p-3">User</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Module / Record</th>
              <th className="text-left p-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--color-text-tertiary)]">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--color-text-tertiary)]">No activity found for the selected filters.</td></tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="border-t border-[var(--color-border)]">
                  <td className="p-3 whitespace-nowrap">{formatTimestamp(entry.createdAt)}</td>
                  <td className="p-3">
                    {entry.actorUserId ? (
                      <button
                        onClick={() => clearFilterAndViewUser(entry.actorUserId)}
                        className="text-primary-600 hover:underline font-medium"
                        title="View this user's activity only"
                      >
                        {entry.actorUser?.employee?.name ?? entry.actorUser?.identifier ?? entry.actorUserId}
                      </button>
                    ) : (
                      <span className="text-[var(--color-text-tertiary)]">System</span>
                    )}
                  </td>
                  <td className="p-3">{entry.actorRole}</td>
                  <td className="p-3 font-mono text-xs">{entry.action}</td>
                  <td className="p-3 text-xs">{entry.entityType} <span className="text-[var(--color-text-tertiary)]">#{entry.entityId.slice(0, 8)}</span></td>
                  <td className="p-3 text-xs text-[var(--color-text-secondary)]">{entry.reason ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(meta.totalPages ?? 1) > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-text-tertiary)]">
            {meta.total} total entries • Page {page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-secondary btn-sm gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(meta.totalPages ?? p, p + 1))}
              disabled={page >= (meta.totalPages ?? 1)}
              className="btn btn-secondary btn-sm gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
