import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchDepartments,
  fetchOpdQueue,
  callOpdToken,
  startOpdConsultation,
  completeOpdConsultation,
  markOpdNoShow,
  skipOpdVisit,
  cancelOpdVisit,
  transferOpdVisit,
  Department,
  OPDVisitRecord,
} from '../../api/opd.api';
import { fetchEligibleDoctors, DoctorProfile } from '../../api/doctor.api';
import { useAuth } from '../../hooks/useAuth';
import { Badge } from '../../components/ui/Badge';
import { Stethoscope, RefreshCw } from 'lucide-react';

interface OpdQueueScreenProps {
  authToken: string;
}

/** Roles whose grants (see prisma/seed.ts PERMISSION_GRANTS) let them call/start/complete/skip/no-show a visit directly by id, regardless of which doctor it's assigned to (ownership is still enforced server-side for a Doctor caller). */
const CAN_OPERATE_QUEUE = ['Doctor', 'QueueManager', 'Administrator', 'SuperAdmin'];
/** Roles granted OPDVisit:cancel. */
const CAN_CANCEL = ['Reception', 'QueueManager', 'Administrator', 'SuperAdmin'];
/** Roles granted OPDVisit:transfer. */
const CAN_TRANSFER = ['Reception', 'Doctor', 'QueueManager', 'Administrator', 'SuperAdmin'];

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  WAITING: 'warning',
  CALLED: 'info',
  IN_CONSULTATION: 'success',
  COMPLETED: 'neutral',
  NO_SHOW: 'danger',
  SKIPPED: 'danger',
  CANCELLED: 'danger',
  TRANSFERRED: 'neutral',
};

