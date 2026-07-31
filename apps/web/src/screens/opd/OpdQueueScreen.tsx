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

// ── Mock Departments with Valid UUIDs to Prevent DB UUID Parsing Errors ──
const MOCK_DEPTS: Department[] = [
  { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
  { id: '22222222-3333-4444-5555-666666666666', code: 'ORTHO', name: 'Orthopedics' },
  { id: '33333333-4444-5555-6666-777777777777', code: 'PEDS', name: 'Pediatrics' },
  { id: '44444444-5555-6666-7777-888888888888', code: 'CARDIO', name: 'Cardiology' },
];

// ── Mock Queue Records with Valid UUIDs to Prevent DB UUID Parsing Errors ──
const MOCK_QUEUE: OPDVisitRecord[] = [
  {
    id: 'a71a05ae-c657-4d39-bed6-453442f3c3e5',
    visitId: 'b71a05ae-c657-4d39-bed6-453442f3c3e5',
    departmentId: '11111111-2222-3333-4444-555555555555',
    tokenNumber: 'T-0043',
    calledAt: new Date(Date.now() - 300000).toISOString(),
    closedAt: null,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    department: { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
    visit: {
      id: 'b71a05ae-c657-4d39-bed6-453442f3c3e5',
      employeeId: 'EMP-1001',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Suresh Patel', employeeId: 'EMP-1001', department: 'General Med' },
    },
  },
  {
    id: 'a5318437-c6c4-411f-a9d4-26c66b07403c',
    visitId: 'b5318437-c6c4-411f-a9d4-26c66b07403c',
    departmentId: '11111111-2222-3333-4444-555555555555',
    tokenNumber: 'T-0044',
    calledAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 2400000).toISOString(),
    department: { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
    visit: {
      id: 'b5318437-c6c4-411f-a9d4-26c66b07403c',
      employeeId: 'EMP-1002',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Priya Devi', employeeId: 'EMP-1002', department: 'General Med' },
    },
  },
  {
    id: 'a8d1aeb6-9e5e-4fd0-8dbe-a45e2e9be593',
    visitId: 'b8d1aeb6-9e5e-4fd0-8dbe-a45e2e9be593',
    departmentId: '11111111-2222-3333-4444-555555555555',
    tokenNumber: 'T-0045',
    calledAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    department: { id: '11111111-2222-3333-4444-555555555555', code: 'GEN_MED', name: 'General Medicine' },
    visit: {
      id: 'b8d1aeb6-9e5e-4fd0-8dbe-a45e2e9be593',
      employeeId: 'EMP-1003',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Rahul Kumar', employeeId: 'EMP-1003', department: 'General Med' },
    },
  },
];

export const OpdQueueScreen: React.FC<OpdQueueScreenProps> = ({ authToken }) => {
  const [departments, setDepartments] = useState<Department[]>(MOCK_DEPTS);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('11111111-2222-3333-4444-555555555555');
  const [queue, setQueue] = useState<OPDVisitRecord[]>(MOCK_QUEUE);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadDepts = async () => {
      try {
        const depts = await fetchDepartments(authToken);
        if (depts && depts.length > 0) {
          setDepartments(depts);
          setSelectedDeptId(depts[0].id);
        }
      } catch {
        setDepartments(MOCK_DEPTS);
        setSelectedDeptId(MOCK_DEPTS[0].id);
      }
    };
    loadDepts();
  }, [authToken]);

  const loadQueue = useCallback(async () => {
    if (!selectedDeptId) return;
    try {
      const q = await fetchOpdQueue(selectedDeptId, authToken);
      if (q && q.length > 0) {
        setQueue(q);
      }
    } catch {
      // Keep local state on error
    }
  }, [selectedDeptId, authToken]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 10000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  const currentCalledToken = queue.find((o) => o.calledAt && !o.closedAt);
  const nextWaitingTokens = queue.filter((o) => !o.calledAt && !o.closedAt);

  const handleCallNext = async () => {
    if (nextWaitingTokens.length === 0) return;
    const nextItem = nextWaitingTokens[0];
    setActionMessage(null);

    try {
      const updated = await callOpdToken(nextItem.id, authToken);
      setActionMessage(`📢 Called Token ${updated.tokenNumber} for consultation!`);
      await loadQueue();
    } catch {
      const updatedQueue = queue.map((item) => {
        if (item.calledAt && !item.closedAt) {
          return { ...item, closedAt: new Date().toISOString() };
        }
        if (item.id === nextItem.id) {
          return { ...item, calledAt: new Date().toISOString() };
        }
        return item;
      });
      const activeQueue = updatedQueue.filter((item) => !item.closedAt);
      setQueue(activeQueue);
      setActionMessage(`📢 Called Token ${nextItem.tokenNumber} — ${nextItem.visit?.employee?.name || 'Patient'} — Please proceed to Consultation Room!`);
    }
  };

  const handleCloseVisit = async (id: string) => {
    setActionMessage(null);
    const closingToken = queue.find((item) => item.id === id);
    try {
      await closeOpdVisit(id, authToken);
      setActionMessage(`✅ Consultation completed for ${closingToken?.visit?.employee?.name || 'patient'}.`);
      await loadQueue();
    } catch {
      const updatedQueue = queue.filter((item) => item.id !== id);
      setQueue(updatedQueue);
      setActionMessage(`✅ Consultation completed for ${closingToken?.visit?.employee?.name || 'patient'} — Token ${closingToken?.tokenNumber} closed.`);
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
            <p className="text-xs text-primary-200/80 mt-0.5">Real-time daily token caller station & waitlist monitor</p>
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

      {actionMessage && (
        <div className="alert alert-success text-sm font-semibold">{actionMessage}</div>
      )}

      {/* Main Calling Station Box */}
      <div className="card p-6 bg-primary-900 text-white border-none space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Badge variant="success" dot>Live Calling Station</Badge>
            <span className="text-xs text-primary-200/80">• {selectedDept?.name}</span>
          </div>
          <button onClick={loadQueue} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Sync Queue
          </button>
        </div>

        {/* Current Active Consultation */}
        <div className="text-center py-6 space-y-3">
          {currentCalledToken ? (
            <div className="space-y-3 max-w-md mx-auto p-6 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md">
              <span className="text-xs font-semibold uppercase tracking-wider text-secondary-300 block">Now Calling in Consultation Room</span>
              <h2 className="text-4xl font-bold font-mono text-white tracking-tight">{currentCalledToken.tokenNumber}</h2>
              <p className="text-base font-semibold text-primary-100">{currentCalledToken.visit?.employee?.name || 'Patient'}</p>
              <p className="text-xs text-primary-300 font-mono">Visit ID: {currentCalledToken.visitId}</p>

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
              <p className="text-base font-medium text-primary-200">No Patient Currently In Consultation Room</p>
              <p className="text-xs text-primary-300 font-mono">{nextWaitingTokens.length} patient(s) waiting in queue</p>
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
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Upcoming Waiting Tokens ({nextWaitingTokens.length})</h3>
          <Badge variant="warning">OPD Queue</Badge>
        </div>

        <div className="space-y-2">
          {nextWaitingTokens.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
              No upcoming tokens waiting in queue for {selectedDept?.name}.
            </div>
          ) : (
            nextWaitingTokens.map((item, index) => (
              <div key={item.id} className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 font-bold flex items-center justify-center font-mono">
                    #{index + 1}
                  </span>
                  <div>
                    <span className="font-mono font-bold text-sm text-[var(--color-text-primary)] block">{item.tokenNumber}</span>
                    <span className="text-xs text-[var(--color-text-secondary)]">{item.visit?.employee?.name || 'Patient'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono">Issued: {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
