import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDisplayDepartments,
  fetchDisplaySnapshot,
  openDisplayStream,
  DisplayDepartment,
  DisplaySnapshot,
  DisplayStreamHandle,
} from '../../api/opd-display.api';

const DEPT_STORAGE_KEY = 'esic-hms-opd-display-dept';

type ConnStatus = 'connecting' | 'connected' | 'reconnecting';

/**
 * Public OPD waiting-area display (TV). Read-only: it never mutates the queue
 * (the OPDDisplayOperator role has no permission to, and this screen exposes
 * no action). It renders the authoritative queue snapshot pushed over SSE by
 * the backend the instant a Queue Manager/Doctor changes the queue.
 */
export const OpdDisplayScreen: React.FC<{ authToken?: string | null }> = () => {
  const [departments, setDepartments] = useState<DisplayDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState<string>(() => {
    try {
      return localStorage.getItem(DEPT_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [now, setNow] = useState(() => new Date());

  // Guards against rendering an out-of-order snapshot after a reconnect: we
  // only accept a snapshot newer than the one on screen.
  const lastRenderedAt = useRef<number>(0);
  const streamRef = useRef<DisplayStreamHandle | null>(null);

  useEffect(() => {
    fetchDisplayDepartments()
      .then((depts) => {
        setDepartments(depts);
        setDepartmentId((prev) => (prev && depts.some((d) => d.id === prev) ? prev : depts[0]?.id || ''));
      })
      .catch(() => setDepartments([]));
  }, []);

  // Wall clock in the header.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const applySnapshot = useCallback((snap: DisplaySnapshot) => {
    const ts = Date.parse(snap.generatedAt) || Date.now();
    if (ts < lastRenderedAt.current) return; // ignore stale/out-of-order
    lastRenderedAt.current = ts;
    setSnapshot(snap);
  }, []);

  // Open the live stream whenever the selected department changes.
  useEffect(() => {
    if (!departmentId) return;
    try {
      localStorage.setItem(DEPT_STORAGE_KEY, departmentId);
    } catch {
      /* non-fatal */
    }

    lastRenderedAt.current = 0;
    setSnapshot(null);
    setStatus('connecting');

    // Immediate authoritative paint so the TV isn't blank before the first
    // SSE frame; the stream then keeps it live and re-syncs on reconnect.
    fetchDisplaySnapshot(departmentId).then(applySnapshot).catch(() => undefined);

    const handle = openDisplayStream(departmentId, {
      onEvent: (event) => {
        if (event.type === 'snapshot') applySnapshot(event.snapshot);
        // 'ping' just proves the link is alive; 'error' is transient and the
        // next snapshot supersedes it.
      },
      onStatus: setStatus,
    });
    streamRef.current = handle;

    return () => {
      handle.close();
      streamRef.current = null;
    };
  }, [departmentId, applySnapshot]);

  const selectedDept = departments.find((d) => d.id === departmentId) || snapshot?.department || null;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-4">
          <div className="text-3xl md:text-4xl font-black tracking-tight">
            {selectedDept ? selectedDept.name : 'OPD Queue'}
          </div>
          {selectedDept && (
            <span className="text-sm md:text-base font-semibold px-3 py-1 rounded-full bg-slate-800 text-slate-300">
              {selectedDept.code}
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-2xl md:text-3xl font-bold tabular-nums">
              {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-xs md:text-sm text-slate-400">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </div>
          </div>
          <ConnectionBadge status={status} />
          {/* Department picker: for the operator during setup. Small and out of the way. */}
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2"
            aria-label="Select department to display"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 md:p-8">
        {/* Now serving — dominant */}
        <section className="lg:col-span-2 flex flex-col">
          <h2 className="text-xl md:text-2xl font-bold text-emerald-400 mb-4 uppercase tracking-wide">Now Serving</h2>
          {snapshot && snapshot.nowServing.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 content-start">
              {snapshot.nowServing.map((s, i) => (
                <div
                  key={`${s.token}-${i}`}
                  className="rounded-3xl bg-gradient-to-br from-emerald-600 to-emerald-800 p-8 shadow-2xl flex flex-col justify-between min-h-[220px]"
                >
                  <div className="text-6xl md:text-7xl xl:text-8xl font-black leading-none tracking-tight">
                    {s.token}
                  </div>
                  <div className="mt-6">
                    {s.doctorName && <div className="text-2xl md:text-3xl font-bold">{s.doctorName}</div>}
                    <div className="text-lg md:text-xl text-emerald-100 mt-1">
                      {s.room ? `Room ${s.room}` : 'Consultation Room'}
                      {s.status === 'IN_CONSULTATION' && ' · In Consultation'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center min-h-[220px]">
              <span className="text-2xl md:text-3xl text-slate-500">No patient currently being called</span>
            </div>
          )}
        </section>

        {/* Upcoming waiting tokens */}
        <section className="flex flex-col">
          <h2 className="text-xl md:text-2xl font-bold text-sky-400 mb-4 uppercase tracking-wide">
            Waiting {snapshot ? `(${snapshot.waitingCount})` : ''}
          </h2>
          <div className="flex-1 rounded-3xl bg-slate-900 border border-slate-800 p-5 overflow-y-auto">
            {snapshot && snapshot.waiting.length > 0 ? (
              <ul className="space-y-3">
                {snapshot.waiting.map((w, i) => (
                  <li
                    key={`${w.token}-${i}`}
                    className="flex items-center justify-between rounded-xl bg-slate-800/70 px-5 py-4"
                  >
                    <span className="text-3xl md:text-4xl font-extrabold tracking-tight">{w.token}</span>
                    {i === 0 && (
                      <span className="text-sm font-semibold text-sky-300 bg-sky-900/50 px-3 py-1 rounded-full">
                        Next
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="h-full flex items-center justify-center">
                <span className="text-xl text-slate-500">No patients waiting</span>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer / disconnection banner */}
      {status !== 'connected' && (
        <div className="bg-amber-600 text-black text-center py-3 text-lg font-bold">
          {status === 'connecting' ? 'Connecting to live queue…' : 'Connection lost — reconnecting… (showing last known queue)'}
        </div>
      )}
    </div>
  );
};

const ConnectionBadge: React.FC<{ status: ConnStatus }> = ({ status }) => {
  const map = {
    connected: { color: 'bg-emerald-500', label: 'LIVE' },
    connecting: { color: 'bg-amber-500 animate-pulse', label: 'CONNECTING' },
    reconnecting: { color: 'bg-amber-500 animate-pulse', label: 'RECONNECTING' },
  }[status];
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full ${map.color}`} />
      <span className="text-xs font-bold tracking-wider text-slate-300">{map.label}</span>
    </div>
  );
};