export const OpdQueueScreen: React.FC<OpdQueueScreenProps> = ({ authToken }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role || '';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [queue, setQueue] = useState<OPDVisitRecord[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string | null>(null);
  const [reassignDoctorId, setReassignDoctorId] = useState('');

  useEffect(() => {
    const loadDepts = async () => {
      setLoading(true);
      try {
        const depts = await fetchDepartments(authToken);
        setDepartments(depts);
        if (depts && depts.length > 0) {
          setSelectedDeptId(depts[0].id);
        }
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load departments');
      } finally {
        setLoading(false);
      }
    };
    loadDepts();
  }, [authToken]);

  useEffect(() => {
    if (!selectedDeptId) {
      setDoctors([]);
      setSelectedDoctorId('');
      return;
    }
    fetchEligibleDoctors(selectedDeptId)
      .then(setDoctors)
      .catch(() => setDoctors([]));
    setSelectedDoctorId('');
  }, [selectedDeptId]);

  const loadQueue = useCallback(async () => {
    if (!selectedDeptId) return;
    try {
      const q = await fetchOpdQueue(selectedDeptId, authToken, selectedDoctorId || undefined);
      setQueue(q);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load OPD queue');
    }
  }, [selectedDeptId, selectedDoctorId, authToken]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 10000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  const activeConsultations = queue.filter((o) => o.status === 'CALLED' || o.status === 'IN_CONSULTATION');
  const waitingTokens = queue
    .filter((o) => o.status === 'WAITING')
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

  const selectedDept = departments.find((d) => d.id === selectedDeptId);

  const runAction = async (id: string, action: () => Promise<OPDVisitRecord>, successMessage: (v: OPDVisitRecord) => string) => {
    setActionMessage(null);
    setError(null);
    setBusyId(id);
    try {
      const updated = await action();
      setActionMessage(successMessage(updated));
      await loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleCall = (item: OPDVisitRecord) =>
    runAction(
      item.id,
      () => callOpdToken(item.id, authToken),
      (v) => `📢 Called Token ${v.tokenNumber} (${v.visit?.employee?.name || 'Patient'}) for consultation!`,
    );

  const handleStart = (item: OPDVisitRecord) =>
    runAction(
      item.id,
      () => startOpdConsultation(item.id, authToken),
      (v) => `Consultation started for Token ${v.tokenNumber}.`,
    );

  const handleComplete = (item: OPDVisitRecord) =>
    runAction(
      item.id,
      () => completeOpdConsultation(item.id, authToken),
      (v) => `✅ Consultation completed for ${v.visit?.employee?.name || 'patient'}.`,
    );

  const handleNoShow = (item: OPDVisitRecord) =>
    runAction(
      item.id,
      () => markOpdNoShow(item.id, undefined, authToken),
      (v) => `Marked Token ${v.tokenNumber} as no-show.`,
    );

  const handleSkip = (item: OPDVisitRecord) =>
    runAction(
      item.id,
      () => skipOpdVisit(item.id, undefined, authToken),
      (v) => `Skipped Token ${v.tokenNumber}.`,
    );

  const handleCancel = (item: OPDVisitRecord) =>
    runAction(
      item.id,
      () => cancelOpdVisit(item.id, undefined, authToken),
      (v) => `Cancelled Token ${v.tokenNumber}.`,
    );

  const handleConfirmReassign = (item: OPDVisitRecord) => {
    if (!reassignDoctorId) return;
    runAction(
      item.id,
      () => transferOpdVisit(item.id, reassignDoctorId, undefined, authToken),
      (v) => `Reassigned Token ${v.tokenNumber} to ${v.doctor?.employee?.name || 'the selected doctor'}.`,
    ).then(() => {
      setReassignTargetId(null);
      setReassignDoctorId('');
    });
  };

  const renderActions = (item: OPDVisitRecord) => {
    const disabled = busyId === item.id;
    const buttons: React.ReactNode[] = [];

    if (CAN_OPERATE_QUEUE.includes(role)) {
      if (item.status === 'WAITING') {
        buttons.push(
          <button key="call" onClick={() => handleCall(item)} disabled={disabled} className="btn btn-secondary btn-sm text-xs">
            Call
          </button>,
        );
        buttons.push(
          <button key="noshow" onClick={() => handleNoShow(item)} disabled={disabled} className="btn btn-ghost btn-sm text-xs text-amber-600">
            No-show
          </button>,
        );
        buttons.push(
          <button key="skip" onClick={() => handleSkip(item)} disabled={disabled} className="btn btn-ghost btn-sm text-xs text-amber-600">
            Skip
          </button>,
        );
      }
      if (item.status === 'CALLED') {
        buttons.push(
          <button
            key="start"
            onClick={async () => {
              await handleStart(item);
              navigate(`/consultations?visitId=${item.visitId}`);
            }}
            disabled={disabled}
            className="btn btn-secondary btn-sm text-xs"
          >
            Start Consultation
          </button>,
        );
        buttons.push(
          <button key="complete" onClick={() => handleComplete(item)} disabled={disabled} className="btn btn-primary btn-sm text-xs">
            Complete
          </button>,
        );
      }
      if (item.status === 'IN_CONSULTATION') {
        buttons.push(
          <button key="complete" onClick={() => handleComplete(item)} disabled={disabled} className="btn btn-primary btn-sm text-xs">
            Complete
          </button>,
        );
      }
    }

    if (CAN_TRANSFER.includes(role) && (item.status === 'WAITING' || item.status === 'CALLED')) {
      buttons.push(
        <button
          key="reassign"
          onClick={() => {
            setReassignTargetId(item.id);
            setReassignDoctorId('');
          }}
          disabled={disabled}
          className="btn btn-ghost btn-sm text-xs text-primary-600"
        >
          Reassign
        </button>,
      );
    }

    if (CAN_CANCEL.includes(role) && (item.status === 'WAITING' || item.status === 'CALLED')) {
      buttons.push(
        <button key="cancel" onClick={() => handleCancel(item)} disabled={disabled} className="btn btn-ghost btn-sm text-xs text-danger-600">
          Cancel
        </button>,
      );
    }

    return buttons;
  };

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

        <div className="flex items-center gap-3 flex-wrap">
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

          <label className="text-xs font-medium text-primary-200">Doctor:</label>
          <select
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="input text-xs font-semibold text-gray-900 py-2 bg-white"
          >
            <option value="">All Doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger text-sm font-semibold">❌ {error}</div>
      )}

      {actionMessage && (
        <div className="alert alert-success text-sm font-semibold">{actionMessage}</div>
      )}

      {loading ? (
        <div className="card p-8 text-center text-sm text-[var(--color-text-tertiary)]">
          Loading OPD queue…
        </div>
      ) : (
      <>
      {/* Active Consultations — one card per doctor currently mid-queue, since each doctor's queue is independent */}
      <div className="card p-6 bg-primary-900 text-white border-none space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Badge variant="success" dot>Live Calling Station</Badge>
            <span className="text-xs text-primary-200/80">• {selectedDept?.name}</span>
          </div>
          <button onClick={loadQueue} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Sync Queue
          </button>
        </div>

        {activeConsultations.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-base font-medium text-primary-200">No Patient Currently In Consultation Room</p>
            <p className="text-xs text-primary-300 font-mono">{waitingTokens.length} patient(s) waiting in queue</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeConsultations.map((item) => (
              <div key={item.id} className="space-y-2 p-4 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-secondary-300">
                    {item.doctor?.employee?.name || 'Doctor'}
                  </span>
                  <Badge variant={STATUS_BADGE[item.status]}>{item.status.replace(/_/g, ' ')}</Badge>
                </div>
                <h2 className="text-2xl font-bold font-mono text-white tracking-tight">{item.tokenNumber}</h2>
                <p className="text-sm font-semibold text-primary-100">{item.visit?.employee?.name || 'Patient'}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">{renderActions(item)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming Waitlist Table */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Upcoming Waiting Tokens ({waitingTokens.length})</h3>
          <Badge variant="warning">OPD Queue</Badge>
        </div>

        <div className="space-y-2">
          {waitingTokens.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
              No upcoming tokens waiting in queue for {selectedDept?.name}.
            </div>
          ) : (
            waitingTokens.map((item, index) => (
              <div key={item.id} className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 font-bold flex items-center justify-center font-mono">
                      #{index + 1}
                    </span>
                    <div>
                      <span className="font-mono font-bold text-sm text-[var(--color-text-primary)] block">{item.tokenNumber}</span>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {item.visit?.employee?.name || 'Patient'} • Dr. {item.doctor?.employee?.name || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono">Issued: {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <Badge variant={STATUS_BADGE[item.status]}>{item.status}</Badge>
                  </div>
                </div>

                {reassignTargetId === item.id ? (
                  <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border)]">
                    <select
                      value={reassignDoctorId}
                      onChange={(e) => setReassignDoctorId(e.target.value)}
                      className="input text-xs py-1"
                    >
                      <option value="">-- Select new doctor --</option>
                      {doctors.filter((d) => d.id !== item.doctorId).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleConfirmReassign(item)}
                      disabled={!reassignDoctorId || busyId === item.id}
                      className="btn btn-primary btn-sm text-xs"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setReassignTargetId(null)}
                      className="btn btn-ghost btn-sm text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">{renderActions(item)}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
};
