import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchDepartments,
  fetchOpdQueue,
  callOpdToken,
  closeOpdVisit,
  Department,
  OPDVisitRecord,
} from '../../api/opd.api';
import { Badge } from '../../components/ui/Badge';
import { Stethoscope, Volume2, CheckCircle2, RefreshCw } from 'lucide-react';

interface OpdQueueScreenProps {
  authToken: string;
}

export const OpdQueueScreen: React.FC<OpdQueueScreenProps> = ({ authToken }) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [queue, setQueue] = useState<OPDVisitRecord[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDepts = async () => {
      try {
        const depts = await fetchDepartments(authToken);
        setDepartments(depts);
        if (depts.length > 0) setSelectedDeptId(depts[0].id);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load departments');
      }
    };
    loadDepts();
  }, [authToken]);

  const loadQueue = useCallback(async () => {
    if (!selectedDeptId) return;
    try {
      const q = await fetchOpdQueue(selectedDeptId, authToken);
      setQueue(q);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load OPD queue');
    }
  }, [selectedDeptId, authToken]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  const calledTokens = queue
    .filter((o) => o.calledAt && !o.closedAt)
    .sort((a, b) => new Date(b.calledAt!).getTime() - new Date(a.calledAt!).getTime());
  const currentCalledToken = calledTokens[0];
  const nextWaitingTokens = queue.filter((o) => !o.calledAt && !o.closedAt);

  const handleCallNext = async () => {
    if (nextWaitingTokens.length === 0) return;
    const nextItem = nextWaitingTokens[0];
    setActionMessage(null);

    try {
      if (currentCalledToken) {
        await closeOpdVisit(currentCalledToken.id, authToken).catch(() => {});
      }
      const updated = await callOpdToken(nextItem.id, authToken);
      setActionMessage(
        `📢 Called Token ${updated.tokenNumber} (${updated.visit?.employee?.name || 'Patient'}) for consultation!`,
      );
      await loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to call next token');
    }
  };

  const handleCloseVisit = async (id: string) => {
    setActionMessage(null);
    try {
      await closeOpdVisit(id, authToken);
      setActionMessage(`✅ Consultation completed for visit.`);
      await loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to close visit');
    }
  };

  const selectedDept = departments.find((d) => d.id === selectedDeptId);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Doctor OPD Consultation Queue</h1>
            <p className="text-xs text-primary-200/80 mt-0.5">
              Real-time daily token caller station & waitlist monitor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-primary-200">Department:</label>
          <select
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            className="input text-xs font-semibold text-gray-900 py-2 bg-white"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {actionMessage && <div className="alert alert-success">{actionMessage}</div>}

      {/* Main Calling Station Box */}
      <div className="card p-6 bg-primary-900 text-white border-none space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Badge variant="success" dot>
              Live Calling Station
            </Badge>
            <span className="text-xs text-primary-200/80">• {selectedDept?.name}</span>
          </div>
          <button
            onClick={loadQueue}
            className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Sync Queue
          </button>
        </div>

        {/* Current Active Consultation */}
        <div className="text-center py-6 space-y-3">
          {currentCalledToken ? (
            <div className="space-y-3 max-w-md mx-auto p-6 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md">
              <span className="text-xs font-semibold uppercase tracking-wider text-secondary-300 block">
                Now Calling in Consultation Room
              </span>
              <h2 className="text-4xl font-bold font-mono text-white tracking-tight">
                {currentCalledToken.tokenNumber}
              </h2>
              <p className="text-base font-semibold text-primary-100">
                {currentCalledToken.visit?.employee?.name || 'Patient'}
              </p>
              <p className="text-xs text-primary-300 font-mono">
                Visit ID: {currentCalledToken.visitId}
              </p>

              <div className="pt-3">
                <button
                  onClick={() => handleCloseVisit(currentCalledToken.id)}
                  className="btn btn-primary btn-md bg-secondary-500 hover:bg-secondary-600 border-none gap-2 text-xs font-bold px-6"
                >
                  <CheckCircle2 className="w-4 h-4" /> Complete Consultation & Close Token
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-base font-medium text-primary-200">
                No Patient Currently In Consultation Room
              </p>
              <p className="text-xs text-primary-300 font-mono">
                {nextWaitingTokens.length} patient(s) waiting in queue
              </p>
            </div>
          )}

          {/* Call Next Button */}
          <div className="pt-4 flex justify-center">
            <button
              onClick={handleCallNext}
              disabled={nextWaitingTokens.length === 0}
              className="btn btn-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm px-8 py-3.5 gap-2.5 shadow-lg border-none disabled:opacity-40"
            >
              <Volume2 className="w-5 h-5 animate-pulse" />
              Call Next Patient ({nextWaitingTokens.length} Waiting)
            </button>
          </div>
        </div>
      </div>

      {/* Upcoming Waitlist Table */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
            Upcoming Waiting Tokens ({nextWaitingTokens.length})
          </h3>
          <Badge variant="warning">OPD Queue</Badge>
        </div>

        <div className="space-y-2">
          {nextWaitingTokens.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
              No upcoming tokens waiting in queue for {selectedDept?.name}.
            </div>
          ) : (
            nextWaitingTokens.map((item, index) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 font-bold flex items-center justify-center font-mono">
                    #{index + 1}
                  </span>
                  <div>
                    <span className="font-mono font-bold text-sm text-[var(--color-text-primary)] block">
                      {item.tokenNumber}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {item.visit?.employee?.name || 'Patient'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono">
                    Issued:{' '}
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <Badge variant="warning">WAITING</Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
