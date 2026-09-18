import React, { useEffect, useState } from 'react';
import { listAuditLog, AuditLogEntry } from '../../api/platform.api';

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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>📜</span> Platform Audit Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Every time a Super Admin accessed a specific hospital's data, most recent first.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">No activity recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-6 py-3">When</th>
                <th className="px-6 py-3">Admin</th>
                <th className="px-6 py-3">Hospital</th>
                <th className="px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="px-6 py-3 text-gray-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-6 py-3 text-gray-900">{e.platformUserEmail}</td>
                  <td className="px-6 py-3 text-gray-900">{e.hospitalName || '—'}</td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-600">
                    {e.method} {e.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
