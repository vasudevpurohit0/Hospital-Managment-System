import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../../components/ui/Badge';
import {
  UserPlus,
  Search,
  AlertTriangle,
  Printer,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Activity,
  Users,
  Ticket,
  Sparkles,
} from 'lucide-react';
import {
  verifyEmployeeId,
  registerEmployee,
  VerifiedEmployeeData,
  RegistrationResponse,
} from '../../api/employee.api';
import {
  lookupPatientByUid,
  createVisit,
  PatientLookupResponse,
  CreateVisitResponse,
} from '../../api/patient-lookup.api';
import {
  fetchDepartments,
  fetchOpdQueue,
  createOpdVisit,
  Department,
  OPDVisitRecord,
} from '../../api/opd.api';
import { fetchDashboardMetrics, DashboardMetrics } from '../../api/dashboard.api';
import { PatientWorkspace } from '../PatientWorkspace';

/* ═══════════════════════════════════════════════════════════
   Reception Workspace — Employee-ID verification/registration,
   universal patient search + repeat-visit token issue, and a
   real-time OPD queue overview. Every value below is sourced
   from a live backend call; nothing here is fabricated.
   ═══════════════════════════════════════════════════════════ */

interface EnterpriseReceptionDeskProps {
  authToken: string;
  initialWorkflow?: ActiveWorkflow;
}

type ActiveWorkflow = 'dashboard' | 'esic-beneficiary' | 'universal-search' | 'success-slip';

