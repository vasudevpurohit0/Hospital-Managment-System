import React, { useEffect, useState } from 'react';
import { listAuditLog, AuditLogEntry } from '../../api/platform.api';
import { DataTable, Column } from '../../components/ui/DataTable';
import { FileClock, RefreshCw } from 'lucide-react';
import { formatDateTimeDefault } from '../../utils/date';

export const PlatformAuditLogScreen: React.FC = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listAuditLog());
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'createdAt',
      header: 'When',
      sortable: true,
      render: (e) => formatDateTimeDefault(e.createdAt),
    },
    { key: 'platformUserEmail', header: 'Admin', sortable: true },
    { key: 'hospitalName', header: 'Hospital', render: (e) => e.hospitalName || '—' },
    {
      key: 'action',
      header: 'Action',
      render: (e) => (
        <span className="font-mono text-xs text-[var(--color-text-secondary)]">
          {e.method} {e.path}
        </span>
      ),
    },
  ];

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
        <button onClick={load} className="btn btn-secondary gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <div className="alert-danger">{error}</div>}

      <DataTable
        title="Access Events"
        data={entries}
        columns={columns}
        keyExtractor={(e) => e.id}
        searchableKey="platformUserEmail"
        searchPlaceholder="Search by admin email..."
      />

      {loading && entries.length === 0 && (
        <p className="text-center text-sm text-[var(--color-text-tertiary)]">Loading...</p>
      )}
    </div>
  );
};
