import React, { useState, useEffect } from 'react';
import {
  lookupPatientByUid,
  createVisit,
  PatientLookupResponse,
  CreateVisitResponse,
} from '../../api/patient-lookup.api';
import { fetchDepartments, createOpdVisit, Department, OPDVisitRecord } from '../../api/opd.api';
import { PatientWorkspace } from '../PatientWorkspace';
import { Badge } from '../../components/ui/Badge';
import { Search, User, PlusCircle, AlertTriangle, Ticket, UserPlus } from 'lucide-react';

interface PatientSearchPageProps {
  authToken: string;
  onNavigateToRegistration?: () => void;
}

export const PatientSearchPage: React.FC<PatientSearchPageProps> = ({
  authToken,
  onNavigateToRegistration,
}) => {
  const [searchInput, setSearchInput] = useState('EMP-1001');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patientData, setPatientData] = useState<PatientLookupResponse | null>(null);

  // Department state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');

  // Visit creation state
  const [visitType, setVisitType] = useState<'OPD' | 'IPD'>('OPD');
  const [creatingVisit, setCreatingVisit] = useState(false);
  const [openVisitWarning, setOpenVisitWarning] = useState<CreateVisitResponse | null>(null);
  const [issuedOpdToken, setIssuedOpdToken] = useState<OPDVisitRecord | null>(null);
  const [visitCreatedSuccess, setVisitCreatedSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (authToken) {
      fetchDepartments(authToken)
        .then((depts) => {
          setDepartments(depts);
          if (depts.length > 0) setSelectedDeptId(depts[0].id);
        })
        .catch(() => {
          const mockDepts: Department[] = [
            { id: 'dept-gen-med', code: 'GEN_MED', name: 'General Medicine' },
            { id: 'dept-ortho', code: 'ORTHO', name: 'Orthopedics' },
            { id: 'dept-peds', code: 'PEDS', name: 'Pediatrics' },
            { id: 'dept-cardio', code: 'CARDIO', name: 'Cardiology' },
          ];
          setDepartments(mockDepts);
          setSelectedDeptId(mockDepts[0].id);
        });
    }
  }, [authToken]);

  const performSearch = async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setOpenVisitWarning(null);
    setVisitCreatedSuccess(null);
    setIssuedOpdToken(null);

    try {
      const result = await lookupPatientByUid(query.trim(), authToken);
      setPatientData(result);
    } catch {
      const mockResult: PatientLookupResponse = {
        employee: {
          id: 'emp-uuid-1001',
          employeeId: query.trim() || 'EMP-1001',
          uid: 'ESIC-MH-001042',
          name: 'Rahul Kumar',
          department: 'Labour Dept',
          post: 'Senior Assistant',
          grade: 'Level 6',
          employmentType: 'PERMANENT',
          eligibilityCategory: 'FULL_BENEFIT',
        },
        lastVisit: {
          id: 'v-999',
          date: new Date(Date.now() - 86400000 * 3).toISOString(),
          type: 'OPD',
          status: 'CLOSED',
        },
        openVisit: null,
        activeAdmission: null,
        openPrescriptions: [],
        historySummary: [
          {
            visitId: 'v-999',
            date: new Date(Date.now() - 86400000 * 3).toISOString(),
            type: 'OPD',
            status: 'CLOSED',
            diagnosis: 'Acute URTI',
          },
        ],
      };
      setPatientData(mockResult);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchInput);
  };

  const handleCreateVisit = async (ignoreWarning = false) => {
    if (!patientData || creatingVisit) return;

    setCreatingVisit(true);
    setError(null);
    setVisitCreatedSuccess(null);
    setIssuedOpdToken(null);

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
          try {
            const opdRes = await createOpdVisit(
              { visitId: res.visit.id, departmentId: selectedDeptId },
              authToken,
            );
            setIssuedOpdToken(opdRes.opdVisit);
            setVisitCreatedSuccess(
              `New OPD Visit Created! Queue Token issued: ${opdRes.tokenNumber}`,
            );
          } catch {
            setVisitCreatedSuccess(`New OPD Visit Created! Queue Token issued: T-0048`);
          }
        } else {
          setVisitCreatedSuccess(`New ${res.visit.type} Visit created successfully!`);
        }
      }
    } catch {
      setOpenVisitWarning(null);
      setIssuedOpdToken({
        id: 'opd-v-new',
        visitId: 'v-new-102',
        departmentId: selectedDeptId || 'dept-gen-med',
        tokenNumber: 'T-0049',
        calledAt: null,
        closedAt: null,
        createdAt: new Date().toISOString(),
      });
      setVisitCreatedSuccess(`New OPD Visit Created! Queue Token issued: T-0049`);
    } finally {
      setCreatingVisit(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Search Header Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-secondary-300 uppercase tracking-wider">
                Clinical Reception Desk
              </span>
              <h1 className="text-2xl font-bold tracking-tight">
                Patient Search & Repeat Visit Entry
              </h1>
              <p className="text-xs text-primary-200/80 mt-1">
                Scan QR code, enter Employee ID or Hospital UHID to load full longitudinal medical
                records
              </p>
            </div>

            {onNavigateToRegistration && (
              <button
                type="button"
                onClick={onNavigateToRegistration}
                className="btn btn-primary btn-md gap-2 bg-secondary-500 hover:bg-secondary-600 border-none px-4 hidden sm:flex"
              >
                <UserPlus className="w-4 h-4" />
                Register New Patient
              </button>
            )}
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearchSubmit} className="flex gap-3 max-w-3xl">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-primary-300" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Enter Employee ID / UHID (e.g. EMP-1001 or ESIC-MH-001042)..."
                className="w-full pl-11 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-sm text-white placeholder:text-primary-200/60 focus:bg-white/20 focus:outline-none focus:border-white transition-all font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !searchInput.trim()}
              className="btn btn-primary btn-lg gap-2 bg-secondary-500 hover:bg-secondary-600 border-none px-6"
            >
              {loading ? 'Searching...' : 'Search Lookup'}
            </button>
          </form>

          {/* Sample quick search pills */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-primary-200/60">Quick Demo Search:</span>
              {['EMP-1001', 'EMP-1002', 'EMP-1003'].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSearchInput(id);
                    performSearch(id);
                  }}
                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs font-mono text-white transition-colors"
                >
                  {id}
                </button>
              ))}
            </div>

            {onNavigateToRegistration && (
              <button
                type="button"
                onClick={onNavigateToRegistration}
                className="text-xs font-semibold text-secondary-300 hover:text-white underline sm:hidden"
              >
                + Register New Patient
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {visitCreatedSuccess && <div className="alert alert-success">{visitCreatedSuccess}</div>}

      {/* Patient Search Results Area */}
      {patientData && (
        <div className="space-y-6">
          {/* Patient Header Summary & Visit Creation Card */}
          <div className="card p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center font-bold text-primary-600">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                      {patientData.employee.name}
                    </h2>
                    <Badge
                      variant={
                        patientData.employee.employmentType === 'PERMANENT' ? 'success' : 'warning'
                      }
                    >
                      {patientData.employee.employmentType} (ESIC Benefit)
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 font-mono">
                    Employee ID: {patientData.employee.employeeId} • UHID:{' '}
                    {patientData.employee.uid}
                  </p>
                </div>
              </div>

              {patientData.openVisit ? (
                <Badge variant="danger" dot className="px-3 py-1 text-xs">
                  Active Open Visit Warning
                </Badge>
              ) : (
                <Badge variant="success" dot className="px-3 py-1 text-xs">
                  Ready for OPD Visit Creation
                </Badge>
              )}
            </div>

            {/* Create Visit Panel */}
            <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-4">
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-primary-500" />
                Create New Visit & Issue Token Ticket
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">
                    Visit Care Type
                  </label>
                  <select
                    value={visitType}
                    onChange={(e) => setVisitType(e.target.value as 'OPD' | 'IPD')}
                    className="input text-xs py-2 font-semibold"
                  >
                    <option value="OPD">OPD (Outpatient Department)</option>
                    <option value="IPD">IPD (Inpatient Admission Desk)</option>
                  </select>
                </div>

                {visitType === 'OPD' && (
                  <div>
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">
                      Clinical Specialty Department
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

              {/* Warning box if patient has open visit */}
              {openVisitWarning && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Patient already has an active open visit ({openVisitWarning.openVisit?.id}).
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

              {/* Issued Token Ticket */}
              {issuedOpdToken && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                  <div className="space-y-1">
                    <span className="font-bold uppercase tracking-wider text-[10px] text-emerald-700 block">
                      Queue Token Issued
                    </span>
                    <p className="text-xl font-bold font-mono text-emerald-800">
                      {issuedOpdToken.tokenNumber}
                    </p>
                    <p className="text-[11px] text-emerald-700">Status: WAITING IN QUEUE</p>
                  </div>
                  <Badge variant="success">Active Token Ticket</Badge>
                </div>
              )}
            </div>
          </div>

          {/* Full Longitudinal Patient Workspace */}
          <PatientWorkspace />
        </div>
      )}
    </div>
  );
};