export const EnterpriseReceptionDesk: React.FC<EnterpriseReceptionDeskProps> = ({
  authToken,
  initialWorkflow = 'dashboard',
}) => {
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflow>(initialWorkflow);

  useEffect(() => {
    if (initialWorkflow) {
      setActiveWorkflow(initialWorkflow);
    }
  }, [initialWorkflow]);

  /* ── Departments, live OPD queue & dashboard metrics (real) ── */
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [liveQueue, setLiveQueue] = useState<OPDVisitRecord[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    fetchDepartments(authToken)
      .then((depts) => {
        setDepartments(depts);
        if (depts.length > 0) setSelectedDeptId(depts[0].id);
      })
      .catch(() => {});
  }, [authToken]);

  const loadQueue = useCallback(async () => {
    if (!selectedDeptId) return;
    try {
      const q = await fetchOpdQueue(selectedDeptId, authToken);
      setLiveQueue(q);
    } catch {
      // transient polling failure — keep last known queue on screen
    }
  }, [selectedDeptId, authToken]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    fetchDashboardMetrics(authToken)
      .then(setMetrics)
      .catch(() => {});
  }, [authToken]);

  /* ── Employee-ID Verification & Registration ── */
  const [employeeIdInput, setEmployeeIdInput] = useState('EMP-1001');
  const [verifying, setVerifying] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [verifiedData, setVerifiedData] = useState<VerifiedEmployeeData | null>(null);
  const [registrationResult, setRegistrationResult] = useState<RegistrationResponse | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeIdInput.trim()) return;

    setVerifying(true);
    setRegistrationError(null);
    setVerifiedData(null);
    setRegistrationResult(null);
    setIssuedToken(null);

    try {
      const res = await verifyEmployeeId(employeeIdInput.trim(), authToken);
      if (res.status === 'VERIFIED' && res.verifiedData) {
        setVerifiedData(res.verifiedData);
      } else {
        setRegistrationError(res.message || 'Employee ID not found in Labour Dept database.');
      }
    } catch (err: unknown) {
      setRegistrationError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleRegisterAndIssueToken = async () => {
    if (!employeeIdInput.trim() || registering) return;

    setRegistering(true);
    setRegistrationError(null);

    try {
      const res = await registerEmployee(employeeIdInput.trim(), authToken);
      setRegistrationResult(res);

      if (res.employee && selectedDeptId) {
        const visitRes = await createVisit(
          { employeeId: res.employee.id, type: 'OPD' },
          authToken,
        );
        if (visitRes.status === 'CREATED' && visitRes.visit) {
          const opdRes = await createOpdVisit(
            { visitId: visitRes.visit.id, departmentId: selectedDeptId },
            authToken,
          );
          setIssuedToken(opdRes.tokenNumber);
        }
      }

      setActiveWorkflow('success-slip');
    } catch (err: unknown) {
      setRegistrationError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  /* ── Universal Patient Search & Repeat-Visit Token ── */
  const [searchInput, setSearchInput] = useState('EMP-1001');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [patientData, setPatientData] = useState<PatientLookupResponse | null>(null);
  const [visitType, setVisitType] = useState<'OPD' | 'IPD'>('OPD');
  const [creatingVisit, setCreatingVisit] = useState(false);
  const [openVisitWarning, setOpenVisitWarning] = useState<CreateVisitResponse | null>(null);
  const [visitSuccessMessage, setVisitSuccessMessage] = useState<string | null>(null);

  const performSearch = async (query: string) => {
    if (!query.trim()) return;

    setSearching(true);
    setSearchError(null);
    setOpenVisitWarning(null);
    setVisitSuccessMessage(null);
    setPatientData(null);

    try {
      const result = await lookupPatientByUid(query.trim(), authToken);
      setPatientData(result);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Patient lookup failed');
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchInput);
  };

  const handleCreateVisit = async (ignoreWarning = false) => {
    if (!patientData || creatingVisit) return;

    setCreatingVisit(true);
    setSearchError(null);
    setVisitSuccessMessage(null);

    try {
      const res = await createVisit(
        {
          employeeId: patientData.employee.id,
          type: visitType,
          ignoreOpenVisitWarning: ignoreWarning,
        },
        authToken,
      );

      if (res.status === 'OPEN_VISIT_WARNING' && !ignoreWarning) {
        setOpenVisitWarning(res);
      } else if (res.status === 'CREATED' && res.visit) {
        setOpenVisitWarning(null);

        if (visitType === 'OPD' && selectedDeptId) {
          const opdRes = await createOpdVisit(
            { visitId: res.visit.id, departmentId: selectedDeptId },
            authToken,
          );
          setVisitSuccessMessage(`New OPD Visit Created! Queue Token issued: ${opdRes.tokenNumber}`);
        } else {
          setVisitSuccessMessage(`New ${res.visit.type} Visit created successfully!`);
        }
      }
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Failed to create visit');
    } finally {
      setCreatingVisit(false);
    }
  };

  /* ── Global Keyboard Shortcuts ── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveWorkflow('esic-beneficiary');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActiveWorkflow('universal-search');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        setActiveWorkflow('dashboard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const selectedDept = departments.find((d) => d.id === selectedDeptId);

  /* Whichever patient is currently in view, for the right-panel preview */
  const previewEmployee =
    patientData?.employee ||
    registrationResult?.employee ||
    (verifiedData
      ? {
          employeeId: verifiedData.employeeId,
          name: verifiedData.name,
          department: verifiedData.department,
          employmentType: verifiedData.employmentTypeCode,
        }
      : null);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── Top Operational Reception KPI Bar (real dashboard metrics) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Patients Waiting (OPD)',
            val: metrics ? String(metrics.opd.waitingQueue) : '—',
            color: 'text-warning-600',
            icon: Clock,
          },
          {
            label: "Today's OPD Visits",
            val: metrics ? String(metrics.opd.totalVisits) : '—',
            color: 'text-primary-600',
            icon: UserPlus,
          },
          {
            label: 'Active Admissions',
            val: metrics ? String(metrics.ipd.activeAdmissions) : '—',
            color: 'text-info-600',
            icon: Users,
          },
          {
            label: 'Bed Occupancy',
            val: metrics ? `${metrics.ipd.bedOccupancyRate}%` : '—',
            color: 'text-success-600',
            icon: Activity,
          },
        ].map((kpi, idx) => (
          <div key={idx} className="card p-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-secondary)]">
                {kpi.label}
              </p>
              <h3 className={`text-lg font-bold ${kpi.color} mt-0.5`}>{kpi.val}</h3>
            </div>
            <kpi.icon className="w-5 h-5 text-[var(--color-text-tertiary)] opacity-50" />
          </div>
        ))}
      </div>

      {/* ── Main 3-Column Enterprise Workspace ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ── LEFT COLUMN: Quick Actions ── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              Front-Office Actions
            </h3>

            <button
              onClick={() => setActiveWorkflow('esic-beneficiary')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'esic-beneficiary' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-secondary-500" />
              <span>Verify & Register (Ctrl+N)</span>
            </button>

            <button
              onClick={() => setActiveWorkflow('universal-search')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'universal-search' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <Search className="w-4 h-4 text-info-500" />
              <span>Universal Patient Search (Ctrl+F)</span>
            </button>

            <button
              onClick={() => setActiveWorkflow('dashboard')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'dashboard' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Reception Live Queue (Ctrl+Q)</span>
            </button>
          </div>
        </div>

        {/* ── CENTER COLUMN: Operational Workflow Manager ── */}
        <div className="lg:col-span-6 space-y-5">
          {/* WORKFLOW: Reception Live OPD Queue Overview */}
          {activeWorkflow === 'dashboard' && (
            <div className="card p-5 space-y-5">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <div>
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Reception Operational Queue Console
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Real-time OPD token flow, sourced live from the department queue
                  </p>
                </div>
                <Badge variant="success" dot>
                  Live Operations
                </Badge>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Department:
                </label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  className="input text-xs font-semibold py-1.5"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {liveQueue.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
                    No patients currently in the {selectedDept?.name || 'selected'} queue.
                  </div>
                ) : (
                  liveQueue.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-primary-600 block">
                          {q.tokenNumber}
                        </span>
                        <span className="text-[var(--color-text-primary)] font-medium">
                          {q.visit?.employee?.name || 'Patient'}
                        </span>
                      </div>
                      <Badge variant={q.calledAt ? 'success' : 'warning'}>
                        {q.calledAt ? 'CALLED' : 'WAITING'}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* WORKFLOW: Employee-ID Verification & Registration */}
          {activeWorkflow === 'esic-beneficiary' && (
            <div className="card p-5 space-y-5">
              <div className="border-b border-[var(--color-border)] pb-3">
                <Badge variant="info" className="mb-1">
                  Labour Department Verification
                </Badge>
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  Employee ID Verification & Hospital UID Registration
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Enter the ESIC Labour Department Employee ID to verify and register the patient
                </p>
              </div>

              <form onSubmit={handleVerify} className="flex gap-2">
                <input
                  type="text"
                  value={employeeIdInput}
                  onChange={(e) => setEmployeeIdInput(e.target.value)}
                  placeholder="Enter Employee ID (e.g. EMP-1001)..."
                  className="input font-mono flex-1 text-xs py-2"
                />
                <button type="submit" disabled={verifying} className="btn btn-primary btn-md">
                  {verifying ? 'Verifying...' : 'Verify ID'}
                </button>
              </form>

              {registrationError && <div className="alert alert-danger">{registrationError}</div>}

              {verifiedData && (
                <div className="space-y-4 pt-2">
                  <div className="p-3 rounded-xl bg-primary-50 text-primary-900 border border-primary-200 text-xs">
                    <span className="font-bold block text-sm">{verifiedData.name}</span>
                    <span className="text-[11px] font-mono">
                      Employee ID: {verifiedData.employeeId} • Dept: {verifiedData.department}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-[var(--color-text-secondary)] block">Post / Grade:</span>
                      <span className="font-semibold text-sm">
                        {verifiedData.postTitle} ({verifiedData.gradePayLevel})
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-secondary)] block">
                        Employment Type:
                      </span>
                      <span className="font-semibold text-sm">
                        {verifiedData.employmentTypeCode}
                      </span>
                    </div>
                  </div>

                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={handleRegisterAndIssueToken}
                      disabled={registering}
                      className="btn btn-primary btn-lg gap-2 bg-secondary-500 hover:bg-secondary-600 border-none px-6"
                    >
                      <Sparkles className="w-5 h-5" />
                      {registering ? 'Registering...' : 'Register & Issue Hospital UID + OPD Token'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* WORKFLOW: Universal Patient Search & Repeat-Visit Token */}
          {activeWorkflow === 'universal-search' && (
            <div className="card p-5 space-y-4">
              <div className="border-b border-[var(--color-border)] pb-3">
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  Universal Patient Search
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Search by UHID or Employee ID to load the patient's record and issue a repeat
                  visit token
                </p>
              </div>

              <form onSubmit={handleSearchSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Enter UHID or Employee ID..."
                    className="input input-with-icon text-xs py-2.5 font-mono w-full"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !searchInput.trim()}
                  className="btn btn-primary btn-md"
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </form>

              {searchError && <div className="alert alert-danger">{searchError}</div>}

              {patientData && (
                <div className="p-4 rounded-xl border border-primary-200 bg-primary-50/40 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-[var(--color-text-primary)]">
                        {patientData.employee.name}
                      </h4>
                      <p className="text-xs font-mono text-primary-700">
                        UHID: {patientData.employee.uid} • Emp ID: {patientData.employee.employeeId}
                      </p>
                    </div>
                    <Badge variant={patientData.openVisit ? 'danger' : 'success'}>
                      {patientData.openVisit ? 'Active Open Visit' : 'Ready for Visit'}
                    </Badge>
                  </div>

                  <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">
                          Visit Type
                        </label>
                        <select
                          value={visitType}
                          onChange={(e) => setVisitType(e.target.value as 'OPD' | 'IPD')}
                          className="input text-xs py-2 font-semibold"
                        >
                          <option value="OPD">OPD (Outpatient)</option>
                          <option value="IPD">IPD (Inpatient)</option>
                        </select>
                      </div>
                      {visitType === 'OPD' && (
                        <div>
                          <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">
                            Department
                          </label>
                          <select
                            value={selectedDeptId}
                            onChange={(e) => setSelectedDeptId(e.target.value)}
                            className="input text-xs py-2"
                          >
                            {departments.map((dept) => (
                              <option key={dept.id} value={dept.id}>
                                {dept.name} ({dept.code})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => handleCreateVisit(false)}
                          disabled={creatingVisit}
                          className="btn btn-primary btn-md w-full gap-2"
                        >
                          <Ticket className="w-4 h-4" />
                          {creatingVisit ? 'Creating...' : 'Issue Visit Token'}
                        </button>
                      </div>
                    </div>

                    {openVisitWarning && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
                        <p className="font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          Patient already has an active open visit ({openVisitWarning.openVisit?.id}
                          ).
                        </p>
                        <button
                          type="button"
                          onClick={() => handleCreateVisit(true)}
                          className="btn btn-warning btn-sm"
                        >
                          Override & Force Create Visit
                        </button>
                      </div>
                    )}

                    {visitSuccessMessage && (
                      <div className="alert alert-success text-xs">{visitSuccessMessage}</div>
                    )}
                  </div>
                </div>
              )}

              {patientData && (
                <div className="pt-2">
                  <PatientWorkspace patientData={patientData} />
                </div>
              )}
            </div>
          )}

          {/* WORKFLOW: Registration / Visit Success View */}
          {activeWorkflow === 'success-slip' && registrationResult?.employee && (
            <div className="card p-6 space-y-6 animate-fade-in">
              <div className="alert alert-success flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success-600" />
                  <div>
                    <span className="font-bold text-sm block">
                      Registration Successful! Hospital UID Issued.
                    </span>
                    <span className="text-xs">
                      UHID: {registrationResult.hospitalUid?.uidCode}
                      {issuedToken ? ` • Token: ${issuedToken}` : ''}
                    </span>
                  </div>
                </div>
                <button onClick={() => window.print()} className="btn btn-secondary btn-sm gap-1.5">
                  <Printer className="w-4 h-4" /> Print Registration Slip
                </button>
              </div>

              <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-[var(--color-text-primary)]">
                      ESIC MODEL HOSPITAL — REGISTRATION SLIP
                    </h3>
                    <p className="text-[11px] text-[var(--color-text-secondary)]">
                      Ministry of Labour & Employment, Govt. of India
                    </p>
                  </div>
                  {issuedToken && (
                    <Badge variant="info" className="font-mono text-xs">
                      {issuedToken}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Patient Name:</span>{' '}
                    <span className="font-bold text-sm">{registrationResult.employee.name}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Hospital UHID:</span>{' '}
                    <span className="font-mono font-bold text-sm text-primary-600">
                      {registrationResult.hospitalUid?.uidCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Department:</span>{' '}
                    <span className="font-semibold">{registrationResult.employee.department}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">
                      Employment Type:
                    </span>{' '}
                    <span className="font-semibold">
                      {registrationResult.employee.employmentType.name}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setVerifiedData(null);
                    setRegistrationResult(null);
                    setIssuedToken(null);
                    setEmployeeIdInput('');
                    setActiveWorkflow('esic-beneficiary');
                  }}
                  className="btn btn-secondary btn-md"
                >
                  Register Another Patient
                </button>
                <button
                  onClick={() => setActiveWorkflow('dashboard')}
                  className="btn btn-primary btn-md"
                >
                  Return to Reception Console
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Patient Context Preview & Live Queue ── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border)] pb-2">
              Patient Profile Preview
            </h3>

            {previewEmployee ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center font-bold text-primary-600 text-sm">
                    {previewEmployee.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-[var(--color-text-primary)] truncate">
                      {previewEmployee.name}
                    </h4>
                    <p className="text-[11px] font-mono text-primary-600 truncate">
                      {'uid' in previewEmployee ? previewEmployee.uid : previewEmployee.employeeId}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs border-t border-[var(--color-border)] pt-2.5">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-secondary)]">Department:</span>
                    <span className="font-semibold">{previewEmployee.department}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--color-text-tertiary)] py-2">
                No patient loaded yet. Verify or search for a patient to preview their record here.
              </p>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Live OPD Queue
              </h3>
              <span className="text-[10px] text-primary-600 font-mono">Auto-sync 5s</span>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {liveQueue.length === 0 ? (
                <p className="text-xs text-[var(--color-text-tertiary)] py-2">
                  No patients currently in queue.
                </p>
              ) : (
                liveQueue.map((q) => (
                  <div
                    key={q.id}
                    className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-primary-600 block">
                        {q.tokenNumber}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-primary)] font-medium truncate block max-w-[110px]">
                        {q.visit?.employee?.name || 'Patient'}
                      </span>
                    </div>
                    <Badge variant={q.calledAt ? 'success' : 'warning'}>
                      {q.calledAt ? 'CALLED' : 'WAITING'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
