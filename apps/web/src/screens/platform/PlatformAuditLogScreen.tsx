import React, { useEffect, useState } from 'react';
import {
  listAuditLog,
  fetchPlatformAuditLogStats,
  exportPlatformAuditLogCsv,
  AuditLogEntry,
  PlatformAuditLogStats,
} from '../../api/platform.api';
import { FileClock, RefreshCw, Search, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDateTimeDefault } from '../../utils/date';

/**
 * Every time a Super Admin accessed a specific hospital's data (X-Hospital-Id)
 * -- a different, narrower log than the tenant-level Activity Log: this model
 * has no severity/status/failed-login concept, so the stat tiles and filters
 * here only surface what the data actually supports (Total, Last 24h, unique
 * admins, hospitals touched), rather than faking tiles that would always
 * read 0.
 */
export const PlatformAuditLogScreen: React.FC = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalPages?: number }>({ total: 0 });
  const [stats, setStats] = useState<PlatformAuditLogStats | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = {
    q: q || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const loadStats = () => {
    fetchPlatformAuditLogStats()
      .then(setStats)
      .catch(() => undefined);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAuditLog({ ...filters, page, limit: 25 });
      setEntries(res.items);
      setMeta(res.meta);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, dateFrom, dateTo]);

  const handleRefresh = () => {
    load();
    loadStats();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportPlatformAuditLogCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `platform-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export audit log');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-info-50 border border-info-100 text-info-500 dark:bg-info-950/30 dark:border-info-900/50 dark:text-info-400">
            <FileClock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Platform Audit Log</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              Every time a Super Admin accessed a specific hospital's data, most recent first.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleRefresh} className="btn btn-secondary btn-sm gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={handleExport} disabled={exporting} className="btn btn-primary btn-sm gap-2 whitespace-nowrap">
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{stats?.total ?? '—'}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] mt-1">Total Logs</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-primary-600">{stats?.last24h ?? '—'}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] mt-1">Last 24 Hours</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{stats?.uniqueAdmins ?? '—'}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] mt-1">Admins Active</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{stats?.hospitalsTouched ?? '—'}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] mt-1">Hospitals Touched</p>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search admin, hospital, action, path..."
              className="input text-sm py-2.5 pl-9 w-full"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="input text-sm py-2 w-full sm:w-auto"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="input text-sm py-2 w-full sm:w-auto"
          />
        </div>
      </div>

      {error && <div className="alert-danger">{error}</div>}

      {loading && entries.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--color-text-tertiary)]">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--color-text-tertiary)]">
          No access events found for the selected filters.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-secondary)] text-xs uppercase text-[var(--color-text-tertiary)]">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Admin</th>
                <th className="text-left p-3">Hospital</th>
                <th className="text-left p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-[var(--color-border)]">
                  <td className="p-3 whitespace-nowrap">{formatDateTimeDefault(e.createdAt)}</td>
                  <td className="p-3 font-medium">{e.platformUserEmail}</td>
                  <td className="p-3">{e.hospitalName || '—'}</td>
                  <td className="p-3">
                    <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                      {e.method} {e.path}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
