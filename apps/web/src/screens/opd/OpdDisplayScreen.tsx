import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDisplaySnapshot, openDisplayStream, DisplayDepartment, HospitalSnapshot, DisplayStreamHandle } from '../../api/opd-display.api';

type ConnStatus = 'connecting' | 'connected' | 'reconnecting';

/**
 * Hospital-wide public OPD waiting-area display (TV). Shows every active
 * department's queue at once -- no department selection required. Read-only:
 * it never mutates the queue (the OPDDisplayOperator role has no permission
 * to, and this screen exposes no action). It renders the authoritative
 * hospital-wide snapshot pushed over SSE by the backend the instant a Queue
 * Manager/Doctor changes any department's queue.
 */
export const OpdDisplayScreen: React.FC<{ authToken?: string | null }> = () => {
  const [snapshot, setSnapshot] = useState<HospitalSnapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState('');

  // Guards against rendering an out-of-order snapshot after a reconnect: we
  // only accept a snapshot newer than the one on screen.
  const lastRenderedAt = useRef<number>(0);
  const streamRef = useRef<DisplayStreamHandle | null>(null);

  // Wall clock in the header.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const applySnapshot = useCallback((snap: HospitalSnapshot) => {
    const ts = Date.parse(snap.generatedAt) || Date.now();
    if (ts < lastRenderedAt.current) return; // ignore stale/out-of-order
    lastRenderedAt.current = ts;
    setSnapshot(snap);
  }, []);

  // Open the live stream once, for the whole hospital.
  useEffect(() => {
    // Immediate authoritative paint so the TV isn't blank before the first
    // SSE frame; the stream then keeps it live and re-syncs on reconnect.
    fetchDisplaySnapshot().then(applySnapshot).catch(() => undefined);

    const handle = openDisplayStream({
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
  }, [applySnapshot]);

  const departments = snapshot?.departments ?? [];
  const filteredDepartments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter((d) => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q));
  }, [departments, search]);

  const totalWaiting = departments.reduce((sum, d) => sum + d.waitingCount, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-8 py-5 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-4">
          <div className="text-3xl md:text-4xl font-black tracking-tight">Hospital OPD Queue</div>
        </div>
        <div className="flex items-center gap-6">
          {departments.length > 6 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search department…"
              aria-label="Search department"
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 w-48"
            />
          )}
          <div className="text-right">
            <div className="text-2xl md:text-3xl font-bold tabular-nums">
              {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-xs md:text-sm text-slate-400">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </div>
          </div>
          <ConnectionBadge status={status} />
        </div>
      </header>

      {/* Summary bar */}
      {snapshot && departments.length > 0 && (
        <div className="flex items-center gap-8 px-8 py-3 border-b border-slate-800 bg-slate-900/30 text-sm md:text-base">
          <span className="text-slate-300">
            <span className="font-bold text-white">{departments.length}</span> department
            {departments.length === 1 ? '' : 's'}
          </span>
          <span className="text-slate-300">
            <span className="font-bold text-sky-400">{totalWaiting}</span> patient{totalWaiting === 1 ? '' : 's'} waiting
          </span>
        </div>
      )}

      {/* Body */}
      <main className="flex-1 p-6 md:p-8">
        {!snapshot ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-2xl text-slate-500">Loading queue…</span>
          </div>
        ) : departments.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-2xl md:text-3xl font-bold text-slate-500">NO ACTIVE DEPARTMENTS</span>
          </div>
        ) : filteredDepartments.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xl text-slate-500">No department matches "{search}"</span>
          </div>
        ) : (
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}
          >
            {filteredDepartments.map((dept) => (
              <DepartmentCard key={dept.id} department={dept} />
            ))}
          </div>
        )}
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

const DepartmentCard: React.FC<{ department: DisplayDepartment }> = ({ department }) => {
  return (
    <div className="rounded-3xl bg-slate-900 border border-slate-800 flex flex-col overflow-hidden">
      {/* Department header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/80">
        <div className="text-lg md:text-xl font-black tracking-tight truncate">{department.name}</div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 shrink-0">
          {department.code}
        </span>
      </div>

      {/* Now serving */}
      <div className="p-5">
        <h3 className="text-xs md:text-sm font-bold text-emerald-400 mb-3 uppercase tracking-wide">Now Serving</h3>
        {department.nowServing.length > 0 ? (
          <div className="space-y-3">
            {department.nowServing.map((s, i) => (
              <div
                key={`${s.token}-${i}`}
                className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 px-5 py-4 shadow-lg"
              >
                <div className="text-4xl md:text-5xl font-black leading-none tracking-tight">{s.token}</div>
                <div className="mt-2 text-sm md:text-base text-emerald-100">
                  {s.doctorName ?? 'Consultation'}
                  {s.room ? ` · Room ${s.room}` : ''}
                  {s.status === 'IN_CONSULTATION' && ' · In Consultation'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-950/60 border border-slate-800 px-5 py-6 text-center">
            <span className="text-sm md:text-base text-slate-500">No patient currently being called</span>
          </div>
        )}
      </div>

      {/* Waiting */}
      <div className="px-5 pb-5">
        <h3 className="text-xs md:text-sm font-bold text-sky-400 mb-3 uppercase tracking-wide">
          Waiting ({department.waitingCount})
        </h3>
        {department.waiting.length > 0 ? (
          <ul className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {department.waiting.map((w, i) => (
              <li
                key={`${w.token}-${i}`}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-lg md:text-xl font-extrabold tracking-tight ${
                  i === 0 ? 'bg-sky-900/60 text-sky-200 border border-sky-700' : 'bg-slate-800/70 text-white'
                }`}
              >
                {w.token}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl bg-slate-950/60 border border-slate-800 px-5 py-4 text-center">
            <span className="text-sm text-slate-500">No patients waiting</span>
          </div>
        )}
      </div>
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
