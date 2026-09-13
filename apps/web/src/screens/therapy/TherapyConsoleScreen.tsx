import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchTherapySessions,
  fetchTherapyCourses,
  openTherapyCourse,
  scheduleTherapySession,
  performTherapySession,
  cancelTherapySession,
  markTherapyNoShow,
  TherapySessionRecord,
  TherapyCourseRecord,
  TherapySource,
} from '../../api/therapy.api';
import { fetchServices, ServiceListItem } from '../../api/catalog.api';
import { fetchVisitById, VisitDetail } from '../../api/patient-lookup.api';
import { fetchAdmissionById, AdmissionRecord } from '../../api/admission.api';
import { Badge } from '../../components/ui/Badge';
import { can } from '../../lib/permissions';
import { Activity, RefreshCw, CheckCircle2, XCircle, User, Search, Calendar } from 'lucide-react';

interface TherapyConsoleScreenProps {
  authToken: string;
  userRole: string;
}

function sessionStatusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'PERFORMED') return 'success';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'danger';
  return 'warning';
}

/** Direct/OPD/IPD — always the server-derived truth, never guessed on the frontend. */
function sourceBadge(source: TherapySource) {
  const label = source === 'DIRECT' ? 'Direct Therapy' : source;
  const variant = source === 'DIRECT' ? 'neutral' : source === 'OPD' ? 'info' : 'warning';
  return (
    <Badge variant={variant as 'neutral' | 'info' | 'warning'} className="text-[9px] px-1.5 py-0.5">
      {label}
    </Badge>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export const TherapyConsoleScreen: React.FC<TherapyConsoleScreenProps> = ({ authToken, userRole }) => {
  // Same shared RBAC mirror the lab workbench uses. The previous inline lists
  // excluded SuperAdmin from both actions, and Reception/Administrator from
  // ordering — all three hold the matching grant server-side.
  const canOrder = can(userRole, 'therapy:order');
  const canPerform = can(userRole, 'therapy:markPerformed');

  const [sessions, setSessions] = useState<TherapySessionRecord[]>([]);
  const [courses, setCourses] = useState<TherapyCourseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<TherapySource | 'ALL'>('ALL');

  // Order panel — either an OPD visit (entry point 2) or an IPD admission (entry point 3).
  const [lookupMode, setLookupMode] = useState<'VISIT' | 'ADMISSION'>('VISIT');
  const [lookupInput, setLookupInput] = useState('');
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [admission, setAdmission] = useState<AdmissionRecord | null>(null);
  const [therapyServices, setTherapyServices] = useState<ServiceListItem[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [plannedSessions, setPlannedSessions] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessionParams = {
        date: showAllDays ? undefined : todayIso(),
        source: sourceFilter === 'ALL' ? undefined : sourceFilter,
      };
      const courseParams = { source: sourceFilter === 'ALL' ? undefined : sourceFilter };
      const [s, c] = await Promise.all([
        fetchTherapySessions(authToken, sessionParams),
        fetchTherapyCourses(authToken, courseParams),
      ]);
      setSessions(s);
      setCourses(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load therapy schedule');
    } finally {
      setLoading(false);
    }
  }, [authToken, showAllDays, sourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (canOrder) {
      fetchServices({ serviceType: 'THERAPY', active: true, limit: 100 }, authToken)
        .then((res) => setTherapyServices(res.items))
        .catch(() => {});
    }
  }, [authToken, canOrder]);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupInput.trim()) return;
    setVisit(null);
    setAdmission(null);
    try {
      if (lookupMode === 'VISIT') {
        const v = await fetchVisitById(lookupInput.trim(), authToken);
        setVisit(v);
      } else {
        const a = await fetchAdmissionById(lookupInput.trim(), authToken);
        setAdmission(a);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load record');
    }
  };

  const activeVisitId = lookupMode === 'VISIT' ? visit?.id : admission?.visitId;
  const activeAdmissionId = lookupMode === 'ADMISSION' ? admission?.id : undefined;
  const activePatientName = lookupMode === 'VISIT' ? visit?.employee.name : admission?.visit.employee.name;
  const activeEmployeeId = lookupMode === 'VISIT' ? visit?.employee.employeeId : admission?.visit.employee.employeeId;

  const selectedService = therapyServices.find((s) => s.id === selectedServiceId);

  const handleOpenCourseOrSchedule = async () => {
    if (!activeVisitId || !selectedServiceId) return;
    setBusy(true);
    setError(null);
    try {
      if (selectedService?.unit === 'COURSE') {
        await openTherapyCourse(
          { visitId: activeVisitId, admissionId: activeAdmissionId, serviceId: selectedServiceId, plannedSessions },
          authToken,
        );
        setMessage(`Course opened — ${selectedService.currentPrice ? `₹${selectedService.currentPrice} charged.` : 'no rate set.'}`);
      } else {
        await scheduleTherapySession(
          { visitId: activeVisitId, admissionId: activeAdmissionId, serviceId: selectedServiceId },
          authToken,
        );
        setMessage('Session scheduled.');
      }
      setSelectedServiceId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule therapy');
    } finally {
      setBusy(false);
    }
  };

  const handlePerform = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await performTherapySession(id, undefined, authToken);
      setMessage('Session marked performed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark session performed');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await cancelTherapySession(id, authToken);
      setMessage('Session cancelled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel session');
    } finally {
      setBusy(false);
    }
  };

  const handleNoShow = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await markTherapyNoShow(id, authToken);
      setMessage('Session marked as no-show.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark no-show');
    } finally {
      setBusy(false);
    }
  };

  const scheduledSessions = sessions.filter((s) => s.status === 'SCHEDULED');
  const pastSessions = sessions.filter((s) => s.status !== 'SCHEDULED');

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Therapy & Massage Console</h1>
            <p className="text-xs text-primary-200/80 mt-0.5">
              Panchakarma, Ayurvedic therapy & Yoga — Direct Therapy, OPD-recommended and IPD sessions in one place
            </p>
          </div>
        </div>
        <button onClick={load} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger text-sm font-semibold">{error}</div>}
      {message && <div className="alert alert-success text-sm font-semibold">{message}</div>}

      {canOrder && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
            Recommend Therapy — OPD Visit or IPD Admission
          </h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setLookupMode('VISIT'); setVisit(null); setAdmission(null); setLookupInput(''); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${lookupMode === 'VISIT' ? 'bg-primary-600 text-white border-primary-600' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'}`}
            >
              🩺 By OPD Visit ID
            </button>
            <button
              type="button"
              onClick={() => { setLookupMode('ADMISSION'); setVisit(null); setAdmission(null); setLookupInput(''); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${lookupMode === 'ADMISSION' ? 'bg-primary-600 text-white border-primary-600' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'}`}
            >
              🏥 By IPD Admission ID
            </button>
          </div>
          <form onSubmit={handleLookup} className="flex gap-2">
            <input
              type="text"
              placeholder={lookupMode === 'VISIT' ? 'Enter OPD Visit ID...' : 'Enter IPD Admission ID...'}
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              className="input text-xs font-mono flex-1"
            />
            <button type="submit" className="btn btn-secondary btn-sm gap-1.5">
              <Search className="w-3.5 h-3.5" /> Load
            </button>
          </form>

          {activeVisitId && (
            <div className="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 text-xs">
                <span className="font-bold text-[var(--color-text-primary)]">{activePatientName}</span>{' '}
                <span className="text-[var(--color-text-secondary)]">({activeEmployeeId})</span>
                {activeAdmissionId && <Badge variant="warning" className="ml-2 text-[9px] px-1.5 py-0.5">IPD</Badge>}
              </div>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="input text-xs py-1.5"
              >
                <option value="">-- Select Therapy/Course --</option>
                {therapyServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.currentPrice ? `— ₹${s.currentPrice}` : '(unpriced)'} [{s.unit}]
                  </option>
                ))}
              </select>
              {selectedService?.unit === 'COURSE' && (
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={plannedSessions}
                  onChange={(e) => setPlannedSessions(Number(e.target.value))}
                  className="input text-xs py-1.5 w-20"
                  placeholder="Sessions"
                />
              )}
              <button
                onClick={handleOpenCourseOrSchedule}
                disabled={!selectedServiceId || busy}
                className="btn btn-primary btn-sm"
              >
                {selectedService?.unit === 'COURSE' ? 'Open Course' : 'Schedule Session'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Console filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowAllDays((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 ${
            !showAllDays ? 'bg-primary-600 text-white border-primary-600' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" /> {showAllDays ? 'Showing All Dates' : "Showing Today's Sessions"}
        </button>
        {(['ALL', 'DIRECT', 'OPD', 'IPD'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              sourceFilter === s ? 'bg-secondary-500 text-white border-secondary-500' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
            }`}
          >
            {s === 'ALL' ? 'All Sources' : s === 'DIRECT' ? 'Direct Therapy' : s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scheduled Sessions */}
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
            {showAllDays ? 'Scheduled Sessions' : "Today's Sessions"} ({scheduledSessions.length})
          </h3>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {loading ? (
              <p className="text-xs text-[var(--color-text-tertiary)] text-center py-6">Loading…</p>
            ) : scheduledSessions.length === 0 ? (
              <p className="text-xs text-[var(--color-text-tertiary)] text-center py-6">No sessions scheduled.</p>
            ) : (
              scheduledSessions.map((s) => (
                <div key={s.id} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--color-text-primary)]">{s.service.name}</span>
                    <div className="flex items-center gap-1">
                      {sourceBadge(s.source)}
                      <Badge variant={sessionStatusVariant(s.status)} className="text-[10px] px-1.5 py-0.5">
                        {s.status}
                      </Badge>
                    </div>
                  </div>
                  {s.visit && (
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      {s.visit.employee.name} <span className="text-[var(--color-text-tertiary)] font-mono font-normal">({s.visit.employee.employeeId})</span>
                    </p>
                  )}
                  <p className="text-[var(--color-text-secondary)]">
                    {s.course ? `Course session #${s.sessionNumber} of ${s.course.plannedSessions}` : 'Standalone sitting'} ·{' '}
                    {new Date(s.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  {s.createdBy && (
                    <p className="text-[10px] text-[var(--color-text-tertiary)]">Booked by {s.createdBy.identifier}</p>
                  )}
                  {canPerform && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => handlePerform(s.id)} disabled={busy} className="btn btn-secondary btn-sm gap-1 text-[11px] py-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success-600" /> Mark Performed
                      </button>
                      <button onClick={() => handleCancel(s.id)} disabled={busy} className="btn btn-ghost btn-sm gap-1 text-[11px] py-1 text-danger-600">
                        <XCircle className="w-3.5 h-3.5" /> Cancel
                      </button>
                      <button onClick={() => handleNoShow(s.id)} disabled={busy} className="btn btn-ghost btn-sm gap-1 text-[11px] py-1 text-amber-600">
                        <User className="w-3.5 h-3.5" /> No-Show
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Courses */}
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
            Active Courses ({courses.length})
          </h3>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {courses.length === 0 ? (
              <p className="text-xs text-[var(--color-text-tertiary)] text-center py-6">No courses opened.</p>
            ) : (
              courses.map((c) => {
                const performed = c.sessions.filter((s) => s.status === 'PERFORMED').length;
                return (
                  <div key={c.id} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--color-text-primary)]">{c.service.name}</span>
                      <div className="flex items-center gap-1">
                        {sourceBadge(c.source)}
                        <Badge variant={c.status === 'COMPLETED' ? 'success' : 'warning'} className="text-[10px] px-1.5 py-0.5">
                          {c.status}
                        </Badge>
                      </div>
                    </div>
                    {c.visit && (
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        {c.visit.employee.name} <span className="text-[var(--color-text-tertiary)] font-mono font-normal">({c.visit.employee.employeeId})</span>
                      </p>
                    )}
                    <p className="text-[var(--color-text-secondary)]">
                      {performed} / {c.plannedSessions} sessions performed
                    </p>
                    <div className="w-full h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                      <div
                        className="h-full bg-primary-500"
                        style={{ width: `${(performed / c.plannedSessions) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {pastSessions.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
            Session History
          </h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {pastSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-[var(--color-surface-secondary)] gap-2">
                <span className="text-[var(--color-text-primary)] font-medium flex-1 truncate">
                  {s.service.name}
                  {s.visit && <span className="text-[var(--color-text-tertiary)] font-normal"> · {s.visit.employee.name}</span>}
                </span>
                {sourceBadge(s.source)}
                {s.performedBy && (
                  <span className="text-[10px] text-[var(--color-text-tertiary)] hidden sm:inline">by {s.performedBy.identifier}</span>
                )}
                <span className="text-[var(--color-text-tertiary)] font-mono">
                  {s.performedAt ? new Date(s.performedAt).toLocaleDateString('en-IN') : '—'}
                </span>
                <Badge variant={sessionStatusVariant(s.status)} className="text-[10px] px-1.5 py-0.5">
                  {s.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
