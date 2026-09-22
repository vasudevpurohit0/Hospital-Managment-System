import React, { useEffect, useState } from 'react';
import {
  ScrollText,
  Download,
  Search,
  X,
  Filter,
  RefreshCw,
  ListTree,
  Table2,
  Monitor,
  Globe2,
  Building2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  fetchPlatformStaffAuditLog,
  fetchPlatformStaffAuditLogStats,
  exportPlatformStaffAuditLogCsv,
  AuditLogEntry,
  AuditLogStats,
  AuditStatus,
  AuditSeverity,
} from '../../api/audit-log.api';
import { listHospitals, HospitalRecord } from '../../api/platform.api';
import { Badge } from '../../components/ui/Badge';
import { AuditLogDetailsModal } from '../../components/AuditLogDetailsModal';
import {
  actionVerb,
  actionBadgeVariant,
  statusBadgeVariant,
  formatIST,
  formatISTShortTime,
  formatISTDateHeading,
  actorDisplayName,
  actorInitial,
} from '../../utils/auditLog';

type ViewMode = 'timeline' | 'table';

function groupByDay(entries: AuditLogEntry[]): { heading: string; items: AuditLogEntry[] }[] {
  const groups: { heading: string; items: AuditLogEntry[] }[] = [];
  for (const entry of entries) {
    const heading = formatISTDateHeading(entry.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.items.push(entry);
    else groups.push({ heading, items: [entry] });
  }
  return groups;
}

const SEVERITY_DOT: Record<AuditSeverity, string> = {
  LOW: 'bg-[var(--color-text-tertiary)]',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-amber-500',
  CRITICAL: 'bg-red-500',
};

/**
 * Cross-hospital counterpart to ActivityLogScreen -- same stat cards,
 * Timeline/Table toggle, search+filters, Export CSV and details modal, since
 * it reads the exact same tenant AuditLog rows (just fanned out across every
 * hospital via PlatformStaffAuditService). Adds a hospital picker: pick one
 * for full pagination via AuditLogService directly, or leave it on "All
 * Active Hospitals" for a merged, capped cross-hospital view.
 */
export const PlatformStaffAuditLogScreen: React.FC = () => {
  const [hospitals, setHospitals] = useState<HospitalRecord[]>([]);
  const [hospitalId, setHospitalId] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalPages?: number; note?: string }>({ total: 0 });
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const [q, setQ] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [status, setStatus] = useState<AuditStatus | ''>('');
  const [severity, setSeverity] = useState<AuditSeverity | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = {
    hospitalId: hospitalId || undefined,
    q: q || undefined,
    actorUserId: actorUserId || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    status: status || undefined,
    severity: severity || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  useEffect(() => {
    listHospitals()
      .then((hs) => setHospitals(hs.filter((h) => h.status !== 'PROVISIONING')))
      .catch(() => undefined);
  }, []);

  const loadStats = () => {
    fetchPlatformStaffAuditLogStats(hospitalId || undefined)
      .then(setStats)
      .catch(() => undefined);
  };

  const load = () => {
    setLoading(true);
    setError(null);
    fetchPlatformStaffAuditLog({ ...filters, page, limit: 25 })
      .then((res) => {
        setEntries(res.items);
        setMeta(res.meta);
      })
      .catch((err) => setError(err.message || 'Failed to load activity log'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId, page, q, actorUserId, action, entityType, status, severity, dateFrom, dateTo]);

  const handleRefresh = () => {
    load();
    loadStats();
  };

  const clearFilterAndViewUser = (userId: string | null) => {
    setActorUserId(userId ?? '');
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportPlatformStaffAuditLogCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `staff-activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export activity log');
    } finally {
      setExporting(false);
    }
  };

  const groups = groupByDay(entries);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary-600" />
            Staff Activity Log
          </h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">
            Cross-hospital staff action audit trail — every action, who, what, when, where. All times in IST.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 ${viewMode === 'timeline' ? 'bg-primary-900 text-white' : 'bg-transparent text-[var(--color-text-secondary)]'}`}
            >
              <ListTree className="w-3.5 h-3.5" /> Timeline
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 ${viewMode === 'table' ? 'bg-primary-900 text-white' : 'bg-transparent text-[var(--color-text-secondary)]'}`}
            >
              <Table2 className="w-3.5 h-3.5" /> Table
            </button>
          </div>
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
          <p className="text-2xl font-bold text-red-600">{stats?.critical ?? '—'}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] mt-1">Critical</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{stats?.failedLogins ?? '—'}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] mt-1">Failed Logins</p>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[220px]">
            <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <select
              value={hospitalId}
              onChange={(e) => {
                setHospitalId(e.target.value);
                setPage(1);
              }}
              className="input text-sm py-2.5 pl-9 w-full"
            >
              <option value="">All Active Hospitals (capped)</option>
              {hospitals
                .filter((h) => h.status === 'ACTIVE')
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search user, module, description, IP address..."
              className="input text-sm py-2.5 pl-9 w-full"
            />
          </div>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`btn btn-secondary btn-sm gap-1.5 ${filtersOpen ? 'ring-2 ring-primary-300' : ''}`}
          >
            <Filter className="w-3.5 h-3.5" /> Filters
          </button>
          {actorUserId && (
            <button onClick={() => clearFilterAndViewUser(null)} className="btn btn-secondary btn-sm gap-1.5">
              <X className="w-3.5 h-3.5" /> Clear User Filter
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-[var(--color-border)]">
            <input
              type="text"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              placeholder="Action contains..."
              className="input text-sm py-2 w-full"
            />
            <input
              type="text"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
              placeholder="Module (e.g. User, OPDVisit)"
              className="input text-sm py-2 w-full"
            />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as AuditStatus | '');
                setPage(1);
              }}
              className="input text-sm py-2 w-full"
            >
              <option value="">All statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILURE">Failed</option>
            </select>
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value as AuditSeverity | '');
                setPage(1);
              }}
              className="input text-sm py-2 w-full"
            >
              <option value="">All severities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="input text-sm py-2 w-full"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="input text-sm py-2 w-full"
            />
          </div>
        )}
      </div>

      {meta.note && <div className="alert-warning text-xs">{meta.note}</div>}
      {error && <div className="alert-danger">{error}</div>}

      {loading ? (
        <div className="card p-8 text-center text-sm text-[var(--color-text-tertiary)]">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--color-text-tertiary)]">
          No activity found for the selected filters.
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.heading} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="text-xs font-semibold text-[var(--color-text-tertiary)] px-2 py-0.5 rounded-full bg-[var(--color-surface-secondary)]">
                  {group.heading}
                </span>
                <div className="h-px flex-1 bg-[var(--color-border)]" />
              </div>

              <div className="space-y-2 pl-1">
                {group.items.map((entry) => (
                  <div
                    key={`${entry.hospitalId ?? ''}-${entry.id}`}
                    className={`card p-4 border-l-4 ${entry.status === 'FAILURE' ? 'border-l-red-500' : 'border-l-transparent'} flex gap-3`}
                  >
                    <div className="flex flex-col items-center pt-1">
                      <span className={`w-2.5 h-2.5 rounded-full ${SEVERITY_DOT[entry.severity]}`} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {actorInitial(entry)}
                          </span>
                          <button
                            onClick={() => entry.actorUserId && clearFilterAndViewUser(entry.actorUserId)}
                            className="font-semibold text-sm text-[var(--color-text-primary)] hover:underline"
                          >
                            {actorDisplayName(entry)}
                          </button>
                          <Badge variant="neutral">{entry.actorRole.toUpperCase()}</Badge>
                          {entry.hospitalName && <Badge variant="info">{entry.hospitalName}</Badge>}
                          {entry.impersonatorRoleLabel && (
                            <span title="This action was taken during an impersonation session">
                              <Badge variant="warning">Impersonated by {entry.impersonatorRoleLabel}</Badge>
                            </span>
                          )}
                          <Badge variant={actionBadgeVariant(entry.action)}>{actionVerb(entry.action)}</Badge>
                          <span className="text-xs text-[var(--color-text-secondary)]">{entry.entityType}</span>
                          <Badge variant={statusBadgeVariant(entry.status)}>
                            {entry.status === 'SUCCESS' ? 'Success' : 'Failed'}
                          </Badge>
                        </div>
                        <span className="text-xs font-mono text-[var(--color-text-tertiary)] whitespace-nowrap">
                          {formatISTShortTime(entry.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--color-text-tertiary)]">
                        <span className="flex items-center gap-1">
                          <Monitor className="w-3 h-3" /> {entry.browser ?? 'Unknown'} · {entry.os ?? 'Unknown'}
                        </span>
                        {entry.ipAddress && (
                          <span className="flex items-center gap-1">
                            <Globe2 className="w-3 h-3" /> {entry.ipAddress}
                          </span>
                        )}
                        {entry.changedFields.length > 0 && (
                          <Badge variant="info">
                            # {entry.changedFields.length} field{entry.changedFields.length === 1 ? '' : 's'} changed
                          </Badge>
                        )}
                      </div>

                      <button
                        onClick={() => setSelectedEntry(entry)}
                        className="text-xs font-semibold text-primary-600 hover:underline"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-secondary)] text-xs uppercase text-[var(--color-text-tertiary)]">
              <tr>
                <th className="text-left p-3">When (IST)</th>
                <th className="text-left p-3">Hospital</th>
                <th className="text-left p-3">User</th>
                <th className="text-left p-3">Role</th>
                <th className="text-left p-3">Action</th>
                <th className="text-left p-3">Module / Record</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={`${entry.hospitalId ?? ''}-${entry.id}`}
                  className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-secondary)] cursor-pointer"
                  onClick={() => setSelectedEntry(entry)}
                >
                  <td className="p-3 whitespace-nowrap">{formatIST(entry.createdAt)}</td>
                  <td className="p-3">{entry.hospitalName ?? '—'}</td>
                  <td className="p-3">
                    {entry.actorUserId ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          clearFilterAndViewUser(entry.actorUserId);
                        }}
                        className="text-primary-600 hover:underline font-medium"
                        title="View this user's activity only"
                      >
                        {actorDisplayName(entry)}
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
                  <td className="p-3">
                    <Badge variant={actionBadgeVariant(entry.action)}>{actionVerb(entry.action)}</Badge>
                  </td>
                  <td className="p-3 text-xs">
                    {entry.entityType} <span className="text-[var(--color-text-tertiary)]">#{entry.entityId.slice(0, 8)}</span>
                  </td>
                  <td className="p-3">
                    <Badge variant={statusBadgeVariant(entry.status)}>{entry.status === 'SUCCESS' ? 'Success' : 'Failed'}</Badge>
                  </td>
                  <td className="p-3 text-xs text-[var(--color-text-secondary)]">{entry.reason ?? '—'}</td>
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

      {selectedEntry && <AuditLogDetailsModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}
    </div>
  );
};
